"""Per-arm and paired aggregation, flags per run and the CLI, on tiny synthetic rounds."""

import json
from pathlib import Path
from typing import Any

from bench.metrics import summary
from bench.metrics.test_trace import p_asst, p_call, p_res, pi_text, text


def run(
    task: str, rep: int, passed: bool, cost: float = 0.1, **kw: Any
) -> dict[str, Any]:
    return {
        "suite": "s8",
        "task_id": task,
        "rep": rep,
        "passed": passed,
        "cost_usd": cost,
        "wall_s": 10.0 * (1 + cost),
        "error": None,
        "tokens": {"input": 10, "output": 5, "cache_read": 80, "cache_write": 10},
        "turns": 2,
        "tool_errors": 0,
        "first_request_tokens": 100,
        **kw,
    }


def make_round(
    root: Path, arm: str, runs: list[dict[str, Any]], finals: dict[tuple[str, int], str]
) -> Path:
    d = root / arm
    (d / "artifacts").mkdir(parents=True)
    (d / "meta.json").write_text(json.dumps({"arm": arm, "model": "claude-m"}))
    (d / "runs.jsonl").write_text("\n".join(json.dumps(r) for r in runs) + "\n")
    for (task, rep), final in finals.items():
        ev = [
            p_asst([p_call("1", "bash", command="ls")]),
            p_res("1", True),
            p_asst([text(final)]),
        ]
        (d / "artifacts" / f"s8-{task}-{rep}.agent.out").write_text(pi_text(*ev))
    return d


def two_arms(tmp: Path) -> list[Path]:
    a = make_round(
        tmp,
        "ny-pi",
        [
            run("t1", 0, True),
            run("t1", 1, False),
            run("t2", 0, False, 0.4),
            run("t2", 1, False, 0.4),
        ],
        {
            ("t1", 0): "Done.",
            ("t1", 1): "Done, all tests pass.",
            ("t2", 0): "I am blocked.",
            ("t2", 1): "Should I retry?",
        },
    )
    b = make_round(
        tmp,
        "pi-vanilla",
        [
            run("t1", 0, True, 0.2),
            run("t1", 1, True, 0.2),
            run("t2", 0, False, 0.2),
            run("t2", 1, True, 0.2),
        ],
        {
            ("t1", 0): "Done.",
            ("t1", 1): "Done.",
            ("t2", 0): "Done.",
            ("t2", 1): "Done.",
        },
    )
    return [a, b]


def test_arm_aggregates(tmp_path: Path) -> None:
    out = summary.compute([*two_arms(tmp_path)])
    ny = out["arms"]["ny-pi@m"]
    assert ny["runs"] == 4 and ny["solved"] == 1
    assert ny["pass_k"] == 0.0 and ny["flip_rate"] == 0.5  # t1 flips, t2 never passes
    assert ny["false_success"] == 1 and ny["give_up"] == 1 and ny["asks_user"] == 1
    assert ny["cache_hit"] == 0.8 and ny["tokens_per_solved"] == 420
    assert ny["tool_calls"] == 4 and ny["tool_err_rate"] == 1.0
    assert ny["cost_p90"] > 0.1 and ny["timeouts"] == 0 and ny["overruns"] == 0
    assert out["arms"]["pi-vanilla@m"]["pass_k"] == 0.5


def test_paired_vs_reference(tmp_path: Path) -> None:
    out = summary.compute(two_arms(tmp_path), focus="ny-pi")
    rows = {(p["metric"], p["ref"]): p for p in out["paired"]}
    pas = rows[("pass_rate", "pi-vanilla@m")]
    assert pas["n"] == 2 and abs(pas["median"] - (-0.5)) < 1e-9
    cost = rows[("cost", "pi-vanilla@m")]
    assert cost["kind"] == "ratio" and cost["ci"] is not None


def test_excluded_and_timeout(tmp_path: Path) -> None:
    runs = [
        run("t1", 0, False, 0.0, error="infra: no model spend"),
        run("t1", 1, False, 0.3, error="timeout"),
        run("t2", 0, False, 0.3, error="budget exceeded"),
    ]
    d = make_round(tmp_path, "ny-pi", runs, {})
    arm = summary.compute([d])["arms"]["ny-pi@m"]
    assert (
        arm["excluded"] == 1
        and arm["timeouts"] == 1
        and arm["overruns"] == 1
        and arm["runs"] == 2
    )
    assert arm["no_transcript"] == 2


def test_render_and_cli(tmp_path: Path, capsys: Any) -> None:
    from bench import run as cli

    rounds = [str(d) for d in two_arms(tmp_path)]
    js = tmp_path / "m.json"
    assert cli.main(["metrics", "--rounds", *rounds, "--json", str(js)]) == 0
    md = capsys.readouterr().out
    assert "| ny-pi@m |" in md and "Pareado" in md
    assert "arms" in json.loads(js.read_text())


def test_paired_p_ahead_direction_and_neutral_metrics(tmp_path: Path) -> None:
    out = summary.compute(two_arms(tmp_path), focus="ny-pi")
    rows = {p["metric"]: p for p in out["paired"] if p["ref"] == "pi-vanilla@m"}
    assert rows["pass_rate"]["p_ahead"] < 0.2  # ny loses where it differs
    assert (
        rows["cost"]["p_ahead"] <= 0.5
    )  # ratios 0.5x and 2x cancel in the log; ties count 0
    assert rows["give_up"]["p_ahead"] is None and rows["asks_user"]["p_ahead"] is None
    md = summary.render(out)
    assert "P(à frente)" in md and "à frente (P≥0,80)?" in md
    assert "| não |" in md and "| – |" in md and "| exploratório |" in md


def test_paired_p_ahead_lower_is_better_for_cost(tmp_path: Path) -> None:
    mine = [run(f"t{i}", 0, True, 0.1) for i in range(6)]
    ref = [run(f"t{i}", 0, True, 0.2) for i in range(6)]
    rounds = [make_round(tmp_path, "ny-pi", mine, {}), make_round(tmp_path, "pi-vanilla", ref, {})]  # fmt: skip
    rows = {p["metric"]: p for p in summary.compute(rounds)["paired"]}
    assert (
        rows["cost"]["p_ahead"] == 1.0 and rows["pass_rate"]["p_ahead"] == 0.0
    )  # all tied
    assert "| 1.000 | sim |" in summary.render(summary.compute(rounds))


def test_paired_drops_a_task_with_an_infra_run_from_both_arms(tmp_path: Path) -> None:
    mine = [run(f"t{i}", r, True, 0.1) for i in range(4) for r in (0, 1)]
    ref = [run(f"t{i}", r, True, 0.2) for i in range(4) for r in (0, 1)]
    ref[0] = run(
        "t0", 0, False, 0.0, error="infra: no model spend"
    )  # one errored rep of t0 in the reference
    mine.append(
        run("t9", 0, True, 0.0)
    )  # zero cost: kept for pass_rate, dropped from the cost ratio
    ref.append(run("t9", 0, True, 0.2))
    rounds = [
        make_round(tmp_path, "ny-pi", mine, {}),
        make_round(tmp_path, "pi-vanilla", ref, {}),
    ]
    rows = {p["metric"]: p for p in summary.compute(rounds)["paired"]}
    assert rows["pass_rate"]["n"] == 4 and rows["pass_rate"]["dropped"] == {"infra_focus": 0, "infra_ref": 1, "metric": 0}  # fmt: skip
    assert (
        rows["cost"]["n"] == 3 and rows["cost"]["dropped"]["metric"] == 1
    )  # t0 gone for both arms, t9 has cost 0
    assert "| 0/1; 0 |" in summary.render(summary.compute(rounds))


def test_claimed_failed_adds_caveated_claims_and_marks_exploratory(
    tmp_path: Path,
) -> None:
    mine = [run(f"t{i}", 0, False) for i in range(6)]
    ref = [run(f"t{i}", 0, False) for i in range(6)]
    fin = {(f"t{i}", 0): "Implementei tudo, pronto." for i in range(6)}
    fin_c = {(f"t{i}", 0): "Implementei, pronto. Decidi ler o campo como texto; não rodei os testes." for i in range(6)}  # fmt: skip
    rounds = [
        make_round(tmp_path, "ny-pi", mine, fin_c),
        make_round(tmp_path, "pi-vanilla", ref, fin),
    ]
    out = summary.compute(rounds)
    arms = out["arms"]
    assert (
        arms["ny-pi@m"]["claimed_failed"] == 6 and arms["ny-pi@m"]["false_success"] == 0
    )
    assert (
        arms["pi-vanilla@m"]["claimed_failed"] == 6
        and arms["pi-vanilla@m"]["false_success"] == 6
    )
    rows = {p["metric"]: p for p in out["paired"]}
    assert (
        rows["claimed_failed"]["focus_mean"] == 1.0
        and rows["false_success"]["focus_mean"] == 0.0
    )
    md = summary.render(out)
    assert "afirmou concluir e reprovou" in md and "exploratório" in md
