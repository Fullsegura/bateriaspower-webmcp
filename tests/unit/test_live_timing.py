from agent.live_timing import LiveTiming
from agent.live_tools import GeminiExtendedThinkingQueue
from google.genai import types


def test_first_output_tracks_all_completed_calls_once_and_channels_separately():
    now = [1.0]
    timing = LiveTiming("session", lambda: now[0])
    timing.mark("a", "server_received")
    now[0] = 1.1
    timing.mark("a", "adk_enqueued")
    timing.mark("b", "adk_enqueued")
    now[0] = 1.4
    first = timing.first_output("audio")
    assert [entry["callId"] for entry in first] == ["a", "b"]
    assert all(entry["adkToOutputMs"] == 300 for entry in first)
    assert timing.first_output("audio") == []
    assert len(timing.first_output("transcript")) == 2
    timing.presented("a", "audio", 15)
    timing.presented("b", "audio", float("nan"))
    assert "presented_audio" in timing.calls["a"]
    assert "presented_audio" not in timing.calls["b"]
    timing.clear()
    assert timing.first_output("audio") == []


def test_timing_does_not_put_diagnostics_in_model_context():
    ids = []
    queue = GeminiExtendedThinkingQueue(ids.append)
    content = types.Content(parts=[types.Part(function_response=types.FunctionResponse(
        id="adk-call", name="read_battery_catalog", response={"listingId":"verified"}
    ))])
    queue.send_content(content)
    assert ids == ["adk-call"]
    assert content.parts[0].function_response.response == {"listingId":"verified"}
