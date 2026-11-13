#!/usr/bin/env python3
"""Gate de orçamento das instruções sempre carregadas do harness.

Conta: claude-home/CLAUDE.md, claude-home/rules/*.md e, de cada
claude-home/skills/*/SKILL.md e claude-home/agents/*.md, só `name`+`description`
do frontmatter (o que entra no catálogo).

Estimativa de tokens (offline, determinística): ceil(bytes_utf8 / 3.5).

check:  falha (exit 1) se o total exceder o baseline, salvo rótulo
        `budget-increase` no PR (JSON de GITHUB_EVENT_PATH). Exit 2 = entrada inválida.
update: regrava o baseline.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any, cast

HOME = "claude-home"
DEFAULT_BASELINE = Path(__file__).with_name("instruction_budget.baseline.json")
LABEL = "budget-increase"


class InputError(Exception):
    pass


def tokens(text: str) -> int:
    return math.ceil(len(text.encode("utf-8")) / 3.5)


def catalog_text(path: Path) -> str:
    """Linhas `name:`/`description:` do frontmatter (com continuações indentadas)."""
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        return ""
    out: list[str] = []
    keep = False
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if line[:1] not in (" ", "\t"):
            keep = line.split(":", 1)[0] in ("name", "description")
        if keep:
            out.append(line)
    return "\n".join(out)


def measure(root: Path) -> dict[str, int]:
    home = root / HOME
    if not (home / "CLAUDE.md").is_file():
        raise InputError(f"{home / 'CLAUDE.md'} não existe")
    files: dict[str, int] = {}
    files[f"{HOME}/CLAUDE.md"] = tokens(
        (home / "CLAUDE.md").read_text(encoding="utf-8")
    )
    for p in sorted((home / "rules").glob("*.md")):
        files[f"{HOME}/rules/{p.name}"] = tokens(p.read_text(encoding="utf-8"))
    skills = sorted((home / "skills").glob("*/SKILL.md"))
    if not skills:
        raise InputError("nenhuma skill encontrada")
    for p in skills + sorted((home / "agents").glob("*.md")):
        files[p.relative_to(root).as_posix()] = tokens(catalog_text(p))
    return files


def load_baseline(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if (
            data["version"] != 1
            or not isinstance(data["files"], dict)
            or not isinstance(data["total"], int)
        ):
            raise ValueError("formato")
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise InputError(f"baseline inválido {path}: {e}") from e
    return cast("dict[str, Any]", data)


def has_label(event: str | None) -> bool:
    if not event:
        return False
    try:
        data = json.loads(Path(event).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    labels = (data.get("pull_request") or {}).get("labels") or []
    return any(isinstance(lb, dict) and lb.get("name") == LABEL for lb in labels)


def cmd_check(a: argparse.Namespace) -> int:
    cur = measure(a.root)
    base = load_baseline(a.baseline)
    total = sum(cur.values())
    deltas = {
        k: cur.get(k, 0) - base["files"].get(k, 0)
        for k in cur.keys() | base["files"].keys()
    }
    print(
        f"tokens: {total} (baseline {base['total']}, delta {total - base['total']:+d})"
    )
    for k, d in sorted(deltas.items(), key=lambda kv: (-abs(kv[1]), kv[0]))[:10]:
        if d:
            print(f"  {d:+6d}  {k}")
    if total <= base["total"]:
        return 0
    if has_label(a.labels_from_event):
        print(f"excede o baseline, mas o rótulo {LABEL} está presente")
        return 0
    print(
        f"FALHA: +{total - base['total']} tokens; reduza ou use o rótulo {LABEL} e rode `update`",
        file=sys.stderr,
    )
    return 1


def cmd_update(a: argparse.Namespace) -> int:
    cur = measure(a.root)
    data = {
        "version": 1,
        "estimator": "bytes/3.5",
        "total": sum(cur.values()),
        "files": dict(sorted(cur.items())),
    }
    a.baseline.write_text(
        json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"baseline gravado: {data['total']} tokens, {len(cur)} arquivos")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("check", "update"):
        sp = sub.add_parser(name)
        sp.add_argument(
            "--root", type=Path, default=Path(__file__).resolve().parents[2]
        )
        sp.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
        if name == "check":
            sp.add_argument(
                "--labels-from-event", default=os.environ.get("GITHUB_EVENT_PATH")
            )
    a = ap.parse_args(argv)
    try:
        return cmd_check(a) if a.cmd == "check" else cmd_update(a)
    except InputError as e:
        print(f"erro: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
