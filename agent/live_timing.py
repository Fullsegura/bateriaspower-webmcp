"""Session-local timing only; never changes model content or tool scheduling."""

from __future__ import annotations

import logging
import math
import time
from collections.abc import Callable

logger = logging.getLogger(__name__)


class LiveTiming:
    def __init__(self, session_id: str, clock: Callable[[], float] = time.monotonic):
        self.session_id = session_id
        self.clock = clock
        self.calls: dict[str, dict] = {}

    def mark(self, call_id: str, stage: str, **fields) -> None:
        if not call_id:
            return
        if call_id not in self.calls:
            if len(self.calls) >= 128:
                self.calls.pop(next(iter(self.calls)))
            self.calls[call_id] = {}
        call = self.calls[call_id]
        if stage in call:
            return
        call[stage] = self.clock() * 1000
        logger.info("live_timing session=%s call=%s stage=%s monotonic_ms=%.3f wall_ms=%.3f fields=%s",
                    self.session_id, call_id, stage, call[stage], time.time() * 1000, fields)

    def first_output(self, channel: str) -> list[dict]:
        result = []
        for call_id, call in self.calls.items():
            stage = f"first_{channel}"
            if "adk_enqueued" not in call or stage in call:
                continue
            self.mark(call_id, stage)
            result.append({"callId": call_id, "channel": channel,
                           "adkToOutputMs": call[stage] - call["adk_enqueued"],
                           "ingressToAdkMs": call["adk_enqueued"] - call.get(
                               "server_received", call.get("tool_finished", call["adk_enqueued"])
                           )})
        return result

    def presented(self, call_id: str, channel: str, elapsed_ms: object) -> None:
        call = self.calls.get(call_id, {})
        if channel not in ("audio", "transcript") or f"first_{channel}" not in call:
            return
        if type(elapsed_ms) not in (int, float) or not math.isfinite(elapsed_ms) or not 0 <= elapsed_ms <= 600_000:
            return
        self.mark(call_id, f"presented_{channel}", browserReceiveToPresentationMs=elapsed_ms)

    def clear(self) -> None:
        self.calls.clear()
