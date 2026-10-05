from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from agent import fast_api_app


def _token(session_id: str, secret: str) -> str:
    payload = base64.urlsafe_b64encode(
        json.dumps({"sid": session_id, "exp": 4_000_000_000}).encode()
    ).decode().rstrip("=")
    signature = base64.urlsafe_b64encode(
        hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()
    ).decode().rstrip("=")
    return f"{payload}.{signature}"


class _Runner:
    async def run_live(self, **_: Any):
        await asyncio.Event().wait()
        if False:
            yield None


def test_runtime_health_reports_both_models() -> None:
    client = TestClient(fast_api_app.app)

    health = client.get("/health/runtime").json()
    assert {key: health[key] for key in ("status", "model", "liveModel")} == {
        "status": "ok",
        "model": "gemini-3.8-flash",
        "liveModel": "gemini-3.8-live-extended-thinking",
    }
    assert len(health["catalogRulesHash"]) == 64
    assert len(health["liveRulesHash"]) == 64
    assert len(health["visualResearchHash"]) == 64
    assert len(health["liveTransportHash"]) == 64


def test_live_voice_defaults_to_warm_sulafat_voice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("LIVE_VOICE_NAME", raising=False)

    speech_config = fast_api_app._live_speech_config()

    assert speech_config.voice_config.prebuilt_voice_config.voice_name == "Sulafat"


def test_live_voice_can_be_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LIVE_VOICE_NAME", "Kore")

    speech_config = fast_api_app._live_speech_config()

    assert speech_config.voice_config.prebuilt_voice_config.voice_name == "Kore"


def test_live_websocket_authenticates_and_registers_browser_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    secret = "integration-secret"
    session_id = "a7c9dcd8-2fe3-4d62-a893-bda9518f69ca"
    monkeypatch.setenv("LIVE_SESSION_SECRET", secret)
    monkeypatch.setattr(fast_api_app, "create_live_runner", lambda *_: _Runner())
    client = TestClient(fast_api_app.app)

    with client.websocket_connect(
        f"/ws/live/{session_id}?token={_token(session_id, secret)}",
        headers={"origin": "http://testserver"},
    ) as websocket:
        websocket.send_json({
            "type": "init",
            "tools": [{
                "name": "search_tires",
                "description": "Busca llantas actuales.",
                "inputSchema": {
                    "type": "object",
                    "properties": {"mode": {"type": "string"}},
                    "required": ["mode"],
                },
            }],
            "resumption_handle": None,
        })

        assert websocket.receive_json() == {"type": "ready", "epoch": 0}
        websocket.send_json({"type": "close"})


def test_live_websocket_rejects_invalid_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LIVE_SESSION_SECRET", "integration-secret")
    client = TestClient(fast_api_app.app)

    with pytest.raises(WebSocketDisconnect) as error:
        with client.websocket_connect(
            "/ws/live/a7c9dcd8-2fe3-4d62-a893-bda9518f69ca?token=invalid",
            headers={"origin": "http://testserver"},
        ):
            pass

    assert error.value.code == 1008


def test_live_camera_evidence_is_session_scoped_and_cleared(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    secret = "integration-secret"
    session_id = "a7c9dcd8-2fe3-4d62-a893-bda9518f69ca"
    captured_tools = []
    received_frames = []
    original_update = fast_api_app.CameraEvidence.update
    sent_context = []
    original_send_content = fast_api_app.GeminiExtendedThinkingQueue.send_content

    def send_content(queue, content, partial=False):
        sent_context.append((content, partial))
        original_send_content(queue, content, partial=partial)

    def update(camera, data):
        frame = original_update(camera, data)
        received_frames.append((camera.session_id, frame))
        return frame

    def runner(tools, _service):
        captured_tools.extend(tools)
        return _Runner()

    monkeypatch.setenv("LIVE_SESSION_SECRET", secret)
    monkeypatch.setattr(fast_api_app, "create_live_runner", runner)
    monkeypatch.setattr(fast_api_app.CameraEvidence, "update", update)
    monkeypatch.setattr(fast_api_app.GeminiExtendedThinkingQueue, "send_content", send_content)
    client = TestClient(fast_api_app.app)
    data = b"camera transport fixture"

    with client.websocket_connect(
        f"/ws/live/{session_id}?token={_token(session_id, secret)}",
        headers={"origin": "http://testserver"},
    ) as websocket:
        websocket.send_json({"type": "init", "tools": [{
            "name": "read_battery_catalog", "description": "Lee fichas.",
            "inputSchema": {"type": "object", "properties": {}},
        }]})
        message = websocket.receive_json()
        assert message["type"] == "ready", message
        websocket.send_json({"type": "video", "mime_type": "image/jpeg",
                             "data": base64.b64encode(data).decode()})
        websocket.send_json({"type": "camera_state", "active": False})
        websocket.send_json({"type": "close"})

    inspector = next(tool for tool in captured_tools if tool.name == "inspect_camera_battery")
    assert received_frames[0][0] == session_id
    assert received_frames[0][1].data == data
    assert inspector.camera.frame is None
    assert inspector.camera.generation >= 2
    assert len(sent_context) == 2
    assert all(partial for _, partial in sent_context)
    assert json.loads(sent_context[0][0].parts[0].text)["camera"]["active"] is True
    assert json.loads(sent_context[1][0].parts[0].text)["camera"]["active"] is False
