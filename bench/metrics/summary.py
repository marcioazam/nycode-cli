"""Layer-1 evaluation: metrics from stored transcripts (zero API cost), per arm and paired by task.

Every included run (no infra error) is read once: tool and turn behaviour from the transcript, honesty from the
final message, tokens and cost from runs.jsonl. Runs without a transcript stay in the pass, cost and wall
metrics and are left out of the rest (counted as `no_transcript`)."""

import glob
import json
import math
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

from bench import evidence, stats
from bench.metrics import classify, trace

Rec = dict[str, Any]
# (key, kind, label): kind "diff" = mean difference of per-task means; "ratio" = geometric ratio of positive ones.
PAIRED = [
    ("pass_rate", "diff", "acerto"),
    ("false_success", "diff", "falso sucesso"),
    ("claimed_failed", "diff", "afirmou concluir e reprovou"),
    ("give_up", "diff", "desistência honesta"),
    ("asks_user", "diff", "pergunta ao usuário"),
    ("cost", "ratio", "custo US$"),
    ("wall", "ratio", "parede s"),
    ("tokens", "ratio", "tokens totais"),
    ("cache_hit", "diff", "cache hit"),
    ("first_req", "ratio", "1ª req tokens"),
    ("tool_calls", "ratio", "chamadas"),
    ("tool_err_rate", "diff", "taxa de erro de ferramenta"),
    ("idle_turns", "diff", "turnos ociosos"),
    ("repeat_reads", "diff", "leituras repetidas"),
    ("boot", "ratio", "boot s"),
    ("model_s", "ratio", "tempo de modelo s"),
    ("tool_s", "ratio", "tempo de ferramentas s"),
]
# Neutral metrics (more is neither better nor worse) get no "ahead" verdict; for the rest less is better
# unless listed in HIGHER.
NEUTRAL = {"give_up", "asks_user"}
HIGHER = {"pass_rate", "cache_hit"}
# Claimed completion and failed the verifier: strict false success plus the ones that wrote a caveat, so an arm
# that writes more caveats is not favoured.
CLAIMED_FAILED = ("false_success", "declared_with_caveat")


def _q(xs: list[float], p: float) -> float | None:
    xs = sorted(xs)
    if not xs:
        return None
    i = (len(xs) - 1) * p
    lo = int(i)
    return xs[lo] + (xs[min(lo + 1, len(xs) - 1)] - xs[lo]) * (i - lo)


def _div(a: float, b: float) -> float | None:
    return a / b if b else None


def _t0_total(trial: Path) -> tuple[float, float] | None:
    try:
        ae = json.loads((trial / "result.json").read_text())["agent_execution"]
        a, b = trace._iso(ae["started_at"]), trace._iso(ae["finished_at"])
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return a, b - a


def _speed(row: dict[str, Any], tr: trace.Trace) -> dict[str, float]:
    trial = row["logs"].get("trial")
    window = _t0_total(trial) if trial else None
    if tr.model_iv:
        return trace.speed(
            tr,
            window[0] if window else None,
            window[1] if window else row.get("wall_s"),
        )
    if trial and window:
        for sess in glob.glob(str(trial / "agent/sessions/projects/*/*.jsonl")):
            return trace.cc_session_speed(Path(sess), window[0])
    return {}


def record(row: dict[str, Any]) -> Rec:
    """Everything one run contributes, flattened; `vals` are the per-run numbers the paired table uses."""
    err = str(row.get("error") or "").lower()
    overrun = "budget" in err
    ev = row["logs"].get("events")
    tr = trace.parse(ev.read_text(errors="replace")) if ev else trace.Trace()
    passed = bool(row["passed"]) and not row.get("error")
    tok = row.get("tokens") or {}
    seen = bool(tr.events and tr.turns)
    proc = trace.process(tr)
    cls = classify.classify(tr.final) if seen else {}
    oc = classify.outcome(tr.final, passed) if seen else None
    all_tok = sum(tok.values()) if tok else None
    ctx = (
        tok.get("input", 0) + tok.get("cache_read", 0) + tok.get("cache_write", 0)
        if tok
        else 0
    )
    spd = _speed(row, tr) if seen else {}
    vals: dict[str, float | None] = {
        "pass_rate": float(passed),
        "cost": row.get("cost_usd"),
        "wall": row.get("wall_s"),
        "tokens": all_tok,
        "cache_hit": _div(tok.get("cache_read", 0), ctx) if tok else None,
        "first_req": row.get("first_request_tokens"),
        "false_success": float(oc == "false_success") if seen else None,
        "claimed_failed": float(oc in CLAIMED_FAILED) if seen else None,
        "give_up": float(oc == "honest_giveup") if seen else None,
        "asks_user": float(cls["asks_user"]) if seen else None,
        "tool_calls": proc.get("tool_calls") if proc else None,
        "tool_err_rate": _div(proc["tool_errors"], proc["tool_calls"])
        if proc
        else None,
        "idle_turns": proc.get("idle_turns") if proc else None,
        "repeat_reads": proc.get("repeat_reads") if proc else None,
        **{k: spd.get(k) for k in ("boot", "model_s", "tool_s")},
    }
    return {
        "task": (row["suite"], str(row["task_id"]).split("/")[-1]),
        "passed": passed,
        "excluded": stats.excluded_run(row) and not overrun,
        "timeout": "timeout" in err and not overrun,
        "overrun": overrun,
        "seen": seen,
        "outcome": oc,
        "cls": cls,
        "proc": proc,
        "tok": tok,
        "vals": vals,
        "pending": bool(cls.get("pending")),
    }


def _med(xs: list[float]) -> float | None:
    return statistics.median(xs) if xs else None


def arm_summary(recs: list[Rec]) -> dict[str, Any]:
    inc = [r for r in recs if not r["excluded"]]
    seen = [r for r in inc if r["seen"]]
    by_task: dict[Any, list[bool]] = defaultdict(list)
    for r in inc:
        by_task[r["task"]].append(r["passed"])
    multi = [v for v in by_task.values() if len(v) >= 2]

    def col(k: str, rs: list[Rec] = inc) -> list[float]:
        return [r["vals"][k] for r in rs if r["vals"].get(k) is not None]

    tot = {
        k: sum(r["proc"].get(k, 0) for r in seen)
        for k in (
            "tool_calls",
            "tool_errors",
            "recovered",
            "idle_turns",
            "repeat_reads",
            "long_sleeps",
        )
    }
    tk = [r["tok"] for r in inc if r["tok"]]
    ctx = sum(
        t.get("input", 0) + t.get("cache_read", 0) + t.get("cache_write", 0) for t in tk
    )
    solved = sum(r["passed"] for r in inc)

    def cnt(key: str) -> int:
        return sum(r["outcome"] == key for r in seen)

    return {
        "runs": len(inc),
        "excluded": len(recs) - len(inc),
        "no_transcript": len(inc) - len(seen),
        "tasks": len(by_task),
        "solved": solved,
        "pass_rate": _div(solved, len(inc)),
        "tasks_k2": len(multi),
        "pass_k": _div(sum(all(v) for v in multi), len(multi)),
        "flip_rate": _div(sum(any(v) and not all(v) for v in multi), len(multi)),
        "cost_med": _med(col("cost")),
        "cost_p90": _q(col("cost"), 0.9),
        "wall_p50": _med(col("wall")),
        "wall_p90": _q(col("wall"), 0.9),
        "timeouts": sum(r["timeout"] for r in inc),
        "overruns": sum(r["overrun"] for r in inc),
        "cache_hit": _div(sum(t.get("cache_read", 0) for t in tk), ctx),
        "first_req_med": _med(col("first_req")),
        "tokens_per_solved": _div(sum(col("tokens")), solved),
        "runs_with_tokens": len(tk),
        "false_success": cnt("false_success"),
        "claimed_failed": sum(r["outcome"] in CLAIMED_FAILED for r in seen),
        "give_up": cnt("honest_giveup"),
        "claims_done": sum(bool(r["cls"].get("claims_done")) for r in seen),
        "no_final": cnt("no_final"),
        "asks_user": sum(bool(r["cls"].get("asks_user")) for r in seen),
        "pending": sum(r["pending"] for r in seen),
        "pending_failed": sum(r["pending"] and not r["passed"] for r in seen),
        "seen": len(seen),
        "false_success_rate": _div(cnt("false_success"), len(seen)),
        "give_up_rate": _div(cnt("honest_giveup"), len(seen)),
        "tool_calls": tot["tool_calls"],
        "calls_per_run": _div(tot["tool_calls"], len(seen)),
        "tool_err_rate": _div(tot["tool_errors"], tot["tool_calls"]),
        "recovery_rate": _div(tot["recovered"], tot["tool_errors"]),
        "idle_per_run": _div(tot["idle_turns"], len(seen)),
        "repeat_reads_per_run": _div(tot["repeat_reads"], len(seen)),
        "sleep_runs": sum(bool(r["proc"].get("long_sleeps")) for r in seen),
        "long_sleeps": tot["long_sleeps"],
        "boot_med": _med(col("boot")),
        "model_s_med": _med(col("model_s")),
        "tool_s_med": _med(col("tool_s")),
        "speed_runs": len(col("boot")),
    }


def _task_means(recs: list[Rec], key: str) -> dict[Any, float]:
    g: dict[Any, list[float]] = defaultdict(list)
    for r in recs:
        if not r["excluded"] and r["vals"].get(key) is not None:
            g[r["task"]].append(r["vals"][key])
    return {t: sum(v) / len(v) for t, v in g.items()}


def paired(
    focus: list[Rec], ref: list[Rec], key: str, kind: str
) -> dict[str, Any] | None:
    # A task with any infra-errored run in either arm leaves the pairing for BOTH arms (as in the scoreboard).
    bad_f = {r["task"] for r in focus if r["excluded"]}
    bad_r = {r["task"] for r in ref if r["excluded"]}
    common = {r["task"] for r in focus} & {r["task"] for r in ref}
    a, b = _task_means(focus, key), _task_means(ref, key)
    tasks = sorted((set(a) & set(b)) - bad_f - bad_r)
    if kind == "ratio":
        tasks = [t for t in tasks if a[t] > 0 and b[t] > 0]
        xs = [math.log(a[t] / b[t]) for t in tasks]
    else:
        xs = [a[t] - b[t] for t in tasks]
    if not xs:
        return None
    dropped = {
        "infra_focus": len(common & bad_f),
        "infra_ref": len(common & bad_r),
        "metric": len(common - bad_f - bad_r)
        - len(xs),  # no value or (ratio) a value <= 0 on either side
    }
    lo, hi = stats.paired_ci(xs)
    back = math.exp if kind == "ratio" else float
    p = None if key in NEUTRAL else stats.prob_superior(xs, lower_is_better=key not in HIGHER)  # fmt: skip
    return {
        "p_ahead": p,
        "dropped": dropped,
        "kind": kind,
        "n": len(xs),
        "focus_mean": statistics.mean(a[t] for t in tasks),
        "ref_mean": statistics.mean(b[t] for t in tasks),
        "median": back(statistics.median(xs)),
        "mean": back(statistics.mean(xs)),
        "ci": [back(lo), back(hi)],
    }


def compute(rounds: list[Path], focus: str = "ny-pi") -> dict[str, Any]:
    recs: dict[str, list[Rec]] = defaultdict(list)
    for row in evidence.collect(rounds):
        recs[row["arm"]].append(record(row))
    mine = [a for a in recs if a.split("@")[0] == focus]
    refs = [a for a in recs if a not in mine]
    rows = []
    for a in mine:
        for ref in refs:
            for key, kind, _ in PAIRED:
                if p := paired(recs[a], recs[ref], key, kind):
                    rows.append({"arm": a, "ref": ref, "metric": key, **p})
    return {"arms": {a: arm_summary(r) for a, r in recs.items()}, "paired": rows}


def _f(x: float | None, nd: int = 2, pct: bool = False) -> str:
    if x is None:
        return "n/a"
    return f"{100 * x:.1f}%" if pct else f"{x:.{nd}f}"


def _table(
    title: str, arms: dict[str, Any], cols: list[tuple[str, str, int, bool]]
) -> list[str]:
    out = [
        "",
        f"### {title}",
        "",
        "| braço | " + " | ".join(c[0] for c in cols) + " |",
        "|---|" + "---|" * len(cols),
    ]
    for a, s in arms.items():
        out.append(
            f"| {a} | "
            + " | ".join(
                _f(s[k], nd, pc) if not isinstance(s[k], int) else str(s[k])
                for _, k, nd, pc in cols
            )
            + " |"
        )
    return out


TABLES = [
    (
        "Confiabilidade e cauda",
        [
            ("runs", "runs", 0, False),
            ("excl. (infra)", "excluded", 0, False),
            ("acerto", "pass_rate", 3, True),
            ("tarefas k≥2", "tasks_k2", 0, False),
            ("pass^k", "pass_k", 3, True),
            ("flip", "flip_rate", 3, True),
            ("custo med", "cost_med", 4, False),
            ("custo p90", "cost_p90", 4, False),
            ("parede p50 s", "wall_p50", 1, False),
            ("parede p90 s", "wall_p90", 1, False),
            ("timeouts", "timeouts", 0, False),
            ("estouros de orçamento", "overruns", 0, False),
        ],
    ),
    (
        "Honestidade e autonomia (runs com transcrição)",
        [
            ("com transcrição", "seen", 0, False),
            ("afirmou concluir", "claims_done", 0, False),
            ("falso sucesso", "false_success", 0, False),
            ("afirmou concluir e reprovou", "claimed_failed", 0, False),
            ("taxa FS", "false_success_rate", 3, True),
            ("desistência honesta", "give_up", 0, False),
            ("taxa DH", "give_up_rate", 3, True),
            ("sem msg final", "no_final", 0, False),
            ("perguntou ao usuário", "asks_user", 0, False),
            ("pendente declarado", "pending", 0, False),
            ("pendente e reprovou", "pending_failed", 0, False),
        ],
    ),
    (
        "Contexto e tokens",
        [
            ("runs com tokens", "runs_with_tokens", 0, False),
            ("cache hit", "cache_hit", 3, True),
            ("1ª req tokens (med)", "first_req_med", 0, False),
            ("tokens por run resolvida", "tokens_per_solved", 0, False),
        ],
    ),
    (
        "Processo",
        [
            ("chamadas", "tool_calls", 0, False),
            ("por run", "calls_per_run", 1, False),
            ("erro de ferramenta", "tool_err_rate", 3, True),
            ("recuperação", "recovery_rate", 3, True),
            ("ociosos/run", "idle_per_run", 2, False),
            ("leit. repetidas/run", "repeat_reads_per_run", 2, False),
            ("runs com sleep ≥60 s", "sleep_runs", 0, False),
        ],
    ),
    (
        "Velocidade (medianas; só runs com timestamps)",
        [
            ("runs", "speed_runs", 0, False),
            ("boot s", "boot_med", 1, False),
            ("modelo s", "model_s_med", 1, False),
            ("ferramentas s", "tool_s_med", 1, False),
        ],
    ),
]


def _ratio_fmt(x: float) -> str:
    return f"{x:.2f}×"


def _diff_fmt(x: float) -> str:
    return f"{x:+.3f}"


def render(data: dict[str, Any]) -> str:
    out = ["# Métricas da camada 1 (transcrições guardadas)"]
    for title, cols in TABLES:
        out += _table(title, data["arms"], cols)
    if data["paired"]:
        out += [
            "",
            "### Pareado por tarefa",
            "",
            "Diferença (foco − referência) ou razão (foco / referência, só valores > 0); mediana entre tarefas e IC90 BCa da média (razão: média geométrica).",
            "",
            'P(à frente) = P(foco melhor que a referência | dados), bootstrap pareado por tarefa (menor é melhor em custo, tempo, tokens, falso sucesso, erros); sim/não só nas métricas pré-registradas (primária: acerto; co-primárias: custo e parede); nas demais a coluna diz exploratório (muitas métricas a 80%: algumas passam por acaso); – = métrica neutra. "Afirmou concluir e reprovou" = falso sucesso + declarado com ressalva.',
            "",
            "Uma tarefa com qualquer run de erro de infraestrutura em um dos braços sai do pareamento nos dois. Descartes por linha na tabela abaixo.",
            "",
            "| foco | métrica | referência | tarefas | descartadas (infra foco/ref; sem valor ou ≤0) | foco | ref | mediana | IC90 da média | P(à frente) | à frente (P≥0,80)? |",
            "|---|---|---|---|---|---|---|---|---|---|---|",
        ]
        label = {k: lb for k, _, lb in PAIRED}
        for p in data["paired"]:
            fm = _ratio_fmt if p["kind"] == "ratio" else _diff_fmt
            dr = p["dropped"]
            ah = stats.ahead(p["p_ahead"], p["metric"] in stats.PREREGISTERED)
            out.append(
                f"| {p['arm']} | {label[p['metric']]} | {p['ref']} | {p['n']} | {dr['infra_focus']}/{dr['infra_ref']}; {dr['metric']} | {p['focus_mean']:.3g} | {p['ref_mean']:.3g} | {fm(p['median'])} | [{fm(p['ci'][0])}, {fm(p['ci'][1])}] | {_f(p['p_ahead'], 3)} | {ah} |"
            )
    return "\n".join(out) + "\n"
