#!/usr/bin/env python3
"""Pipeline do /insecure-defaults-audit no nycode: porte do workflows/audit.js (trailofbits/insecure-defaults 2.0.3).

O nycode não tem a ferramenta Workflow do Claude Code. As partes que o script fazia sozinho (guardas, dedup, lotes,
contabilidade de cobertura) ficam aqui, determinísticas e testadas; os agentes rodam pelo `subagent` do nycode, cada um
lendo o prompt que este script grava em <run>/prompts/. Fases:

  pipeline.py init <scope>      checa o corpus, cria o run e grava prompts/recon.md          -> {"run", "status"}
  pipeline.py sweeps <run>      lê recon.json, grava prompts/sweep-<categoria>.md (6)         -> {"status", "sweeps"}
  pipeline.py discover <run>    lê sweep-*.json, dedup, lotes, grava prompts/verify-*.md     -> {"status", "batches"}
  pipeline.py verify <run>      lê verdicts/*.json, cobertura, grava prompts/report.md       -> {"status", ...}
  pipeline.py finish <run>      confere report.md e devolve o resultado final               -> {"status", "report"}

Cada comando imprime uma linha JSON. "status" diferente de "ok" encerra a auditoria com aquele status (os mesmos do
audit.js: corpus-unreadable, recon-failed, scope-missing, search-failed, no-candidates, verify-failed, report-failed).
Testes: scripts/tests/test_pipeline.py.
"""

import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

sys.path.insert(
    0, str(Path(__file__).resolve().parent)
)  # sibling module, also when loaded by path
from pipeline_prompts import (
    CATEGORIES,
    CATEGORY_IDS,
    REFS,
    SEED_FILES,
    recon_prompt,
    report_prompt,
    sweep_prompt,
    verify_prompt,
)

MAX_FINDINGS_PER_BATCH = 16

RECON_FIELDS = [
    "scope_exists",
    "languages",
    "config_locations",
    "deploy_manifests",
    "exclude_paths",
]
SWEEP_CONTEXT = [
    "languages",
    "frameworks",
    "config_locations",
    "config_accessors",
    "deploy_manifests",
    "exclude_paths",
]
VERIFY_CONTEXT = ["scope", "exclude_paths", "deploy_manifests"]


def emit(obj: dict[str, Any]) -> int:
    print(json.dumps(obj, ensure_ascii=False))
    return 0 if obj.get("status") in ("ok", "findings", "no-findings-confirmed") else 3


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def context_for(fields: list[str], source: dict[str, Any]) -> str:
    return (
        "<context>\n"
        + json.dumps(
            {k: source.get(k, []) or [] for k in fields}, indent=2, ensure_ascii=False
        )
        + "\n</context>"
    )


def dir_of(f: str) -> str:
    i = f.rfind("/")
    return "." if i == -1 else f[:i]


def corpus_problems() -> list[str]:
    """As três fontes de cada categoria precisam concordar (o seed-coverage.js do plugin, versão curta)."""
    problems = []
    for cat in CATEGORIES:
        data = load_json(REFS / f"{SEED_FILES[cat['id']]}.json")
        md = REFS / f"{cat['id']}.md"
        if not isinstance(data, dict):
            problems.append(f"{cat['id']}.json ausente ou inválido")
        else:
            if data.get("id") != cat["id"] or data.get("title") != cat["title"]:
                problems.append(
                    f"{cat['id']}.json: id/título não batem com a categoria"
                )
            seeds = data.get("seeds")
            if not seeds or not all(isinstance(s, str) for s in seeds):
                problems.append(f"{cat['id']}.json sem seeds")
            elif any(re.search(r"\\[sdb]", s) for s in seeds):
                problems.append(
                    f"{cat['id']}.json usa \\s, \\d ou \\b (não é POSIX ERE)"
                )
        if not md.is_file():
            problems.append(f"{cat['id']}.md ausente")
        else:
            text = md.read_text(encoding="utf-8")
            if "**Report when:**" not in text or "**Skip when:**" not in text:
                problems.append(f"{cat['id']}.md sem as linhas Report when / Skip when")
    return problems


# ------------------------------------------------------------------ prompts (texto do audit.js, em português)


# ------------------------------------------------------------------ fases


def cmd_init(scope: str, base: str | None = None) -> dict[str, Any]:
    problems = corpus_problems()
    if problems:
        return {
            "status": "corpus-unreadable",
            "note": f"Corpus em {REFS} incompleto: "
            + "; ".join(problems)
            + ". Nada foi auditado.",
            "examples_dir": str(REFS),
        }
    scope = (scope or ".").strip() or "."
    run = Path(
        tempfile.mkdtemp(
            prefix=f"insecure-defaults-{time.strftime('%Y%m%d-%H%M%S')}-", dir=base
        )
    )
    (run / "prompts").mkdir()
    (run / "verdicts").mkdir()
    (run / "state.json").write_text(
        json.dumps({"scope": scope, "cwd": os.getcwd()}), encoding="utf-8"
    )
    (run / "prompts" / "recon.md").write_text(
        recon_prompt(scope, run / "recon.json"), encoding="utf-8"
    )
    return {
        "status": "ok",
        "run": str(run),
        "scope": scope,
        "next": "recon",
        "recon_prompt": str(run / "prompts" / "recon.md"),
        "recon_out": str(run / "recon.json"),
    }


def state(run: Path) -> dict[str, Any]:
    data = load_json(run / "state.json")
    if not isinstance(data, dict):
        raise ValueError(f"{run} não é um run do insecure-defaults (sem state.json)")  # noqa: TRY004 -- ValueError is the documented contract
    return data


def cmd_sweeps(run: Path) -> dict[str, Any]:
    st = state(run)
    recon = load_json(run / "recon.json")
    if not isinstance(recon, dict) or any(k not in recon for k in RECON_FIELDS):
        return {
            "status": "recon-failed",
            "note": "O recon não devolveu um recon.json válido; sem perfil para as varreduras.",
        }
    if recon.get("scope_exists") is False:
        return {
            "status": "scope-missing",
            "note": f"`{st['scope']}` não existe no disco. Nada foi auditado.",
        }
    profile = {**recon, "scope": st["scope"]}
    st["profile"] = profile
    (run / "state.json").write_text(
        json.dumps(st, ensure_ascii=False), encoding="utf-8"
    )
    ctx = context_for(SWEEP_CONTEXT, profile)
    sweeps = []
    for cat in CATEGORIES:
        prompt = run / "prompts" / f"sweep-{cat['id']}.md"
        out = run / f"sweep-{cat['id']}.json"
        prompt.write_text(sweep_prompt(cat, st["scope"], ctx, out), encoding="utf-8")
        sweeps.append({"category": cat["id"], "prompt": str(prompt), "out": str(out)})
    log = (
        f"Recon: {', '.join(recon.get('languages') or []) or 'nenhuma linguagem identificada'} | "
        f"{len(recon.get('config_accessors') or [])} acessores de config | "
        f"{len(recon.get('deploy_manifests') or [])} manifestos de deploy"
    )
    return {"status": "ok", "log": log, "sweeps": sweeps}


def pack_batches(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Por categoria, até 16 por lote, diretórios inteiros sempre que couberem (first-fit em ordem lexicográfica)."""
    by_cat: dict[str, list[Any]] = {}
    for c in candidates:
        by_cat.setdefault(c["category"], []).append(c)
    batches = []
    for category, group in by_cat.items():
        by_dir: dict[str, list[Any]] = {}
        for c in group:
            by_dir.setdefault(dir_of(c["file"]), []).append(c)
        dirs = sorted(by_dir.items())
        for _, items in dirs:
            items.sort(key=lambda c: (c["file"], c["line"]))
        packed: list[Any] = []
        current: list[Any] = []
        for _, items in dirs:
            if len(items) > MAX_FINDINGS_PER_BATCH:
                if current:
                    packed.append(current)
                    current = []
                for i in range(0, len(items), MAX_FINDINGS_PER_BATCH):
                    packed.append(items[i : i + MAX_FINDINGS_PER_BATCH])
                continue
            if len(current) + len(items) > MAX_FINDINGS_PER_BATCH:
                packed.append(current)
                current = []
            current.extend(items)
        if current:
            packed.append(current)
        for i, cands in enumerate(packed):
            label = f"{category}-{i + 1}" if len(packed) > 1 else category
            batches.append(
                {
                    "label": label,
                    "category": category,
                    "candidates": cands,
                    "dirs": sorted({dir_of(c["file"]) for c in cands}),
                    "chunk": i + 1,
                    "chunks": len(packed),
                }
            )
    return batches


def as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def cmd_discover(run: Path) -> dict[str, Any]:
    st = state(run)
    if "profile" not in st:
        return {"status": "recon-failed", "note": "Rode `sweeps` antes de `discover`."}
    sweeps = []
    for cid in CATEGORY_IDS:
        data = load_json(run / f"sweep-{cid}.json")
        if isinstance(data, dict):
            sweeps.append({**data, "category": cid})
    corpus_failures = [
        s["category"]
        for s in sweeps
        if s.get("corpus_read") is False or s.get("patterns_loaded") is False
    ]
    if corpus_failures:
        return {
            "status": "corpus-unreadable",
            "examples_dir": str(REFS),
            "categories_affected": corpus_failures,
            "note": (
                f"{len(corpus_failures)}/{len(CATEGORIES)} varreduras não carregaram a definição da categoria de "
                f"{REFS}: {', '.join(corpus_failures)}. Nada foi auditado; confira se a skill está completa."
            ),
        }
    total = sum(as_int(s.get("files_scanned")) for s in sweeps)
    if not sweeps or total == 0:
        return {
            "status": "search-failed",
            "note": (
                f"{len(sweeps)}/{len(CATEGORIES)} varreduras voltaram e varreram {total} arquivos no total. "
                "Isso é falha de busca, NÃO auditoria limpa. Não relate o alvo como livre de padrões inseguros."
            ),
            "sweeps": [
                {
                    "category": s["category"],
                    "files_scanned": as_int(s.get("files_scanned")),
                    "patterns_run": len(s.get("seed_patterns_run") or [])
                    + len(s.get("derived_patterns") or []),
                }
                for s in sweeps
            ],
        }
    by_cat = {s["category"]: s for s in sweeps}
    scanned_by_cat = {
        cid: as_int((by_cat.get(cid) or {}).get("files_scanned"))
        for cid in CATEGORY_IDS
    }
    unsearched = [cid for cid in CATEGORY_IDS if not scanned_by_cat[cid]]
    seen: dict[str, dict[str, Any]] = {}
    raw = 0
    for s in sweeps:
        for c in s.get("candidates") or []:
            if not isinstance(c, dict) or not c.get("file"):
                continue
            raw += 1
            c = {**c, "line": as_int(c.get("line")), "category": s["category"]}
            seen.setdefault(
                f"{s['category']}:{c['file']}:{c['line']}", c
            )  # mesmo padrão-linha: o primeiro vale
    candidates = list(seen.values())
    seed_only = [s["category"] for s in sweeps if not s.get("derived_patterns")]
    st.update(
        sweeps_summary={
            "total_scanned": total,
            "scanned_by_category": scanned_by_cat,
            "unsearched": unsearched,
            "raw": raw,
            "seed_only": seed_only,
            "categories_run": [s["category"] for s in sweeps],
            "patterns_run": sum(
                len(s.get("seed_patterns_run") or [])
                + len(s.get("derived_patterns") or [])
                for s in sweeps
            ),
        },
        candidates=candidates,
    )
    notes = []
    if unsearched:
        notes.append(
            f"{len(unsearched)}/{len(CATEGORIES)} varreduras não varreram arquivo nenhum: {', '.join(unsearched)}. "
            "Essas categorias NÃO estão cobertas."
        )
    if seed_only:
        notes.append(
            f"{len(seed_only)}/{len(CATEGORIES)} varreduras só rodaram os seeds genéricos: {', '.join(seed_only)}."
        )
    log = f"Discover: {raw} candidatos brutos em {total} arquivos varridos -> {len(candidates)} locais únicos após o dedup"
    if not candidates:
        (run / "state.json").write_text(
            json.dumps(st, ensure_ascii=False), encoding="utf-8"
        )
        note = (
            f"{len(CATEGORIES) - len(unsearched)}/{len(CATEGORIES)} varreduras varreram {total} arquivos sem marcar "
            "candidato. Essas buscas rodaram, então é um negativo genuíno para elas e não uma falha, mas é ausência "
            "de casamento de padrão, não prova de ausência."
        )
        if unsearched:
            note += f" Não diz nada sobre {', '.join(unsearched)}: essas varreduras não varreram arquivo nenhum."
        return {
            "status": "no-candidates",
            "note": note,
            "scanned": total,
            "files_scanned_by_category": scanned_by_cat,
            "unsearched_categories": unsearched,
            "log": log,
            "notes": notes,
        }
    batches = pack_batches(candidates)
    ctx = context_for(VERIFY_CONTEXT, st["profile"])
    out = []
    for b in batches:
        prompt = run / "prompts" / f"verify-{b['label']}.md"
        prompt.write_text(verify_prompt(b, ctx), encoding="utf-8")
        out.append(
            {
                "label": b["label"],
                "category": b["category"],
                "candidates": len(b["candidates"]),
                "prompt": str(prompt),
                "verdict_out": str(run / "verdicts" / f"{b['label']}.json"),
            }
        )
    st["batches"] = [{"label": b["label"], "category": b["category"]} for b in batches]
    (run / "state.json").write_text(
        json.dumps(st, ensure_ascii=False), encoding="utf-8"
    )
    single_dir = sum(1 for b in batches if len(b["dirs"]) == 1)
    log += (
        f"; {len(batches)} lote(s) de verificação em {len({b['category'] for b in batches})} categoria(s), "
        f"{single_dir}/{len(batches)} num só diretório"
    )
    return {"status": "ok", "log": log, "notes": notes, "batches": out}


def extract_json(text: str) -> Any:
    """O último bloco ```json de uma resposta, ou o texto inteiro se ele já for JSON."""
    blocks = re.findall(r"```(?:json|jsonc)?\s*\n(.*?)```", text, flags=re.DOTALL)
    for candidate in [*reversed(blocks), text]:
        try:
            return json.loads(candidate)
        except ValueError:
            continue
    return None


def cmd_verify(run: Path) -> dict[str, Any]:
    st = state(run)
    if "batches" not in st:
        return {"status": "verify-failed", "note": "Rode `discover` antes de `verify`."}
    verdicts, batches_verified = [], 0
    for b in st["batches"]:
        path = run / "verdicts" / f"{b['label']}.json"
        data = None
        if path.is_file():
            raw = path.read_text(encoding="utf-8")
            data = extract_json(raw)
        if isinstance(data, dict) and isinstance(data.get("verdicts"), list):
            batches_verified += 1
            for v in data["verdicts"]:
                if isinstance(v, dict) and v.get("file"):
                    verdicts.append(
                        {**v, "line": as_int(v.get("line")), "category": b["category"]}
                    )
    candidates = st["candidates"]
    confirmed = [v for v in verdicts if v.get("refuted") is False]
    refuted = [v for v in verdicts if v.get("refuted") is not False]
    adjudicated = {f"{v['category']}:{v['file']}:{v['line']}" for v in verdicts}
    unadjudicated = [
        c
        for c in candidates
        if f"{c['category']}:{c['file']}:{c['line']}" not in adjudicated
    ]
    sw = st["sweeps_summary"]
    coverage = {
        "scope": st["scope"],
        "files_scanned": sw["total_scanned"],
        "categories_run": sw["categories_run"],
        "files_scanned_by_category": sw["scanned_by_category"],
        "unsearched_categories": sw["unsearched"],
        "patterns_run": sw["patterns_run"],
        "seed_only_sweeps": sw["seed_only"],
        "raw_candidates": sw["raw"],
        "unique_candidates": len(candidates),
        "files_with_candidates": len({c["file"] for c in candidates}),
        "batches_run": len(st["batches"]),
        "batches_verified": batches_verified,
        "unadjudicated": [
            f"{c['category']}:{c['file']}:{c['line']}" for c in unadjudicated
        ],
    }
    result = {"coverage": coverage, "findings": confirmed, "refuted": refuted}
    (run / "result.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    log = (
        f"Verify: {len(confirmed)} confirmados, {len(refuted)} refutados, {len(unadjudicated)} sem veredito em "
        f"{batches_verified}/{len(st['batches'])} lotes"
    )
    if len(unadjudicated) == len(candidates):
        return {
            "status": "verify-failed",
            "log": log,
            "coverage": coverage,
            "candidates": coverage["unadjudicated"],
            "note": (
                f"{batches_verified}/{len(st['batches'])} lotes de verificação voltaram e nenhum dos "
                f"{len(candidates)} candidatos foi julgado. Falha de verificação, NÃO auditoria limpa: rode de novo."
            ),
        }
    (run / "prompts" / "report.md").write_text(
        report_prompt(st["scope"], confirmed, refuted, coverage, run / "report.md"),
        encoding="utf-8",
    )
    return {
        "status": "ok",
        "log": log,
        "confirmed": len(confirmed),
        "refuted": len(refuted),
        "unadjudicated": len(unadjudicated),
        "report_prompt": str(run / "prompts" / "report.md"),
        "report_out": str(run / "report.md"),
    }


def cmd_finish(run: Path) -> dict[str, Any]:
    result = load_json(run / "result.json")
    if not isinstance(result, dict):
        return {
            "status": "verify-failed",
            "note": "Sem result.json: rode `verify` antes de `finish`.",
        }
    report = run / "report.md"
    if not report.is_file() or not report.read_text(encoding="utf-8").strip():
        return {
            "status": "report-failed",
            "result": str(run / "result.json"),
            "note": (
                f"A auditoria terminou e {len(result['findings'])} achado(s) sobreviveram à verificação, mas o "
                "relatório não foi escrito. Apresente findings, refuted e coverage de result.json. Não rode a "
                "auditoria de novo e não relate o alvo como limpo."
            ),
        }
    return {
        "status": "findings" if result["findings"] else "no-findings-confirmed",
        "report": str(report),
        "result": str(run / "result.json"),
        "coverage": result["coverage"],
    }


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in (
        "init",
        "sweeps",
        "discover",
        "verify",
        "finish",
        "check-corpus",
    ):
        print(__doc__, file=sys.stderr)
        return 2
    cmd, rest = argv[0], argv[1:]
    try:
        if cmd == "check-corpus":
            problems = corpus_problems()
            return emit(
                {
                    "status": "ok" if not problems else "corpus-unreadable",
                    "problems": problems,
                    "examples_dir": str(REFS),
                }
            )
        if cmd == "init":
            return emit(cmd_init(rest[0] if rest else "."))
        if not rest:
            raise ValueError(f"uso: pipeline.py {cmd} <run>")
        run = Path(rest[0])
        return emit(
            {
                "sweeps": cmd_sweeps,
                "discover": cmd_discover,
                "verify": cmd_verify,
                "finish": cmd_finish,
            }[cmd](run)
        )
    except (ValueError, OSError, KeyError) as err:
        return emit({"status": "error", "note": str(err)})


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
