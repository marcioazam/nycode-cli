"""Tier `smoke` is an alias of `pr` (D-27, docs/migration/ny-pi-core/09 §5.2): same plan, canonical name `pr`."""

from bench import run as rb
from bench.tests.helpers import BENCH, CF, RA


def test_smoke_resolves_to_pr() -> None:
    cfg = rb.load_toml(BENCH / "suites.toml")
    assert rb.resolve_tier("smoke", cfg) == "pr"
    assert rb.resolve_tier("pr", cfg) == "pr"


def test_smoke_dry_run_prints_the_pr_plan(capsys: CF) -> None:
    assert rb.main(RA("ny-pi", "--dry-run", tier="pr", budget="12")) == 0
    pr = capsys.readouterr().out
    assert rb.main(RA("ny-pi", "--dry-run", tier="smoke", budget="12")) == 0
    assert capsys.readouterr().out == pr
