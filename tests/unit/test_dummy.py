"""Small deterministic smoke test for the generated test package."""

from agent.agent import app


def test_app_name() -> None:
    assert app.name == "agent"
