"""Fault-injecting fake of the Anthropic Messages API: one scenario per run, keyed by ``contract-case:<scenario>``.

Reuses ``bench/contract/fake_api`` for routing, capture and the SSE serializer. The script is: turn 0 asks for one
trivial ``read`` of ``probe.txt``, later turns answer ``FINAL``. The fault hits the first request that declares tools
(``--arms`` also send tool-less helper calls, e.g. titles; those always get plain text).
"""

from __future__ import annotations

import json
import sys
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING, Any, Self

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "contract"))
from fake_api import FakeApi, Step, sse_events  # type: ignore[import-not-found]  # sibling dir, path set above

if TYPE_CHECKING:
    from collections.abc import Mapping

FINAL = "FAULTS-DONE-7731"
SCENARIOS = (
    "rate-limit",
    "overloaded",
    "mid-stream-cut",
    "slow-first-byte",
    "malformed-sse",
    "bad-tool-json",
    "unknown-tool",
)
RETRY_AFTER_S = 1
SLOW_S = 8.0
UNKNOWN_TOOL = "no_such_tool"
BAD_JSON = '{"path": '
CUT_EVENTS = (
    3  # message_start, content_block_start, first delta: then the socket closes
)


@dataclass(frozen=True)
class Reply:
    """What the server sends: status, headers, body, a delay before the first byte and a hard cut."""

    status: int = 200
    headers: tuple[tuple[str, str], ...] = ()
    body: bytes = b""
    delay_s: float = 0.0
    cut: bool = False  # no content-length; the connection just closes after ``body``


def read_step(body: Mapping[str, Any]) -> Step:
    """Tool turn that reads ``probe.txt`` with whichever read tool (and path key) the harness declared."""
    tools = [t for t in body.get("tools") or [] if isinstance(t, dict)]
    chosen = next((t for t in tools if str(t.get("name", "")).lower() == "read"), None)
    if chosen is None:
        return Step(tool_name=str(tools[0]["name"]) if tools else "read")
    props = (chosen.get("input_schema") or {}).get("properties") or {}
    key = "file_path" if "file_path" in props else "path"
    return Step(tool_name=str(chosen["name"]), tool_input={key: "probe.txt"})


def _sse(step: Step, body: Mapping[str, Any], block_id: str) -> bytes:
    return bytes(sse_events(step, str(body.get("model", "fake")), block_id))


def reply(
    scenario: str, nth: int, turn: int, body: Mapping[str, Any], block_id: str
) -> Reply:
    """Answer to the ``nth`` (0-based) tool-bearing request of a scenario at conversation ``turn``."""
    first = nth == 0
    step = read_step(body) if turn == 0 else Step(FINAL)
    headers = (("content-type", "text/event-stream"),)
    if first and scenario == "rate-limit":
        return _error(429, "rate_limit_error", (("retry-after", str(RETRY_AFTER_S)),))
    if first and scenario == "overloaded":
        return _error(529, "overloaded_error")
    stream = _sse(step, body, block_id)
    if first and scenario == "mid-stream-cut":
        head = b"\n\n".join(stream.split(b"\n\n")[:CUT_EVENTS]) + b"\n\n"
        return Reply(headers=headers, body=head, cut=True)
    if first and scenario == "slow-first-byte":
        return Reply(headers=headers, body=stream, delay_s=SLOW_S)
    if first and scenario == "malformed-sse":
        head, _, rest = stream.partition(b"\n\n")
        junk = b'event: content_block_delta\ndata: {"type": "content_block_delta", "index": 0, "delta": \n\n'
        return Reply(headers=headers, body=head + b"\n\n" + junk + rest)
    if turn == 0 and scenario == "bad-tool-json":
        good = json.dumps(json.dumps(dict(step.tool_input))).encode()
        return Reply(
            headers=headers, body=stream.replace(good, json.dumps(BAD_JSON).encode())
        )
    if turn == 0 and scenario == "unknown-tool":
        return Reply(
            headers=headers, body=_sse(Step(tool_name=UNKNOWN_TOOL), body, block_id)
        )
    return Reply(headers=headers, body=stream)


def _error(status: int, kind: str, headers: tuple[tuple[str, str], ...] = ()) -> Reply:
    payload = {"type": "error", "error": {"type": kind, "message": kind}}
    return Reply(
        status=status,
        headers=(("content-type", "application/json"), *headers),
        body=json.dumps(payload).encode(),
    )


class FaultApi:
    """Local server on an ephemeral port; use as a context manager."""

    def __init__(self) -> None:
        """Start with no requests seen."""
        self._rec = FakeApi({})
        self._lock = threading.Lock()
        self._tooled: dict[str, int] = {}
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    @property
    def port(self) -> int:
        """Bound port; only valid while serving."""
        if self._server is None:
            raise RuntimeError("server not started")
        return self._server.server_address[1]

    def count(self, scenario: str) -> int:
        """Requests with tools received for a scenario (a retry shows up as an extra one)."""
        with self._lock:
            return self._tooled.get(scenario, 0)

    def total(self, scenario: str) -> int:
        """Every request received for a scenario, helper calls included."""
        return len(self._rec.requests(scenario))

    def answer(self, raw: bytes) -> Reply:
        """Record one request body and compute the reply."""
        body, case, turn, seq = self._rec.record(raw)
        if not body.get("tools"):
            return Reply(
                headers=(("content-type", "text/event-stream"),),
                body=_sse(Step(FINAL), body, f"toolu_faults{seq:04d}"),
            )
        with self._lock:
            nth = self._tooled.get(case, 0)
            self._tooled[case] = nth + 1
        return reply(case, nth, turn, body, f"toolu_faults{seq:04d}")

    def start(self) -> int:
        """Serve in a daemon thread; return the port."""
        api = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.0"

            def do_POST(self) -> None:
                raw = self.rfile.read(int(self.headers.get("content-length", 0)))
                out = api.answer(raw)
                time.sleep(out.delay_s)
                self.send_response(out.status)
                for name, value in out.headers:
                    self.send_header(name, value)
                if not out.cut:
                    self.send_header("content-length", str(len(out.body)))
                self.end_headers()
                self.wfile.write(out.body)
                self.wfile.flush()

            def log_message(self, format: str, *args: object) -> None:
                """Stay silent."""

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return self.port

    def stop(self) -> None:
        """Stop serving; safe to call twice."""
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    def __enter__(self) -> Self:
        """Start the server."""
        self.start()
        return self

    def __exit__(self, *exc: object) -> None:
        """Stop the server."""
        self.stop()
