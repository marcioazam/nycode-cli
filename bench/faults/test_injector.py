"""Each scenario of the injector answers with the right HTTP/SSE shape (served for real on loopback)."""

import http.client
import json
from typing import Any

import injector as inj
import pytest

TOOLS = [{"name": "Read", "input_schema": {"properties": {"file_path": {}}}}]


def body(turn: int = 0, case: str = "x", *, tools: bool = True) -> dict[str, Any]:
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": f"contract-case:{case}"}
    ]
    messages += [{"role": "assistant", "content": "a"}] * turn
    return {
        "model": "m",
        "stream": True,
        "messages": messages,
        **({"tools": TOOLS} if tools else {}),
    }


def test_read_step_uses_declared_tool_and_path_key() -> None:
    step = inj.read_step(body())
    assert (step.tool_name, dict(step.tool_input)) == (
        "Read",
        {"file_path": "probe.txt"},
    )
    pi_tools = {
        "tools": [{"name": "read", "input_schema": {"properties": {"path": {}}}}]
    }
    assert dict(inj.read_step(pi_tools).tool_input) == {"path": "probe.txt"}
    assert inj.read_step({}).tool_name == "read"
    assert inj.read_step({"tools": [{"name": "zed"}]}).tool_name == "zed"


def test_rate_limit_first_then_normal() -> None:
    first = inj.reply("rate-limit", 0, 0, body(), "b")
    assert first.status == 429
    assert ("retry-after", "1") in first.headers
    assert b"rate_limit_error" in first.body
    assert inj.reply("rate-limit", 1, 0, body(), "b").status == 200


def test_overloaded() -> None:
    out = inj.reply("overloaded", 0, 0, body(), "b")
    assert out.status == 529
    assert json.loads(out.body)["error"]["type"] == "overloaded_error"


def test_mid_stream_cut_has_no_message_stop() -> None:
    out = inj.reply("mid-stream-cut", 0, 0, body(), "b")
    assert out.status == 200
    assert out.cut
    assert b"content_block_delta" in out.body
    assert b"message_stop" not in out.body
    assert not inj.reply("mid-stream-cut", 1, 0, body(), "b").cut


def test_slow_first_byte() -> None:
    assert inj.reply("slow-first-byte", 0, 0, body(), "b").delay_s == inj.SLOW_S
    assert inj.reply("slow-first-byte", 1, 0, body(), "b").delay_s == 0


def test_malformed_sse_has_unparseable_data_line() -> None:
    out = inj.reply("malformed-sse", 0, 0, body(), "b")
    bad = [
        line[6:]
        for line in out.body.decode().splitlines()
        if line.startswith("data: ") and not _parses(line[6:])
    ]
    assert len(bad) == 1


def _parses(text: str) -> bool:
    try:
        json.loads(text)
    except ValueError:
        return False
    return True


def test_bad_tool_json_streams_unparseable_input() -> None:
    out = inj.reply("bad-tool-json", 0, 0, body(), "b").body.decode()
    deltas = [
        json.loads(line[6:])["delta"]["partial_json"]
        for line in out.splitlines()
        if line.startswith("data: ") and "input_json_delta" in line
    ]
    assert deltas == [inj.BAD_JSON]
    assert not _parses(deltas[0])


def test_unknown_tool_then_final_text() -> None:
    out = inj.reply("unknown-tool", 0, 0, body(), "b")
    assert inj.UNKNOWN_TOOL.encode() in out.body
    done = inj.reply("unknown-tool", 1, 1, body(1), "b")
    assert inj.FINAL.encode() in done.body


@pytest.mark.parametrize("scenario", inj.SCENARIOS)
def test_final_turn_is_plain_text_for_every_scenario(scenario: str) -> None:
    out = inj.reply(scenario, 5, 1, body(1), "b")
    assert out.status == 200 and inj.FINAL.encode() in out.body and out.delay_s == 0


def post(port: int, payload: dict[str, Any]) -> tuple[int, bytes]:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    conn.request("POST", "/v1/messages", json.dumps(payload))
    resp = conn.getresponse()
    data = resp.read()
    conn.close()
    return resp.status, data


def test_server_counts_tool_requests_and_answers_helpers_with_text() -> None:
    with inj.FaultApi() as api:
        assert post(api.port, body(case="overloaded"))[0] == 529
        status, data = post(api.port, body(case="overloaded"))
        assert status == 200 and b"tool_use" in data
        status, data = post(api.port, body(case="overloaded", tools=False))
        assert inj.FINAL.encode() in data
        assert (api.count("overloaded"), api.total("overloaded")) == (2, 3)
        assert api.count("rate-limit") == 0


def test_server_cut_closes_without_message_stop() -> None:
    with inj.FaultApi() as api:
        _, data = post(api.port, body(case="mid-stream-cut"))
        assert b"message_start" in data and b"message_stop" not in data


def test_port_before_start_raises_and_stop_twice_is_safe() -> None:
    api = inj.FaultApi()
    with pytest.raises(RuntimeError):
        _ = api.port
    api.stop()
