"""Transcript parsing and per-run process/speed metrics, from minimal synthetic pi and Claude Code events."""

import json
from typing import Any

from bench.metrics import trace


def pi_text(*events: dict[str, Any]) -> str:
    return "\n".join(json.dumps(e) for e in events)


def p_asst(
    blocks: list[dict[str, Any]], ts: int = 0, dur: int | None = None
) -> dict[str, Any]:
    m: dict[str, Any] = {"role": "assistant", "content": blocks, "timestamp": ts}
    if dur is not None:
        m["durationMs"] = dur
    return {"type": "message_end", "message": m}


def p_call(i: str, name: str, **args: Any) -> dict[str, Any]:
    return {"type": "toolCall", "id": i, "name": name, "arguments": args}


def p_res(i: str, err: bool = False) -> dict[str, Any]:
    return {
        "type": "message_end",
        "message": {"role": "toolResult", "toolCallId": i, "isError": err},
    }


def text(s: str) -> dict[str, Any]:
    return {"type": "text", "text": s}


def cc_asst(mid: str, block: dict[str, Any]) -> dict[str, Any]:
    return {"type": "assistant", "message": {"id": mid, "content": [block]}}


def cc_res(i: str, err: bool = False) -> dict[str, Any]:
    return {
        "type": "user",
        "message": {
            "content": [{"type": "tool_result", "tool_use_id": i, "is_error": err}]
        },
    }


def test_parse_pi_calls_errors_final() -> None:
    t = trace.parse(
        pi_text(
            p_asst([p_call("a", "bash", command="ls")]),
            p_res("a", True),
            p_asst([p_call("b", "bash", command="ls")]),
            p_res("b"),
            p_asst([text("Done.")]),
        )
    )
    assert [c.name for c in t.calls] == ["bash", "bash"]
    assert [c.error for c in t.calls] == [True, False]
    assert t.final == "Done." and t.events == 5 and len(t.turns) == 3


def test_parse_cc_merges_blocks_of_one_message() -> None:
    use = {"type": "tool_use", "id": "x", "name": "Read", "input": {"file_path": "/a"}}
    t = trace.parse(
        pi_text(
            cc_asst("m1", {"type": "thinking"}),
            cc_asst("m1", use),
            cc_res("x", True),
            cc_asst("m2", {"type": "text", "text": "All done"}),
            {"type": "result", "result": "All done"},
        )
    )
    assert (
        len(t.turns) == 2
        and t.calls[0].args == {"file_path": "/a"}
        and t.calls[0].error is True
    )
    assert t.final == "All done"


def test_parse_ignores_garbage_and_empty() -> None:
    t = trace.parse("not json\n\n[1]\n")
    assert t.events == 0 and t.final == "" and t.calls == []


def test_process_counts() -> None:
    t = trace.parse(
        pi_text(
            p_asst([text("thinking out loud")]),
            p_asst([p_call("1", "read", path="a.py")]),
            p_res("1"),
            p_asst([p_call("2", "read", path="a.py")]),
            p_res("2"),
            p_asst([p_call("3", "edit", path="a.py")]),
            p_res("3"),
            p_asst([p_call("4", "read", path="a.py")]),
            p_res("4"),
            p_asst([p_call("5", "bash", command="sleep 90 && make")]),
            p_res("5", True),
            p_asst([p_call("6", "bash", command="sleep 5")]),
            p_res("6"),
            p_asst([p_call("7", "bash", command="make")]),
            p_res("7"),
            p_asst([text("ok")]),
        )
    )
    p = trace.process(t)
    assert p["tool_calls"] == 7 and p["tool_errors"] == 1
    assert p["recovered"] == 1  # the failed bash is followed by a good bash
    assert p["idle_turns"] == 1  # the first text-only turn; the last one ends the run
    assert (
        p["repeat_reads"] == 1
    )  # read 2 repeats read 1; the edit resets, so read 4 does not
    assert p["long_sleeps"] == 1


def test_process_bash_write_resets_reads_and_minutes_sleep() -> None:
    t = trace.parse(
        pi_text(
            p_asst([p_call("1", "Read", file_path="a")]),
            p_res("1"),
            p_asst([p_call("2", "Bash", command="echo x > a")]),
            p_res("2"),
            p_asst([p_call("3", "Read", file_path="a")]),
            p_res("3"),
            p_asst([p_call("4", "Bash", command="sleep 2m")]),
            p_res("4"),
        )
    )
    p = trace.process(t)
    assert p["repeat_reads"] == 0 and p["long_sleeps"] == 1


def test_process_no_calls_has_none_rates() -> None:
    assert trace.process(trace.parse("")) == {}


def test_union_merges_overlaps() -> None:
    assert trace.union([(0, 2), (1, 3), (5, 6), (7, 7)]) == 4


def test_pi_timing() -> None:
    t = trace.parse(
        pi_text(
            {"type": "session", "timestamp": "1970-01-01T00:00:00Z"},
            p_asst([p_call("1", "bash", command="x")], ts=2000, dur=1000),
            {"type": "tool_execution_end", "durationMs": 1500},
            p_asst([text("end")], ts=4000, dur=1000),
        )
    )
    s = trace.speed(t, t0=None, total=6.0)
    assert s == {
        "boot": 2.0,
        "model_s": 2.0,
        "tool_s": 1.0,
    }  # gap 3→4 s caps the tool sum at 1 s


def test_speed_none_without_timestamps() -> None:
    assert (
        trace.speed(trace.parse(pi_text(p_asst([text("x")]))), t0=None, total=1.0) == {}
    )


def test_cc_session_timing(tmp_path: Any) -> None:
    ev: list[dict[str, Any]] = [
        {"type": "api-request", "timestamp": "1970-01-01T00:00:02Z"},
        {
            "type": "assistant",
            "timestamp": "1970-01-01T00:00:04Z",
            "message": {"id": "m", "content": [{"type": "tool_use", "id": "t"}]},
        },
        {
            "type": "user",
            "timestamp": "1970-01-01T00:00:05Z",
            "message": {"content": [{"type": "tool_result", "tool_use_id": "t"}]},
        },
    ]
    f = tmp_path / "s.jsonl"
    f.write_text(pi_text(*ev))
    assert trace.cc_session_speed(f, t0=1.0) == {
        "boot": 1.0,
        "model_s": 2.0,
        "tool_s": 1.0,
    }
    assert trace.cc_session_speed(tmp_path / "none.jsonl", t0=1.0) == {}
