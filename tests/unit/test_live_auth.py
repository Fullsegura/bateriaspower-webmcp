from __future__ import annotations

import base64
import hashlib
import hmac
import json

from agent.live_auth import verify_live_token


def _token(*, session_id: str, expires_at: int, secret: str) -> str:
    payload = base64.urlsafe_b64encode(
        json.dumps({"sid": session_id, "exp": expires_at}, separators=(",", ":")).encode()
    ).decode().rstrip("=")
    signature = base64.urlsafe_b64encode(
        hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()
    ).decode().rstrip("=")
    return f"{payload}.{signature}"


def test_verifies_matching_unexpired_token() -> None:
    token = _token(session_id="session-1", expires_at=1_300, secret="secret")

    assert verify_live_token(
        token, session_id="session-1", secret="secret", now=1_000
    )


def test_rejects_expired_wrong_session_and_tampered_tokens() -> None:
    token = _token(session_id="session-1", expires_at=1_300, secret="secret")

    assert not verify_live_token(
        token, session_id="session-1", secret="secret", now=1_301
    )
    assert not verify_live_token(
        token, session_id="session-2", secret="secret", now=1_000
    )
    assert not verify_live_token(
        token + "tampered", session_id="session-1", secret="secret", now=1_000
    )
