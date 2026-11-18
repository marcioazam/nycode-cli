"""Unit tests of the scripted fake Messages API, through a stdlib HTTP client."""

import http.client
import json
from pathlib import Path
from typing import Any

import pytest
from fake_api import FakeApi, Step, route, sse_events

SCRIPT = {
    "c1": [Step(tool_name="bash", tool_input={"command": "echo ok"}), Step(text="fim")]
}


def post(
    port: int, body: dict[str, Any], path: str = "/v1/messages"
) -> tuple[str, str]:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    try:
        conn.request(
            "POST",
            "/v1/messages",
            json.dumps(body),
            {"content-type": "application/json", "authorization": "Bearer segredo"},
        )
        response = conn.getresponse()
        if response.status >= 400:
            raise RuntimeError(f"http {response.status}")
        return response.headers["content-type"], response.read().decode()
    finally:
        conn.close()


def events(stream: str) -> list[dict[str, Any]]:
    return [
        json.loads(line[6:])
        for line in stream.splitlines()
        if line.startswith("data: ")
    ]


def user(text: str) -> dict[str, Any]:
    return {"role": "user", "content": [{"type": "text", "text": text}]}


def test_tool_turn_then_text_turn_and_capture_without_headers(tmp_path: Path) -> None:
    first: dict[str, Any] = {
        "model": "m",
        "stream": True,
        "messages": [user("contract-case:c1")],
    }
    with FakeApi(SCRIPT, tmp_path) as api:
        ctype, stream = post(api.port, first)
        got = events(stream)
        block = got[1]["content_block"]
        second = {
            **first,
            "messages": [
                *first["messages"],
                {"role": "assistant", "content": [block]},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": block["id"],
                            "content": "ok",
                        }
                    ],
                },
            ],
        }
        final = events(post(api.port, second)[1])
        assert len(api.requests("c1")) == 2
    assert ctype == "text/event-stream"
    assert [e["type"] for e in got] == [
        "message_start",
        "content_block_start",
        "content_block_delta",
        "content_block_stop",
        "message_delta",
        "message_stop",
    ]
    assert (block["type"], block["name"]) == ("tool_use", "bash")
    assert json.loads(got[2]["delta"]["partial_json"]) == {"command": "echo ok"}
    assert got[4]["delta"]["stop_reason"] == "tool_use"
    assert final[2]["delta"] == {"type": "text_delta", "text": "fim"}
    assert final[4]["delta"]["stop_reason"] == "end_turn"
    saved = sorted(tmp_path.glob("req-*.json"))
    assert [p.name for p in saved] == ["req-000-c1.json", "req-001-c1.json"]
    assert "segredo" not in "".join(p.read_text() for p in saved)


def test_unrouted_past_script_and_non_stream_answers() -> None:
    with FakeApi(SCRIPT) as api:
        port = api.port
        ctype, raw = post(port, {"model": "m", "messages": [user("sem marcador")]})
        assert ctype == "application/json"
        assert json.loads(raw)["content"] == [{"type": "text", "text": "ok"}]
        tool = json.loads(post(port, {"messages": [user("contract-case:c1")]})[1])
        assert tool["stop_reason"] == "tool_use"
        assert tool["content"][0]["input"] == {"command": "echo ok"}
        assert len(api.requests("")) == 1
        assert api.step_for("c1", 5) == Step()
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        conn.request("GET", "/")
        assert conn.getresponse().status >= 400
        conn.close()
    with pytest.raises(OSError):  # clean shutdown: the port no longer answers
        post(port, {"messages": []})
    api.stop()  # idempotent
    with pytest.raises(RuntimeError):
        _ = api.port


def test_route_and_record_tolerate_odd_bodies() -> None:
    assert route({}) == ("", 0)
    assert route(
        {"messages": [user("contract-case:t-Read"), {"role": "assistant"}, "x"]}
    ) == ("t-Read", 1)
    api = FakeApi({})
    assert api.record(b"not json")[:3] == ({}, "", 0)
    assert api.record(b"[1]")[3] == 1
    assert b"text_delta" in sse_events(Step(text="a"), "m", "id")


def test_hits_carry_size_and_monotonic_times() -> None:
    with FakeApi(SCRIPT) as api:
        post(api.port, {"stream": True, "messages": [user("contract-case:c1")]})
        (hit,) = api.hits
    assert (hit.case, hit.turn) == ("c1", 0)
    assert hit.size > 0
    assert 0 < hit.arrived <= hit.done


def test_done_is_stored_before_the_answer_reaches_the_client() -> None:
    with FakeApi(SCRIPT) as api:
        for _ in range(
            200
        ):  # the client reads the answer and checks at once; a later store would lose the race
            post(api.port, {"stream": True, "messages": [user("contract-case:c1")]})
            assert api.hits[-1].done > 0
