"""Session-scoped ADK tools that execute through browser WebMCP."""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from google.adk.agents import LiveRequestQueue
from google.adk.tools import BaseTool, ToolContext
from google.genai import types
from pydantic import BaseModel, ConfigDict, Field, field_validator

_TOOL_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")
_MAX_TOOLS = 16


class GeminiExtendedThinkingQueue(LiveRequestQueue):
    """Keeps ADK async scheduling internal to models that reject wire hints."""

    def send_content(self, content: types.Content, partial: bool = False) -> None:
        sanitized = content.model_copy(deep=True)
        for part in sanitized.parts or []:
            if part.function_response:
                part.function_response.scheduling = None
        super().send_content(sanitized, partial=partial)


class BrowserToolDescriptor(BaseModel):
    """Serializable portion of a tool returned by modelContext.getTools()."""

    model_config = ConfigDict(extra="forbid")

    name: str
    title: str = ""
    description: str = Field(min_length=1, max_length=2_000)
    inputSchema: dict[str, Any] | None = None
    annotations: dict[str, Any] | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not _TOOL_NAME.fullmatch(value):
            raise ValueError("Nombre de herramienta WebMCP no válido.")
        return value

    @field_validator("inputSchema")
    @classmethod
    def validate_schema(
        cls, value: dict[str, Any] | None
    ) -> dict[str, Any] | None:
        if value is None:
            return None
        if value.get("type") not in (None, "object"):
            raise ValueError("inputSchema debe describir un objeto.")
        required = value.get("required", [])
        if not isinstance(required, list) or not all(
            isinstance(item, str) for item in required
        ):
            raise ValueError("inputSchema.required no es válido.")
        return value


def validate_tool_descriptors(
    raw_tools: list[dict[str, Any]],
) -> list[BrowserToolDescriptor]:
    if not raw_tools or len(raw_tools) > _MAX_TOOLS:
        raise ValueError("La sesión debe registrar entre 1 y 16 herramientas.")
    tools = [BrowserToolDescriptor.model_validate(raw) for raw in raw_tools]
    names = [tool.name for tool in tools]
    if len(set(names)) != len(names):
        raise ValueError("La sesión contiene herramientas WebMCP duplicadas.")
    return tools


@dataclass
class _PendingCall:
    epoch: int
    future: asyncio.Future[Any]


class BrowserToolBroker:
    """Correlates one browser connection with its pending ADK tool calls."""

    def __init__(
        self,
        send_json: Callable[[dict[str, Any]], Awaitable[None]],
        *,
        timeout_seconds: float = 45,
    ) -> None:
        self._send_json = send_json
        self._timeout_seconds = timeout_seconds
        self._epoch = 0
        self._pending: dict[str, _PendingCall] = {}
        self._closed = False

    @property
    def epoch(self) -> int:
        return self._epoch

    @property
    def pending_count(self) -> int:
        return len(self._pending)

    async def call(
        self,
        *,
        call_id: str,
        name: str,
        args: dict[str, Any],
    ) -> Any:
        if self._closed:
            return {"ok": False, "error": "La sesión de voz está cerrada."}
        if call_id in self._pending:
            return {"ok": False, "error": "La llamada de herramienta está duplicada."}

        epoch = self._epoch
        future = asyncio.get_running_loop().create_future()
        self._pending[call_id] = _PendingCall(epoch=epoch, future=future)
        await self._send_json(
            {
                "type": "tool_call",
                "call_id": call_id,
                "epoch": epoch,
                "name": name,
                "args": args,
            }
        )
        try:
            return await asyncio.wait_for(future, timeout=self._timeout_seconds)
        except TimeoutError:
            return {
                "ok": False,
                "error": f"La herramienta {name} excedió el tiempo de respuesta.",
            }
        finally:
            self._pending.pop(call_id, None)

    def resolve(self, *, call_id: str, epoch: int, result: Any) -> bool:
        pending = self._pending.get(call_id)
        if (
            pending is None
            or pending.epoch != epoch
            or epoch != self._epoch
            or pending.future.done()
        ):
            return False
        pending.future.set_result(result)
        return True

    def advance_epoch(self) -> int:
        self._epoch += 1
        for call in tuple(self._pending.values()):
            if call.epoch < self._epoch and not call.future.done():
                call.future.cancel()
        return self._epoch

    def close(self) -> None:
        self._closed = True
        for call in tuple(self._pending.values()):
            if not call.future.done():
                call.future.cancel()
        self._pending.clear()


class BrowserProxyTool(BaseTool):
    """ADK tool whose execution is delegated to the current browser session."""

    def __init__(
        self,
        descriptor: BrowserToolDescriptor,
        broker: BrowserToolBroker,
    ) -> None:
        super().__init__(
            name=descriptor.name,
            description=descriptor.description,
            response_scheduling=types.FunctionResponseScheduling.WHEN_IDLE,
        )
        self._descriptor = descriptor
        self._broker = broker

    def _get_declaration(self) -> types.FunctionDeclaration:
        return types.FunctionDeclaration(
            name=self.name,
            description=self.description,
            parameters_json_schema=self._descriptor.inputSchema
            or {"type": "object", "properties": {}},
            behavior=types.Behavior.NON_BLOCKING,
        )

    async def run_async(
        self,
        *,
        args: dict[str, Any],
        tool_context: ToolContext,
    ) -> Any:
        required = (self._descriptor.inputSchema or {}).get("required", [])
        missing = [name for name in required if name not in args]
        if missing:
            return {
                "ok": False,
                "error": "Faltan entradas requeridas: " + ", ".join(missing),
            }
        call_id = tool_context.function_call_id
        if not call_id:
            return {
                "ok": False,
                "error": "ADK no proporcionó un identificador para la herramienta.",
            }
        return await self._broker.call(
            call_id=call_id,
            name=self.name,
            args=args,
        )


def build_browser_tools(
    descriptors: list[BrowserToolDescriptor],
    broker: BrowserToolBroker,
) -> list[BrowserProxyTool]:
    return [BrowserProxyTool(descriptor, broker) for descriptor in descriptors]
