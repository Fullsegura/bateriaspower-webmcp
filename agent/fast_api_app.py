"""Local FastAPI boundary for the Google ADK orchestrator."""

from __future__ import annotations

import contextlib
import json
import logging
import os
from collections.abc import AsyncIterator
from typing import Any, Literal

from a2a.server.tasks import InMemoryTaskStore
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from google.adk.cli.fast_api import get_fast_api_app
from google.adk.runners import Runner
from google.genai import types
from pydantic import BaseModel, Field

from agent.app_utils import services
from agent.app_utils.a2a import attach_a2a_routes
from agent.app_utils.typing import Feedback

load_dotenv()
if gemini_api_key := os.getenv("GEMINI_API_KEY"):
    os.environ.setdefault("GOOGLE_API_KEY", gemini_api_key)
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "False")

logger = logging.getLogger(__name__)
allow_origins = (
    os.getenv("ALLOW_ORIGINS", "").split(",") if os.getenv("ALLOW_ORIGINS") else None
)
AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": "gemini-3.8-flash"}


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
