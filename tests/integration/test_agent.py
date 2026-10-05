"""Deterministic checks for the ADK topology. No model call is made."""

from agent.agent import MODEL_ID, TURN_AGENT_INSTRUCTION, catalog_agent, root_agent
from agent.live_agent import LIVE_AGENT_INSTRUCTION, LIVE_MODEL_ID, create_live_agent


def test_root_delegates_without_business_tools() -> None:
    assert root_agent.name == "search_to_sale_orchestrator"
    assert root_agent.tools == []
    assert [agent.name for agent in root_agent.sub_agents] == ["catalog_agent"]


def test_all_agents_use_approved_model() -> None:
    assert MODEL_ID == "gemini-3.8-flash"
    assert root_agent.model.model == MODEL_ID
    assert catalog_agent.model.model == MODEL_ID


def test_catalog_agent_has_no_server_side_catalog_tools() -> None:
    assert catalog_agent.tools == []


def test_live_agent_uses_extended_thinking_model() -> None:
    live_agent = create_live_agent([])

    assert LIVE_MODEL_ID == "gemini-3.8-live-extended-thinking"
    assert live_agent.model.model == LIVE_MODEL_ID
    assert (
        live_agent.generate_content_config.thinking_config.thinking_level.value
        == "MEDIUM"
    )


def test_agents_delegate_handoff_decisions_to_the_model() -> None:
    for instruction in (TURN_AGENT_INSTRUCTION, LIVE_AGENT_INSTRUCTION):
        assert "request_advisor_handoff" in instruction
        assert "puedes sugerirla" in instruction
        assert "criterio" in instruction


def test_agents_guide_nontechnical_users_in_plain_language() -> None:
    for instruction in (TURN_AGENT_INSTRUCTION, LIVE_AGENT_INSTRUCTION):
        assert "no conoce medidas" in instruction
        assert "una sola pregunta clara" in instruction
        assert "preguntas generales" in instruction
        assert "No selecciones un producto solo porque lo recomendaste" in instruction


def test_agents_require_discovery_and_exact_ids() -> None:
    for instruction in (TURN_AGENT_INSTRUCTION, LIVE_AGENT_INSTRUCTION):
        assert "discover_catalog" in instruction
        assert "uiState.discoveries" in instruction
        assert "applicationId" in instruction
        assert "Nunca inventes IDs" in instruction
        assert "Compara semánticamente" in instruction


def test_agents_use_direct_commercial_language_with_tool_evidence() -> None:
    for instruction in (TURN_AGENT_INSTRUCTION, LIVE_AGENT_INSTRUCTION):
        assert "sin calificativos ni" in instruction
        assert "advertencias rutinarias" in instruction
        assert "únicamente cuando su herramienta lo acredite" in instruction
        assert "cotización informativa" not in instruction.lower()
        assert "no constituye una reserva" not in instruction.lower()


def test_agents_stage_payment_without_collecting_card_data() -> None:
    for instruction in (TURN_AGENT_INSTRUCTION, LIVE_AGENT_INSTRUCTION):
        assert "start_card_checkout" in instruction
        assert "get_payment_status" in instruction
        assert "Nunca solicites número de tarjeta" in instruction
        assert "No inventes coordenadas" in instruction
        assert "sin calificativos" in instruction


def test_agents_verify_payment_events_before_announcing_success() -> None:
    for instruction in (TURN_AGENT_INSTRUCTION, LIVE_AGENT_INSTRUCTION):
        assert "event.type=payment_status_changed" in instruction
        assert "consulta get_payment_status con ese ID" in instruction
        assert "no anuncies un pago realizado" in instruction
