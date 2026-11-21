"""Oracle of the native permission engine's differential test (K11, test/harness/permissions/).

`oracle.py corpus` prints every string literal of the guard's own test files as a JSON list, the inputs the TypeScript
port must judge like guard.py. `oracle.py decide` reads a JSON list of `{tool, input, cwd}` from stdin and prints the
guard.py verdict of each: `null` (allow) or `[decision, reason]`, or `["error", text]` when guard.py raises.
"""

import ast
import importlib.util
import json
import os
import sys
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
HOOKS_TESTS = os.path.join(HERE, "..", "hooks")
GUARD = os.path.join(HERE, "..", "..", "..", "resources", "hooks", "guard.py")
SOURCES = [os.path.join(HOOKS_TESTS, "test_guard.py"), os.path.join(HOOKS_TESTS, "fuzz", "test_guard_fuzz.py")]


def corpus() -> list[str]:
    seen: dict[str, None] = {}
    for path in SOURCES:
        with open(path, encoding="utf-8") as f:
            tree = ast.parse(f.read())
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and len(node.value) <= 4096:
                seen.setdefault(node.value)
    return list(seen)


def decide(cases: list[dict[str, Any]]) -> list[Any]:
    spec = importlib.util.spec_from_file_location("guard", GUARD)
    assert spec is not None and spec.loader is not None
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)
    out: list[Any] = []
    for case in cases:
        payload = {"tool_name": case["tool"], "tool_input": case["input"], "cwd": case["cwd"]}
        try:
            result = guard.decide(payload)
            out.append(None if result is None else list(result))
        except Exception as e:  # noqa: BLE001  # the guard's own main() swallows these; report them
            out.append(["error", type(e).__name__])
    return out


if __name__ == "__main__":
    if sys.argv[1:] == ["corpus"]:
        json.dump(corpus(), sys.stdout)
    elif sys.argv[1:] == ["decide"]:
        json.dump(decide(json.load(sys.stdin)), sys.stdout)
    else:
        sys.exit("usage: oracle.py corpus|decide")
