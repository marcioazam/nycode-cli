"""Valida as suítes S4/S5: oráculo passa, no-op falha, campos do case.json.

Uso: python3 bench/suites/check_oracles.py [--suite plan|multi] [--case ID]
Sai 1 com a lista de problemas.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
SUITES = ("plan", "multi")
KINDS = ("outcome", "ask")
SEED = 20261113
HELDOUT_SHARE = 0.3
MIN_CASES = {"plan": 12, "multi": 10}
PLAN_PREFIX = "Planeje antes de implementar."
RUN_TIMEOUT_S = 180


def validate_fields(case_dir: Path, suite: str) -> tuple[dict[str, Any], list[str]]:
    """Lê e valida o case.json; devolve (dados, problemas)."""
    path = case_dir / "case.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return {}, [f"case.json ilegível: {exc}"]
    if not isinstance(data, dict):
        return {}, ["case.json não é um objeto"]
    out: list[str] = []

    def need(key: str, kind: type | tuple[type, ...]) -> Any:
        value = data.get(key)
        if not isinstance(value, kind) or isinstance(value, bool) != (kind is bool):
            out.append(f"campo '{key}' ausente ou com tipo errado")
            return None
        return value

    if need("id", str) != case_dir.name:
        out.append("id difere do nome do diretório")
    if need("suite", str) != suite:
        out.append(f"suite deve ser '{suite}'")
    kind = need("kind", str)
    if kind not in KINDS:
        out.append(f"kind deve ser um de {KINDS}")
    prompt = need("prompt", str)
    if prompt is not None and not prompt.strip():
        out.append("prompt vazio")
    if (
        suite == "plan"
        and isinstance(prompt, str)
        and not prompt.startswith(PLAN_PREFIX)
    ):
        out.append(f"prompt do plan deve começar com '{PLAN_PREFIX}'")
    t = need("timeout_s", int)
    if t is not None and not 0 < t <= 900:
        out.append("timeout_s deve estar em 1..900")
    b = need("budget_usd", (int, float))
    if b is not None and not 0 < b <= 1.5:
        out.append("budget_usd deve estar em (0, 1.5]")
    if need("split", str) not in ("dev", "heldout"):
        out.append("split deve ser dev ou heldout")
    if need("security", bool) is not False:
        out.append("security deve ser false")
    cmd = need("test_cmd", str)
    if cmd is not None and not cmd.strip():
        out.append("test_cmd vazio")
    terms = data.get("ask_terms")
    if kind == "ask":
        if not (
            isinstance(terms, list)
            and terms
            and all(isinstance(x, str) and x for x in terms)
        ):
            out.append("ask_terms deve ser lista não vazia de textos")
    elif terms is not None:
        out.append("ask_terms só vale para kind=ask")
    if not any(p.is_file() for p in (case_dir / "repo").rglob("*")):
        out.append("repo/ ausente ou vazio")
    if kind == "outcome":
        for sub in ("hidden", "oracle"):
            if not any(p.is_file() for p in (case_dir / sub).rglob("*")):
                out.append(f"{sub}/ ausente ou vazio")
    return data, out


def _run_tests(case_dir: Path, test_cmd: str, *, oracle: bool) -> tuple[int, str]:
    with tempfile.TemporaryDirectory(prefix="oracle-") as tmp:
        work = Path(tmp) / "work"
        shutil.copytree(
            case_dir / "repo", work, ignore=shutil.ignore_patterns("__pycache__")
        )
        if oracle:
            shutil.copytree(case_dir / "oracle", work, dirs_exist_ok=True)
        shutil.copytree(case_dir / "hidden", work / "hidden")
        env = {"PATH": _path(), "PYTHONDONTWRITEBYTECODE": "1", "HOME": tmp}
        try:
            proc = subprocess.run(
                shlex.split(test_cmd),
                cwd=work,
                env=env,
                capture_output=True,
                text=True,
                timeout=RUN_TIMEOUT_S,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return 124, "timeout"
        return proc.returncode, (proc.stdout + proc.stderr)[-600:]


def _path() -> str:
    return os.environ.get("PATH", "/usr/bin:/bin")


def check_case(case_dir: Path, suite: str) -> list[str]:
    """Problemas de um caso (lista vazia = ok)."""
    data, problems = validate_fields(case_dir, suite)
    if problems or data.get("kind") != "outcome":
        return [f"{case_dir.name}: {p}" for p in problems]
    cmd = str(data["test_cmd"])
    code, _ = _run_tests(case_dir, cmd, oracle=False)
    if code == 0:
        problems.append("no-op (repo + hidden) passou; deveria falhar")
    code, tail = _run_tests(case_dir, cmd, oracle=True)
    if code != 0:
        problems.append(f"oráculo falhou (exit {code}): {tail.strip()[-300:]}")
    return [f"{case_dir.name}: {p}" for p in problems]


def expected_heldout(ids: list[str]) -> set[str]:
    """Escolha determinística de 30% dos ids (D14)."""
    ordered = sorted(ids)
    k = round(len(ordered) * HELDOUT_SHARE)
    return set(random.Random(SEED).sample(ordered, k))


def check_suite_split(
    suite_dir: Path, suite: str, *, require_counts: bool
) -> list[str]:
    cases = sorted(p for p in suite_dir.iterdir() if (p / "case.json").is_file())
    problems: list[str] = []
    if require_counts and len(cases) < MIN_CASES[suite]:
        problems.append(f"{suite}: {len(cases)} casos; mínimo {MIN_CASES[suite]}")
    splits: dict[str, str] = {}
    for c in cases:
        try:
            splits[c.name] = str(json.loads((c / "case.json").read_text()).get("split"))
        except (OSError, ValueError):
            continue
    want = expected_heldout(list(splits))
    got = {i for i, s in splits.items() if s == "heldout"}
    if got != want:
        problems.append(
            f"{suite}: heldout {sorted(got)} difere do esperado {sorted(want)}"
        )
    return problems


def run(
    root: Path, suite: str | None, case: str | None, *, require_counts: bool
) -> list[str]:
    problems: list[str] = []
    if case is not None and not any(
        (root / n / case).is_dir() for n in ((suite,) if suite else SUITES)
    ):
        return [f"caso '{case}' não encontrado"]
    for name in (suite,) if suite else SUITES:
        suite_dir = root / name
        if not suite_dir.is_dir():
            problems.append(f"{name}: diretório ausente")
            continue
        for case_dir in sorted(p for p in suite_dir.iterdir() if p.is_dir()):
            if case is None or case_dir.name == case:
                problems += check_case(case_dir, name)
        if case is None:
            problems += check_suite_split(
                suite_dir, name, require_counts=require_counts
            )
    return problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--suite", choices=SUITES)
    ap.add_argument("--case")
    ap.add_argument("--root", type=Path, default=ROOT)
    args = ap.parse_args(argv)
    problems = run(args.root, args.suite, args.case, require_counts=args.root == ROOT)
    for p in problems:
        print(f"PROBLEMA: {p}", file=sys.stderr)
    if not problems:
        print("ok")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
