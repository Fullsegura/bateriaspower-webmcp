from __future__ import annotations

import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from agent import visual_battery
from agent.visual_battery import CameraEvidence, InspectCameraBatteryTool, research_frame


def response(payload, sources=()):
    return SimpleNamespace(text=json.dumps(payload) if isinstance(payload, dict) else payload,
        candidates=[SimpleNamespace(grounding_metadata=SimpleNamespace(
            grounding_chunks=[SimpleNamespace(web=SimpleNamespace(uri=url, title="Fabricante")) for url in sources]))])


def client(*responses):
    return SimpleNamespace(models=SimpleNamespace(generate_content=AsyncMock(side_effect=responses)))


@pytest.mark.asyncio
async def test_uncertain_reference_never_attributes_web_specs():
    camera = CameraEvidence("session-a")
    frame = camera.update(b"image")
    api = client(response({"status": "uncertain", "brand": "Marca", "reference": None,
        "specifications": [{"name": "capacityAh", "value": "60"}],
        "clarification": "Acerca la referencia de la etiqueta."}))
    result = await research_frame(frame, api)
    assert api.models.generate_content.await_count == 1
    assert result["specifications"] == [{"name": "capacityAh", "value": "60", "evidence": "image", "sourceIds": []}]
    assert result["sources"] == []
    assert result["identification"]["status"] == "uncertain"
    config = api.models.generate_content.call_args.kwargs["config"]
    assert config.response_schema is None
    assert config.response_json_schema["additionalProperties"] is False


@pytest.mark.asyncio
async def test_uncertain_reference_can_research_candidates_without_attributing_specs():
    frame = CameraEvidence("session-a").update(b"image")
    api = client(
        response({"status": "uncertain", "brand": "Fabricante", "reference": None,
                  "specifications": [{"name": "capacityAh", "value": "60 Ah"}],
                  "clarification": "Acerca la referencia.", "webQuery": "Fabricante linea legible bateria"}),
        response("La linea tiene las referencias REF-X y REF-Y.", ["https://example.com/linea"]),
        response({"specifications": [{"name": "capacityAh", "value": "60 Ah", "evidence": "image", "sourceIds": []}],
                  "conflicts": [], "referenceCandidates": [{"reference": "REF-X", "distinguishingDetails": "Codigo en la etiqueta superior.", "sourceIds": [0]}]}),
    )
    result = await research_frame(frame, api)
    assert api.models.generate_content.await_count == 3
    assert result["identification"]["status"] == "uncertain"
    assert result["identification"]["reference"] is None
    assert result["specifications"][0]["evidence"] == "image"
    assert result["referenceCandidates"][0]["sourceIds"] == [0]
    assert "webQuery" not in result["identification"]


@pytest.mark.asyncio
async def test_uncertain_reference_rejects_web_spec_attribution():
    frame = CameraEvidence("session-a").update(b"image")
    api = client(
        response({"status": "uncertain", "brand": "Fabricante", "reference": None,
                  "specifications": [], "clarification": "Acerca la etiqueta.", "webQuery": "Fabricante"}),
        response("Ficha REF-X", ["https://example.com/ref"]),
        response({"specifications": [{"name": "capacityAh", "value": "60", "evidence": "web", "sourceIds": [0]}], "conflicts": []}),
    )
    with pytest.raises(ValueError, match="incierta"):
        await research_frame(frame, api)


@pytest.mark.asyncio
async def test_reference_candidate_requires_current_source():
    frame = CameraEvidence("session-a").update(b"image")
    api = client(
        response({"status": "uncertain", "brand": "Fabricante", "reference": None,
                  "specifications": [], "clarification": "Acerca la etiqueta.", "webQuery": "Fabricante"}),
        response("Ficha REF-X", ["https://example.com/ref"]),
        response({"specifications": [], "conflicts": [], "referenceCandidates": [
            {"reference": "REF-X", "distinguishingDetails": "Etiqueta", "sourceIds": [9]},
        ]}),
    )
    with pytest.raises(ValueError, match="candidata"):
        await research_frame(frame, api)


@pytest.mark.asyncio
async def test_exact_reference_research_returns_partial_grounded_evidence():
    frame = CameraEvidence("session-a").update(b"image")
    api = client(
        response({"status": "identified", "brand": "Fabricante", "reference": "REF-X",
                  "specifications": [], "clarification": None}),
        response("Ficha exacta REF-X: 60 Ah.", ["https://example.com/REF-X"]),
        response({"specifications": [{"name": "capacityAh", "value": "60", "evidence": "web", "sourceIds": [0]}], "conflicts": []}),
    )
    result = await research_frame(frame, api)
    assert api.models.generate_content.await_count == 3
    assert result["specifications"][0]["value"] == "60"
    assert result["sources"][0]["url"] == "https://example.com/REF-X"
    assert len(result["specifications"]) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("spec", [
    {"name": "cca", "value": "800", "evidence": "web", "sourceIds": [9]},
    {"name": "cca", "value": "800", "evidence": "web", "sourceIds": []},
    {"name": "cca", "value": "800", "evidence": "image", "sourceIds": []},
])
async def test_rejects_unproven_sources_and_unobserved_image_specs(spec):
    frame = CameraEvidence("session-a").update(b"image")
    api = client(
        response({"status": "identified", "brand": "Fabricante", "reference": "REF-X", "specifications": [], "clarification": None}),
        response("Ficha", ["https://example.com/ref"]),
        response({"specifications": [spec], "conflicts": []}),
    )
    with pytest.raises(ValueError):
        await research_frame(frame, api)


def test_camera_frames_are_session_local_fresh_and_cleared():
    first, second = CameraEvidence("one"), CameraEvidence("two")
    frame = first.update(b"image")
    assert first.current() == frame
    with pytest.raises(ValueError):
        second.current()
    object.__setattr__(frame, "received_at", time.time() - 11)
    with pytest.raises(ValueError):
        first.current()
    first.update(b"image")
    first.clear()
    with pytest.raises(ValueError):
        first.current()


class AsyncClientContext:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, *_):
        pass


@pytest.mark.asyncio
async def test_inspection_requires_current_session_frame(monkeypatch):
    factory = AsyncMock()
    monkeypatch.setattr(visual_battery.genai, "Client", factory)
    tool = InspectCameraBatteryTool(CameraEvidence("one"))
    result = await tool.run_async(args={}, tool_context=None)
    assert result["ok"] is False
    assert factory.call_count == 0


@pytest.mark.asyncio
async def test_inspection_announces_provenance_without_persisting_frame(monkeypatch):
    camera = CameraEvidence("one")
    frame = camera.update(b"image")
    monkeypatch.setattr(visual_battery.genai, "Client", lambda: SimpleNamespace(aio=AsyncClientContext()))
    monkeypatch.setattr(visual_battery, "research_frame", AsyncMock(return_value={
        "identification": {"status": "uncertain"}, "specifications": [], "sources": [],
    }))
    notify = AsyncMock()
    result = await InspectCameraBatteryTool(camera, notify).run_async(args={}, tool_context=None)
    assert result["sessionId"] == "one"
    assert result["frameId"] == frame.frame_id
    assert "data" not in result
    notify.assert_awaited_once_with({"type": "visual_evidence", "evidence": result})


@pytest.mark.asyncio
async def test_closing_camera_invalidates_pending_inspection(monkeypatch):
    camera = CameraEvidence("one")
    camera.update(b"image")
    monkeypatch.setattr(visual_battery.genai, "Client", lambda: SimpleNamespace(aio=AsyncClientContext()))

    async def inspect(*_):
        camera.clear()
        return {"specifications": [], "sources": []}

    monkeypatch.setattr(visual_battery, "research_frame", inspect)
    notify = AsyncMock()
    result = await InspectCameraBatteryTool(camera, notify).run_async(args={}, tool_context=None)
    assert result["ok"] is False
    notify.assert_not_awaited()
