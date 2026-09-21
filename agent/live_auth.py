"""Short-lived authentication tokens for browser voice sessions."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any


def _decode_base64url(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def verify_live_token(
    token: str,
    *,
    session_id: str,
    secret: str,
    now: int | None = None,
) -> bool:
    try:
        encoded_payload, encoded_signature = token.split(".", maxsplit=1)
        expected = hmac.new(
            secret.encode("utf-8"),
            encoded_payload.encode("ascii"),
            hashlib.sha256,
        ).digest()
        signature = _decode_base64url(encoded_signature)
        if not hmac.compare_digest(signature, expected):
            return False
        payload: dict[str, Any] = json.loads(
            _decode_base64url(encoded_payload).decode("utf-8")
        )
        current_time = int(time.time()) if now is None else now
        return payload.get("sid") == session_id and int(payload.get("exp", 0)) >= current_time
    except (ValueError, TypeError, json.JSONDecodeError):
        return False
