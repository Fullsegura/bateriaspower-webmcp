"""Local FastAPI boundary for the Google ADK orchestrator."""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import os
from collections.abc import AsyncIterator
from typing import Any, Literal
from urllib.parse import urlparse

from a2a.server.tasks import InMemoryTaskStore
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from google.adk.agents import RunConfig
from google.adk.agents.run_config import StreamingMode
from google.adk.cli.fast_api import get_fast_api_app
from google.adk.runners import Runner
from google.genai import types
from pydantic import BaseModel, Field

from agent.app_utils import services
from agent.app_utils.a2a import attach_a2a_routes
from agent.app_utils.typing import Feedback
from agent.live_agent import LIVE_MODEL_ID, create_live_runner
from agent.live_auth import verify_live_token
from agent.live_tools import (
    BrowserToolBroker,
    GeminiExtendedThinkingQueue,
    build_browser_tools,
    validate_tool_descriptors,
)

load_dotenv()
if gemini_api_key := os.getenv("GEMINI_API_KEY"):
    os.environ.setdefault("GOOGLE_API_KEY", gemini_api_key)
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "False")

logger = logging.getLogger(__name__)
allow_origins = (
    os.getenv("ALLOW_ORIGINS", "").split(",") if os.getenv("ALLOW_ORIGINS") else None
)
AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_LIVE_MESSAGE_BYTES = 512_000
MAX_AUDIO_CHUNK_BYTES = 64_000
MAX_VIDEO_FRAME_BYTES = 360_000
DEFAULT_LIVE_VOICE_NAME = "Sulafat"


def _live_speech_config() -> types.SpeechConfig:
    voice_name = os.getenv("LIVE_VOICE_NAME", DEFAULT_LIVE_VOICE_NAME).strip()
    return types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                voice_name=voice_name or DEFAULT_LIVE_VOICE_NAME
            )
        )
    )


def _live_video_blob(message: dict[str, Any]) -> types.Blob | None:
    encoded = message.get("data")
    mime_type = message.get("mime_type")
    if not isinstance(encoded, str) or mime_type != "image/jpeg":
        return None
    try:
        frame = base64.b64decode(encoded, validate=True)
    except ValueError:
        return None
    if not frame or len(frame) > MAX_VIDEO_FRAME_BYTES:
        return None
    return types.Blob(data=frame, mime_type=mime_type)


class ChatMessage(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str


class BrowserTool(BaseModel):
    name: str
    title: str
    description: str
    inputSchema: dict[str, Any] | None = None
    annotations: dict[str, Any] | None = None


class ToolResult(BaseModel):
    toolName: str
    result: Any


class OrchestrateRequest(BaseModel):
    sessionId: str = Field(min_length=1, max_length=160)
    messages: list[ChatMessage]
    tools: list[BrowserTool]
    uiState: dict[str, Any]
    toolResult: ToolResult | None = None


class AgentAction(BaseModel):
    kind: Literal["message", "tool_call"]
    message: str | None = None
    toolName: str | None = None
    arguments: dict[str, Any] | None = None


@contextlib.asynccontextmanager
async def lifespan(fast_api_app: FastAPI) -> AsyncIterator[None]:
    from agent.agent import app as adk_app
    from agent.agent import root_agent

    runner = Runner(
        app=adk_app,
        session_service=services.get_session_service(),
        artifact_service=services.get_artifact_service(),
        auto_create_session=True,
    )
    fast_api_app.state.runner = runner
    fast_api_app.state.agent_app_name = adk_app.name
    await attach_a2a_routes(
        fast_api_app,
        agent=root_agent,
        runner=runner,
        task_store=InMemoryTaskStore(),
        rpc_path=f"/a2a/{adk_app.name}",
    )
    yield


app: FastAPI = get_fast_api_app(
    agents_dir=AGENT_DIR,
    web=True,
    artifact_service_uri=services.ARTIFACT_SERVICE_URI,
    allow_origins=allow_origins,
    session_service_uri=services.SESSION_SERVICE_URI,
    otel_to_cloud=False,
    lifespan=lifespan,
)
app.title = "Buscador IA de Llantas ADK"
app.description = "Orquestador ADK para herramientas WebMCP del navegador."


@app.get("/health/runtime")
def runtime_health() -> dict[str, str]:
    return {
        "status": "ok",
        "model": "gemini-3.8-flash",
        "liveModel": LIVE_MODEL_ID,
    }


def _origin_is_allowed(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin")
    if not origin:
        return False
    configured = {item.strip() for item in (allow_origins or []) if item.strip()}
    if configured:
        return origin in configured

    origin_url = urlparse(origin)
    forwarded_host = websocket.headers.get("x-forwarded-host")
    request_host = forwarded_host or websocket.headers.get("host", "")
    if origin_url.netloc == request_host:
        return True
    return origin_url.hostname in {"localhost", "127.0.0.1"} and request_host.split(
        ":", maxsplit=1
    )[0] in {"localhost", "127.0.0.1"}


async def _receive_live_init(websocket: WebSocket) -> dict[str, Any]:
    raw = await asyncio.wait_for(websocket.receive_text(), timeout=15)
    if len(raw.encode("utf-8")) > MAX_LIVE_MESSAGE_BYTES:
        raise ValueError("El mensaje inicial excede el tamaño permitido.")
    payload = json.loads(raw)
    if not isinstance(payload, dict) or payload.get("type") != "init":
        raise ValueError("La sesión Live requiere un mensaje init.")
    return payload


@app.websocket("/ws/live/{session_id}")
async def live_voice(websocket: WebSocket, session_id: str) -> None:
    secret = os.getenv("LIVE_SESSION_SECRET", "")
    token = websocket.query_params.get("token", "")
    if (
        not secret
        or not _origin_is_allowed(websocket)
        or not verify_live_token(
            token,
            session_id=session_id,
            secret=secret,
        )
    ):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    send_lock = asyncio.Lock()

    async def send_json(payload: dict[str, Any]) -> None:
        async with send_lock:
            await websocket.send_json(payload)

    request_queue = GeminiExtendedThinkingQueue()
    broker = BrowserToolBroker(send_json)
    receiver_task: asyncio.Task[None] | None = None
    producer_task: asyncio.Task[None] | None = None

    try:
        initial = await _receive_live_init(websocket)
        raw_tools = initial.get("tools")
        if not isinstance(raw_tools, list):
            raise ValueError("El mensaje init no contiene herramientas WebMCP.")
        descriptors = validate_tool_descriptors(raw_tools)
        tools = build_browser_tools(descriptors, broker)
        runner = create_live_runner(tools, services.get_session_service())

        resumption_handle = initial.get("resumption_handle")
        if resumption_handle is not None and (
            not isinstance(resumption_handle, str) or len(resumption_handle) > 4_096
        ):
            raise ValueError("El identificador de reanudación no es válido.")

        run_config = RunConfig(
            streaming_mode=StreamingMode.BIDI,
            response_modalities=[types.Modality.AUDIO],
            speech_config=_live_speech_config(),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            session_resumption=types.SessionResumptionConfig(
                handle=resumption_handle
            )
            if resumption_handle
            else types.SessionResumptionConfig(),
            context_window_compression=types.ContextWindowCompressionConfig(
                trigger_tokens=100_000,
                sliding_window=types.SlidingWindow(target_tokens=80_000),
            ),
        )

        await send_json({"type": "ready", "epoch": broker.epoch})

        async def receive_browser_events() -> None:
            while True:
                raw = await websocket.receive_text()
                if len(raw.encode("utf-8")) > MAX_LIVE_MESSAGE_BYTES:
                    await send_json(
                        {"type": "error", "message": "Mensaje Live demasiado grande."}
                    )
                    continue
                message = json.loads(raw)
                if not isinstance(message, dict):
                    continue
                message_type = message.get("type")
                if message_type == "audio":
                    encoded = message.get("data")
                    if not isinstance(encoded, str):
                        continue
                    try:
                        audio = base64.b64decode(encoded, validate=True)
                    except ValueError:
                        continue
                    if not audio or len(audio) > MAX_AUDIO_CHUNK_BYTES:
                        continue
                    request_queue.send_realtime(
                        types.Blob(data=audio, mime_type="audio/pcm;rate=16000")
                    )
                elif message_type == "video":
                    if frame := _live_video_blob(message):
                        request_queue.send_realtime(frame)
                elif message_type == "audio_stream_end":
                    request_queue.send_audio_stream_end()
                elif message_type == "tool_response":
                    call_id = message.get("call_id")
                    epoch = message.get("epoch")
                    if isinstance(call_id, str) and isinstance(epoch, int):
                        broker.resolve(
                            call_id=call_id,
                            epoch=epoch,
                            result=message.get("result"),
                        )
                elif message_type == "close":
                    return

        async def produce_agent_events() -> None:
            async for event in runner.run_live(
                user_id="webmcp-live",
                session_id=session_id,
                live_request_queue=request_queue,
                run_config=run_config,
            ):
                if event.interrupted:
                    epoch = broker.advance_epoch()
                    await send_json({"type": "interrupted", "epoch": epoch})

                if event.interaction_status:
                    status_value = getattr(
                        event.interaction_status,
                        "value",
                        str(event.interaction_status),
                    )
                    await send_json({"type": "state", "state": status_value})

                if event.input_transcription:
                    await send_json(
                        {
                            "type": "transcript",
                            "role": "user",
                            "text": event.input_transcription.text or "",
                            "final": bool(event.input_transcription.finished),
                        }
                    )
                if event.output_transcription:
                    await send_json(
                        {
                            "type": "transcript",
                            "role": "assistant",
                            "text": event.output_transcription.text or "",
                            "final": bool(event.output_transcription.finished),
                        }
                    )

                if event.live_session_resumption_update:
                    update = event.live_session_resumption_update
                    await send_json(
                        {
                            "type": "session_resumption",
                            "handle": update.new_handle,
                            "resumable": bool(update.resumable),
                        }
                    )
                if event.go_away:
                    await send_json(
                        {
                            "type": "go_away",
                            "time_left": event.go_away.time_left,
                        }
                    )

                if event.content and event.content.parts:
                    for part in event.content.parts:
                        if not part.inline_data or not part.inline_data.data:
                            continue
                        await send_json(
                            {
                                "type": "audio",
                                "data": base64.b64encode(
                                    part.inline_data.data
                                ).decode("ascii"),
                            }
                        )

        receiver_task = asyncio.create_task(receive_browser_events())
        producer_task = asyncio.create_task(produce_agent_events())
        done, pending = await asyncio.wait(
            {receiver_task, producer_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        for task in done:
            task.result()
    except WebSocketDisconnect:
        pass
    except (ValueError, json.JSONDecodeError) as error:
        logger.info("Sesión Live rechazada: %s", error)
        with contextlib.suppress(RuntimeError, WebSocketDisconnect):
            await send_json({"type": "error", "message": str(error)})
    except Exception:
        logger.exception("La sesión Gemini Live falló.")
        with contextlib.suppress(RuntimeError, WebSocketDisconnect):
            await send_json(
                {"type": "error", "message": "La sesión de voz no está disponible."}
            )
    finally:
        broker.close()
        request_queue.close()
        for task in (receiver_task, producer_task):
            if task and not task.done():
                task.cancel()
        with contextlib.suppress(RuntimeError, WebSocketDisconnect):
            await websocket.close()


@app.post("/orchestrate", response_model=AgentAction)
async def orchestrate(request: OrchestrateRequest) -> AgentAction:
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY no configurada.")

    envelope = request.model_dump(mode="json")
    prompt = json.dumps(envelope, ensure_ascii=False, separators=(",", ":"))
    message = types.Content(role="user", parts=[types.Part.from_text(text=prompt)])

    final_text: str | None = None
    async for event in app.state.runner.run_async(
        user_id="webmcp-browser",
        session_id=request.sessionId,
        new_message=message,
    ):
        if event.is_final_response() and event.content and event.content.parts:
            final_text = "".join(part.text or "" for part in event.content.parts).strip()

    if not final_text:
        raise HTTPException(status_code=502, detail="ADK no devolvió una respuesta final.")

    try:
        action = AgentAction.model_validate_json(final_text)
    except ValueError as error:
        logger.warning("Respuesta ADK inválida: %s", error)
        raise HTTPException(
            status_code=502,
            detail="ADK devolvió una acción no válida.",
        ) from error

    if action.kind == "message":
        if not action.message:
            raise HTTPException(status_code=502, detail="Mensaje ADK vacío.")
        return action

    discovered = {tool.name for tool in request.tools}
    if not action.toolName or action.toolName not in discovered:
        raise HTTPException(
            status_code=502,
            detail="ADK solicitó una herramienta no descubierta.",
        )
    if action.arguments is None:
        raise HTTPException(status_code=502, detail="Argumentos ADK ausentes.")

    return action


@app.post("/feedback")
def collect_feedback(feedback: Feedback) -> dict[str, str]:
    logger.info("feedback=%s", feedback.model_dump_json())
    return {"status": "success"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
