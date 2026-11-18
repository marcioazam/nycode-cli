"""Scripted fake of the Anthropic Messages API for harness contract checks (no model, no network).

Each POST body is captured (never the headers, so no credential is stored) and answered with a valid
streaming response taken from a script. Routing is stateless, so parallel clients cannot mix up: the case
is the ``contract-case:<id>`` marker found in the request messages and the turn is the number of assistant
messages already in the conversation.
"""

from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import TYPE_CHECKING, Any, Self

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence
    from pathlib import Path

MARKER = re.compile(r"contract-case:([A-Za-z0-9_.-]+)")
UNROUTED = ""


@dataclass(frozen=True)
class Step:
    """One scripted assistant turn: a ``tool_use`` block when ``tool_name`` is set, else final text."""

    text: str = "ok"
    tool_name: str | None = None
    tool_input: Mapping[str, object] = field(default_factory=dict)


@dataclass
class Hit:
    """One request as the server saw it: body size and ``time.monotonic()`` of arrival and of the end of the answer."""

    seq: int
    case: str
    turn: int
    size: int
    arrived: float
    done: float = 0.0


def route(body: Mapping[str, Any]) -> tuple[str, int]:
    """Return ``(case id, turn index)`` for a request body; unmarked requests go to ``UNROUTED``."""
    messages = body.get("messages")
    if not isinstance(messages, list):
        return UNROUTED, 0
    found = MARKER.search(json.dumps(messages))
    turn = sum(
        1 for m in messages if isinstance(m, dict) and m.get("role") == "assistant"
    )
    return (found.group(1) if found else UNROUTED), turn


def message_content(step: Step, block_id: str) -> list[dict[str, object]]:
    """Content blocks of the assistant message a step stands for."""
    if step.tool_name is None:
        return [{"type": "text", "text": step.text}]
    return [
        {
            "type": "tool_use",
            "id": block_id,
            "name": step.tool_name,
            "input": dict(step.tool_input),
        }
    ]


def _event(name: str, data: dict[str, object]) -> bytes:
    return f"event: {name}\ndata: {json.dumps({'type': name, **data})}\n\n".encode()


def sse_events(step: Step, model: str, block_id: str) -> bytes:
    """Serialize a step as the Anthropic streaming event sequence."""
    usage = {"input_tokens": 1, "output_tokens": 1}
    message: dict[str, object] = {
        "id": f"msg_{block_id}",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": [],
        "stop_reason": None,
        "stop_sequence": None,
        "usage": usage,
    }
    block = message_content(step, block_id)[0]
    start: dict[str, object]
    delta: dict[str, object]
    if step.tool_name is None:
        start = {"type": "text", "text": ""}
        delta = {"type": "text_delta", "text": step.text}
        stop_reason = "end_turn"
    else:
        start = {**block, "input": {}}
        delta = {
            "type": "input_json_delta",
            "partial_json": json.dumps(dict(step.tool_input)),
        }
        stop_reason = "tool_use"
    return b"".join(
        [
            _event("message_start", {"message": message}),
            _event("content_block_start", {"index": 0, "content_block": start}),
            _event("content_block_delta", {"index": 0, "delta": delta}),
            _event("content_block_stop", {"index": 0}),
            _event(
                "message_delta",
                {
                    "delta": {"stop_reason": stop_reason, "stop_sequence": None},
                    "usage": {"output_tokens": 1},
                },
            ),
            _event("message_stop", {}),
        ]
    )


class FakeApi:
    """Local server on an ephemeral port; use as a context manager."""

    def __init__(
        self, scripts: Mapping[str, Sequence[Step]], capture_dir: Path | None = None
    ) -> None:
        """Take ``scripts`` (case id to turns) and an optional directory that receives every body."""
        self._scripts = scripts
        self._capture_dir = capture_dir
        self._lock = threading.Lock()
        self._captured: dict[str, list[dict[str, Any]]] = {}
        self._count = 0
        self.hits: list[Hit] = []
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    @property
    def port(self) -> int:
        """Bound port; only valid between ``start`` and ``stop``."""
        if self._server is None:
            raise RuntimeError("server not started")
        return self._server.server_address[1]

    def requests(self, case: str) -> list[dict[str, Any]]:
        """Captured bodies of one case, in arrival order."""
        with self._lock:
            return list(self._captured.get(case, []))

    def step_for(self, case: str, turn: int) -> Step:
        """Scripted step of a turn; past the end of a script (or unrouted) it is plain final text."""
        steps = self._scripts.get(case, ())
        return steps[turn] if turn < len(steps) else Step()

    def record(self, raw: bytes) -> tuple[dict[str, Any], str, int, int]:
        """Store one body; return ``(body, case, turn, sequence number)``."""
        try:
            parsed = json.loads(raw or b"{}")
        except ValueError:
            parsed = {}
        body: dict[str, Any] = parsed if isinstance(parsed, dict) else {}
        case, turn = route(body)
        with self._lock:
            seq = self._count
            self._count += 1
            self._captured.setdefault(case, []).append(body)
            self.hits.append(Hit(seq, case, turn, len(raw), time.monotonic()))
        if self._capture_dir is not None:
            (
                self._capture_dir / f"req-{seq:03d}-{case or 'unrouted'}.json"
            ).write_bytes(raw)
        return body, case, turn, seq

    def start(self) -> int:
        """Bind 127.0.0.1 on an ephemeral port, serve in a daemon thread and return the port."""
        api = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = (
                "HTTP/1.0"  # connection closes after each answer: no chunking needed
            )

            def do_POST(self) -> None:
                raw = self.rfile.read(int(self.headers.get("content-length", 0)))
                body, case, turn, seq = api.record(raw)
                step = api.step_for(case, turn)
                model = str(body.get("model", "fake"))
                block_id = f"toolu_contract{seq:04d}"
                if body.get("stream"):
                    payload, ctype = (
                        sse_events(step, model, block_id),
                        "text/event-stream",
                    )
                else:
                    message = {
                        "id": f"msg_{block_id}",
                        "type": "message",
                        "role": "assistant",
                        "model": model,
                        "content": message_content(step, block_id),
                        "stop_reason": "end_turn"
                        if step.tool_name is None
                        else "tool_use",
                        "stop_sequence": None,
                        "usage": {"input_tokens": 1, "output_tokens": 1},
                    }
                    payload, ctype = json.dumps(message).encode(), "application/json"
                self.send_response(200)
                self.send_header("content-type", ctype)
                self.send_header("content-length", str(len(payload)))
                self.end_headers()
                # Before the final write: the client may read the answer and call back before a later store runs.
                api.hits[seq].done = time.monotonic()
                self.wfile.write(payload)
                self.wfile.flush()

            def do_GET(self) -> None:
                self.send_error(404)

            def log_message(self, format: str, *args: object) -> None:
                """Stay silent: the captured bodies are the log."""

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return self.port

    def stop(self) -> None:
        """Stop serving and release the port; safe to call twice."""
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
