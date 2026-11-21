"""Fuzz do parser do guard (check_bash): nunca lança, termina rápido, deny estável sob espaços extras.

Roda em pytest/unittest com PRNG semeado (determinístico, ~segundos). O harness atheris é opcional:
python3 test_guard_fuzz.py -atheris_runs=100000 (exige `pip install atheris`, fora do lockfile de CI).
"""

import importlib.util
import os
import random
import sys
import time
import unittest

_GUARD = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "resources", "hooks", "guard.py"
)
_spec = importlib.util.spec_from_file_location("guard", _GUARD)
assert _spec is not None and _spec.loader is not None
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)

TOKENS = [
    "rm", "-rf", "-r", "/", "~", "git", "push", "--force", "main", "reset", "--hard", "sudo", "kill", "pkill",
    "-f", "curl", "http://x", "|", "sh", "bash", "-c", "'", '"', "$(", ")", "`", ";", "&&", "||", "\\\n", "<<EOF",
    "EOF", "dd", "of=/dev/sda", "chmod", "-R", "777", "cat", ".env", ">", "&", "(", "{", ":", "\x00", "é", "$",
]  # fmt: skip
MAX_LEN = 4096
BUDGET_S = 2.0  # por entrada ≤ 4 KB


def gen(rng: random.Random) -> str:
    if rng.random() < 0.2:
        return "".join(
            rng.choice("ab '\"$()`;|&\\\n<>{}-/.=") for _ in range(rng.randint(0, 300))
        )
    return " ".join(rng.choice(TOKENS) for _ in range(rng.randint(0, 40)))[:MAX_LEN]


def denies(cmd: str) -> bool:
    return any(lvl == "deny" for lvl, _ in guard.check_bash(cmd, "/tmp"))


class GuardFuzz(unittest.TestCase):
    def test_never_raises_and_terminates(self) -> None:
        rng = random.Random(1234)
        for _ in range(1500):
            cmd = gen(rng)
            t0 = time.monotonic()
            guard.check_bash(cmd, "/tmp")
            self.assertLess(time.monotonic() - t0, BUDGET_S, repr(cmd))

    def test_deep_nesting_is_bounded(self) -> None:
        cmd = "$(" * 500 + "rm -rf /" + ")" * 500
        t0 = time.monotonic()
        guard.check_bash(cmd, "/tmp")
        self.assertLess(time.monotonic() - t0, BUDGET_S)

    def test_deny_stable_under_extra_spaces(self) -> None:
        rng = random.Random(99)
        for _ in range(1500):
            toks = [rng.choice(TOKENS) for _ in range(rng.randint(1, 12))]
            plain = " ".join(toks)
            spaced = ("  " * rng.randint(1, 3)).join(toks)
            if (
                "'" in plain
                or '"' in plain
                or "<<" in plain
                or "\\" in plain
                or "`" in plain
            ):
                continue  # espaço dentro de aspas/heredoc muda a semântica de propósito
            self.assertEqual(denies(plain), denies(spaced), repr(plain))

    def test_known_deny_survives_spacing(self) -> None:
        for cmd in ("rm -rf /", "rm   -rf    /", "  rm\t-rf /  "):
            self.assertTrue(denies(cmd), repr(cmd))


def _atheris_main() -> None:
    import atheris  # type: ignore[import-untyped]  # sem stubs publicados; harness opcional

    def one(data: bytes) -> None:
        guard.check_bash(data[:MAX_LEN].decode("utf-8", "replace"), "/tmp")

    atheris.Setup(sys.argv, one)
    atheris.Fuzz()


if __name__ == "__main__":
    if any(a.startswith("-atheris_runs") for a in sys.argv):
        _atheris_main()
    else:
        unittest.main()
