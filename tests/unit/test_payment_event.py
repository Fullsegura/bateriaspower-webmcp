import pytest
from pydantic import ValidationError

from agent.fast_api_app import OrchestrateRequest


def test_payment_event_survives_orchestration_envelope() -> None:
    event = {"type": "payment_status_changed", "transactionId": "payment-test"}
    request = OrchestrateRequest(
        sessionId="session", messages=[], tools=[], uiState={}, event=event
    )
    assert request.model_dump(mode="json")["event"] == event
    assert request.messages == []


@pytest.mark.parametrize("event", [
    {"type": "payment_status_changed", "transactionId": ""},
    {"type": "unrecognized_event", "transactionId": "payment-test"},
])
def test_payment_event_requires_valid_contract(event: dict) -> None:
    with pytest.raises(ValidationError):
        OrchestrateRequest(
            sessionId="session", messages=[], tools=[], uiState={}, event=event
        )
