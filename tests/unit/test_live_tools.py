from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any, cast

import pytest
from google.adk.tools import ToolContext
from google.genai import types

from agent.live_tools import (
    BrowserProxyTool,
    BrowserToolBroker,
    BrowserToolDescriptor,
    GeminiExtendedThinkingQueue,
    validate_tool_descriptors,
)


def _descriptor() -> BrowserToolDescriptor:
    return BrowserToolDescriptor(
        name="search_tires",
        description="Busca llantas actuales.",
        inputSchema={
            "type": "object",
            "properties": {"mode": {"type": "string"}},
            "required": ["mode"],
        },
    )


def test_proxy_declaration_is_non_blocking() -> None:
    async def send_json(_: dict[str, Any]) -> None:
        return None

    tool = BrowserProxyTool(_descriptor(), BrowserToolBroker(send_json))
    declaration = tool._get_declaration()

    assert declaration.behavior == types.Behavior.NON_BLOCKING
    assert tool.response_scheduling == types.FunctionResponseScheduling.WHEN_IDLE
    assert declaration.parameters_json_schema["required"] == ["mode"]


def test_descriptor_set_rejects_duplicates() -> None:
    raw = [_descriptor().model_dump(by_alias=True)] * 2

    with pytest.raises(ValueError, match="duplicadas"):
        validate_tool_descriptors(raw)


@pytest.mark.asyncio
async def test_live_queue_removes_unsupported_response_scheduling_hint() -> None:
    queue = GeminiExtendedThinkingQueue()
    content = types.Content(
        role="user",
        parts=[
            types.Part.from_function_response(
                name="search_tires",
                response={"tires": []},
            )
        ],
    )
    assert content.parts[0].function_response is not None
    content.parts[0].function_response.scheduling = (
        types.FunctionResponseScheduling.WHEN_IDLE
    )

    queue.send_content(content)
    request = await queue.get()

    assert request.content is not None
    assert request.content.parts[0].function_response is not None
    assert request.content.parts[0].function_response.scheduling is None
    assert content.parts[0].function_response.scheduling == (
        types.FunctionResponseScheduling.WHEN_IDLE
    )


@pytest.mark.asyncio
async def test_broker_correlates_call_id_and_discards_stale_epoch() -> None:
    sent: list[dict[str, Any]] = []

    async def send_json(payload: dict[str, Any]) -> None:
        sent.append(payload)

    broker = BrowserToolBroker(send_json, timeout_seconds=1)
    pending = asyncio.create_task(
        broker.call(call_id="call-1", name="search_tires", args={"mode": "measure"})
    )
    await asyncio.sleep(0)

    assert sent == [{
        "type": "tool_call",
        "call_id": "call-1",
        "epoch": 0,
        "name": "search_tires",
        "args": {"mode": "measure"},
    }]
    assert not broker.resolve(call_id="call-1", epoch=1, result={"ok": True})
    assert broker.resolve(call_id="call-1", epoch=0, result={"ok": True})
    assert await pending == {"ok": True}


@pytest.mark.asyncio
async def test_proxy_reuses_adk_function_call_id() -> None:
    sent: list[dict[str, Any]] = []

    async def send_json(payload: dict[str, Any]) -> None:
        sent.append(payload)

    broker = BrowserToolBroker(send_json, timeout_seconds=1)
    tool = BrowserProxyTool(_descriptor(), broker)
    context = cast(ToolContext, SimpleNamespace(function_call_id="adk-call-7"))
    pending = asyncio.create_task(
        tool.run_async(args={"mode": "vehicle"}, tool_context=context)
    )
    await asyncio.sleep(0)
    broker.resolve(call_id="adk-call-7", epoch=0, result={"tires": []})

    assert await pending == {"tires": []}
    assert sent[0]["call_id"] == "adk-call-7"


@pytest.mark.asyncio
async def test_epoch_advance_cancels_pending_call() -> None:
    async def send_json(_: dict[str, Any]) -> None:
        return None

    broker = BrowserToolBroker(send_json, timeout_seconds=1)
    pending = asyncio.create_task(
        broker.call(call_id="call-1", name="search_tires", args={})
    )
    await asyncio.sleep(0)
    assert broker.advance_epoch() == 1

    with pytest.raises(asyncio.CancelledError):
        await pending
