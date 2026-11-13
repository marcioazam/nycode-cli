"""Remote CI status: watch `gh pr checks` and tell a real failure from a job GitHub never started (billing)."""

import json
from time import monotonic, sleep

from gd_common import CI_RED, Fail
from gd_pr import gh_fail, pr_view

STATES = {"pass", "fail", "pending", "skipping", "cancel"}
OK_CONCLUSIONS = {"success", "skipped", "neutral"}
BILLING_PHRASES = ("payments have failed", "spending limit")
MAX_RUNS = 100  # the check-runs page size
MAX_CHECKS = 50
NO_CHECKS = ("no checks reported", "no required checks reported")


def parse_checks(text):
    """`gh pr checks` (non-tty): name, state, elapsed, url per line; a later row replaces an earlier one."""
    rows = {}
    for line in text.splitlines():
        cols = line.split("\t")
        if len(cols) >= 2 and cols[1].strip() in STATES:
            rows[cols[0].strip()] = {
                "name": cols[0].strip(),
                "state": cols[1].strip(),
                "url": cols[3].strip() if len(cols) > 3 else "",
            }
    return list(rows.values())


def _api(ctx, path):
    proc = ctx.gh("api", path)
    if proc.rc != 0:
        return None
    try:
        return json.loads(proc.out)
    except ValueError:
        return None


def _billing(ctx, pr):
    """(billing, run_urls) once classified; None when the API cannot answer (caller reports ci_unknown)."""
    try:
        sha = pr_view(ctx, pr, "headRefOid")["headRefOid"]
    except Fail:
        return None
    data = _api(ctx, f"repos/{{owner}}/{{repo}}/commits/{sha}/check-runs?per_page=100")
    if not isinstance(data, dict):
        return None
    runs = data.get("check_runs", [])
    bad = [r for r in runs if r.get("conclusion") not in OK_CONCLUSIONS]
    if not bad:
        return False, []
    # fail closed: unseen runs (past page one) or too many to inspect may hide a real failure
    if len(bad) > MAX_RUNS or data.get("total_count", len(runs)) > len(runs):
        return None
    texts, urls = [], []
    for run in bad:
        try:
            run_id = int(run["id"])
        except (KeyError, TypeError, ValueError):
            return None
        job = _api(ctx, f"repos/{{owner}}/{{repo}}/actions/jobs/{run_id}")
        notes = _api(ctx, f"repos/{{owner}}/{{repo}}/check-runs/{run_id}/annotations")
        if not isinstance(job, dict) or not isinstance(notes, list):
            return None
        if job.get("steps"):
            return False, urls  # the job ran: a real failure
        out = run.get("output") or {}
        texts += [out.get("title"), out.get("summary"), out.get("text")]
        texts += [
            n.get(k) for n in notes if isinstance(n, dict) for k in ("message", "title")
        ]
        urls.append(run.get("html_url") or run.get("details_url") or "")
    blob = " ".join(t for t in texts if isinstance(t, str)).lower()
    return any(phrase in blob for phrase in BILLING_PHRASES), urls


def _has_workflows(ctx):
    out = ctx.git("ls-tree", "--name-only", "HEAD", ".github/workflows/").out
    return any(line.endswith((".yml", ".yaml")) for line in out.splitlines())


def _await_checks(ctx, pr, required, interval, grace_min):
    """gh 2.46 `--watch` errors while no check is registered yet: poll until one appears or the grace ends."""
    argv = ["pr", "checks", str(pr)] + (["--required"] if required else [])
    deadline = monotonic() + grace_min * 60
    while True:
        proc = ctx.gh(*argv)
        if parse_checks(proc.out):
            return True
        low = f"{proc.out}\n{proc.err}".lower()
        if proc.rc != 0 and not any(phrase in low for phrase in NO_CHECKS):
            raise gh_fail(proc)
        if monotonic() >= deadline:
            return False
        sleep(interval)


def ci_status(
    ctx, pr, budget_min=45, required=False, watch=True, interval=30, grace_min=5
):
    if _has_workflows(ctx) and not _await_checks(
        ctx, pr, required, interval, grace_min
    ):
        return {"status": "no_checks", "checks": []}
    argv = ["pr", "checks", str(pr)]
    if watch:
        argv += ["--watch", "--fail-fast", "--interval", str(interval)]
    if required:
        argv.append("--required")
    proc = ctx.gh(*argv, timeout=max(1, int(budget_min * 60)) if watch else 120)
    checks = parse_checks(proc.out)[:MAX_CHECKS]
    low = f"{proc.out}\n{proc.err}".lower()

    def result(status, **extra):
        return {"status": status, "checks": checks, **extra}

    if proc.rc == 124:
        return result("pending_timeout")
    if any(phrase in low for phrase in NO_CHECKS):
        return result("no_checks")
    if proc.rc == 8 or (proc.rc == 0 and any(c["state"] == "pending" for c in checks)):
        return result("pending_timeout")
    if proc.rc == 0:
        return result("green") if checks else result("no_checks")
    if proc.rc != 1 or not checks:
        raise gh_fail(proc)
    verdict = _billing(ctx, pr)
    if verdict is None:
        return result("red", reason="ci_unknown")
    billing, urls = verdict
    if billing:
        return result("not_started_billing", runs=urls)
    failed = [c["url"] for c in checks if c["state"] in ("fail", "cancel")]
    return result("red", reason="ci_red", runs=failed)


def ci_outcome(status):
    """green, billing and no_checks are reported; red and pending become exit 5."""
    if status["status"] in ("green", "not_started_billing", "no_checks"):
        return status
    extra = {k: v for k, v in status.items() if k != "reason"}
    default = "pending_timeout" if status["status"] == "pending_timeout" else "ci_red"
    raise Fail(CI_RED, status.get("reason") or default, **extra)


def ci(ctx, args):
    return ci_outcome(
        ci_status(
            ctx,
            args.pr,
            args.budget_min,
            args.required,
            interval=args.interval,
            grace_min=args.checks_grace_min,
        )
    )
