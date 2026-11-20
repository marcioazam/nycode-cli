#!/usr/bin/env python3
"""A/B eval of /plan: OLD (pi-code plan-mode without zzzzz-plan-sota.patch) vs NEW (patched).

Paid runs: python3 plan_ab.py [--model M] [--k 1] [--budget-usd 18]. Free checks: --dry-run, --selfcheck-toggle (builds the OLD shadow; the install is never modified).
Arms run sequentially; the OLD arm runs on a shadow agent dir and the install is never modified.
Cost parsing mirrors skills/pelo-em-ovo/scripts/claude_pi.py: assistant message_end usage.cost.total. (optional)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HOME = Path.home()
EXT = HOME / ".pi/agent/npm/node_modules/pi-code/extensions"
PATCH = HOME / ".pi/agent/claude-home/patches/pi-code/zzzzz-plan-sota.patch"
PI = HOME / ".pi/agent/bin/pi"
MARK = "plan-workflow/SKILL.md"
INDEX = EXT / "plan-mode/index.ts"
CASES = Path(__file__).with_name("plan_ab_cases.jsonl")
OUT_ROOT = HOME / ".local/state/pelo-em-ovo/plan-ab"
ENV = {"CLAUDE_CONFIG_DIR": str(HOME / ".pi/agent/claude-home"), "PONYTAIL_QUIET_STARTUP": "1",
       "PI_COMPACT_AT": "250000", "PI_BYPASS_PERMISSIONS": "1"}

# ---------------------------------------------------------------- grader (pure)
REC = re.compile(r"Recomendad[oa][^\n]{0,20}\d{2}\s?%", re.I)
TIER_LINE = re.compile(r"Tier:\s*T([0-3])", re.I)
CONFLICT = re.compile(r"contradi|conflit|incompat|concili|não (pode|dá)|ambos| vs\.? | x ", re.I)
NUMQ = re.compile(r"(^|\n)\s*\d+[.)]\s+[^\n]*\?|\bQ1\b")
NUMLINE = re.compile(r"^\s*\d+[.)]\s+\S", re.M)
NUMTITLE = re.compile(r"^\s*\d+[.)]\s+(\S[^\n]*)", re.M)
EARS = re.compile(r"WHEN\b.*\bSHALL\b|QUANDO\b.*\bDEVE\b", re.S)
AC_DEF = re.compile(r"^\s*[-*]?\s*\W{0,3}AC(\d+)\b", re.M)
ASSUME = re.compile(r"^\s*[-*]?\s*\W{0,3}A\d+\b[^\n]*", re.M)
CHECK = re.compile(r"check:|verific", re.I)
ROLLBACK = re.compile(r"rollback|revers", re.I)


def parse_events(lines) -> list[dict]:
    out = []
    for ln in lines:
        ln = ln.strip()
        if ln.startswith("{"):
            try:
                out.append(json.loads(ln))
            except ValueError:
                pass
    return out


def extract(events: list[dict]) -> dict:
    """Tool calls (name, arguments), assistant texts, cumulative and first-message cost from pi events."""
    calls, texts, cost, turns, first, out_tok = [], [], 0.0, 0, None, 0
    for ev in events:
        if ev.get("type") != "message_end":
            continue
        msg = ev.get("message") or {}
        if msg.get("role") != "assistant":
            continue
        turns += 1
        c = float(((msg.get("usage") or {}).get("cost") or {}).get("total") or 0.0)
        cost += c
        out_tok += int((msg.get("usage") or {}).get("output") or 0)
        if first is None:
            first = c
        for b in msg.get("content") or []:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "text":
                texts.append(b.get("text", ""))
            elif b.get("type") == "toolCall":
                calls.append({"name": b.get("name"), "arguments": b.get("arguments") or {}})
    return {"calls": calls, "texts": texts, "cost": cost, "turns": turns, "first_cost": first or 0.0,
            "out_tokens": out_tok}


def _flat(x) -> str:
    return x if isinstance(x, str) else json.dumps(x, ensure_ascii=False)


def plan_tier(plan_txt: str):
    m = TIER_LINE.search(plan_txt)
    return int(m.group(1)) if m else None


def ac_traced(plan_txt: str) -> bool:
    """True when at least one AC<n> is defined and every defined id appears on another line."""
    lines = plan_txt.splitlines()
    defs = {}
    for i, ln in enumerate(lines):
        m = AC_DEF.match(ln)
        if m:
            defs.setdefault(m.group(1), i)
    if not defs:
        return False
    def cited(ln: str) -> set:
        ids = set()
        for m in re.finditer(r"\bAC(\d{1,3})(?:\s?[–—-]\s?(?:AC)?(\d{1,3})\b)?", ln):
            lo = int(m.group(1))
            hi = min(int(m.group(2)), lo + 200) if m.group(2) else lo
            ids.update(range(lo, max(hi, lo) + 1))
        return ids
    refs = [cited(ln) for ln in lines]
    return all(any(i != d and int(n) in ids for i, ids in enumerate(refs)) for n, d in defs.items())


def assumptions_pct(plan_txt: str):
    lines = [m.group(0) for m in ASSUME.finditer(plan_txt)]
    return all("%" in ln for ln in lines) if lines else None


def title_len_ok(plan_txt: str):
    titles = NUMTITLE.findall(plan_txt)
    # measured as the todo list shows it: markdown (backticks, bold) stripped, like the lint's R9
    return all(len(re.sub(r"\s+", " ", re.sub(r"[`*]", "", t)).strip()) <= 50 for t in titles) if titles else None


def full_plan(plan_txt: str, tier: str) -> bool:
    tasks = len(NUMLINE.findall(plan_txt))
    return tasks >= 1 and (len(plan_txt) >= 120 or tier == "T0")


def final_plan(calls: list[dict]) -> str:
    """The plan as finally accepted: the last full submission, with later edits to the plan file applied
    (a lint rejection saves the plan; the model edits the file and resubmits "@file")."""
    cur = ""
    for c in calls:
        a = c["arguments"] if isinstance(c["arguments"], dict) else {"plan": c["arguments"]}
        if c["name"] == "plan_mode_complete":
            txt = _flat(a.get("plan", a))
            if txt.strip() != "@file":
                cur = txt.replace("\\n", "\n") if "\n" not in txt else txt
        elif c["name"] == "edit" and "/plans/" in str(a.get("path", "")) and cur:
            edits = a.get("edits") or []
            if isinstance(edits, str):  # the model sometimes sends the edits array JSON-encoded
                try:
                    edits = json.loads(edits)
                except ValueError:
                    edits = []
            for e in edits if isinstance(edits, list) else []:
                if isinstance(e, dict) and e.get("oldText"):
                    cur = cur.replace(e["oldText"], e.get("newText", ""), 1)
    return cur


def grade(events: list[dict], case: dict, duration_s: float = 0.0) -> dict:
    ex = extract(events)
    qcalls = [c for c in ex["calls"] if c["name"] == "question"]
    qtexts = [_flat(c["arguments"]) for c in qcalls]
    plans = [c for c in ex["calls"] if c["name"] == "plan_mode_complete"]
    plan_txt = final_plan(ex["calls"])
    text = "\n".join(ex["texts"])
    asked = bool(qcalls) or bool(NUMQ.search(text))
    terms = case.get("contradiction_terms") or []
    flagged = asked_c = None
    if terms:
        def hit(s):
            return all(re.search(t, s, re.I) for t in terms) and bool(CONFLICT.search(s))
        flagged = any(hit(s) for s in ex["texts"] + qtexts + ([plan_txt] if plan_txt else []))
        asked_c = any(hit(s) for s in qtexts)
    tier = case["tier"]
    t1up = tier != "T0"
    stated = plan_tier(plan_txt)
    ok_tiers = case.get("tier_ok") or [tier]
    row = {
        "id": case["id"], "tier": tier, "split": case.get("split", "dev"), "asked": asked,
        "ask_correct": asked == bool(case["expect_ask"]),
        "rec_pct": bool(REC.search("\n".join(qtexts) + "\n" + text)) if asked else None,
        "tier_stated": stated is not None,
        "tier_ok": stated is not None and f"T{stated}" in ok_tiers,
        "contradiction_flagged": flagged, "contradiction_asked": asked_c,
        "plan_submitted": bool(plans), "numbered_tasks": len(NUMLINE.findall(plan_txt)),
        "ears": bool(EARS.search(plan_txt)) if t1up else None,
        "ac_traced": ac_traced(plan_txt) if t1up else None,
        "has_check": bool(CHECK.search(plan_txt)) if t1up else None,
        "assumptions_pct": assumptions_pct(plan_txt),
        "rollback": bool(ROLLBACK.search(plan_txt)) if tier == "T3" else None,
        "full_plan": full_plan(plan_txt, tier),
        "title_len": title_len_ok(plan_txt),
        "lean_t0": ex["turns"] <= 4 if tier == "T0" else None,
        "cost_usd": round(ex["cost"], 6), "cost_marginal": round(ex["cost"] - ex["first_cost"], 6),
        "turns": ex["turns"], "resubmits": max(len(plans) - 1, 0),
        "out_tokens": ex["out_tokens"], "duration_s": round(duration_s, 1),
    }
    row["score"] = score(row)
    return row


SCORED = ["ask_correct", "rec_pct", "tier_ok", "contradiction_flagged", "contradiction_asked", "ears", "ac_traced", "has_check",
          "assumptions_pct", "rollback", "full_plan", "title_len", "lean_t0", "plan_submitted"]
BOOLS = SCORED + ["tier_stated"]


def score(row: dict):
    v = [bool(row[k]) for k in SCORED if row.get(k) is not None]
    return round(sum(v) / len(v), 3) if v else None


def failed(row: dict) -> list[str]:
    return [k for k in SCORED if row.get(k) is False]


def aggregate(rows: list[dict]) -> dict:
    agg = {}
    for k in BOOLS:
        v = [r[k] for r in rows if r.get(k) is not None]
        agg[k] = round(sum(bool(x) for x in v) / len(v), 3) if v else None
    sc = [r["score"] for r in rows if r.get("score") is not None]
    agg["score"] = round(sum(sc) / len(sc), 3) if sc else None
    agg["cost_usd"] = round(sum(r.get("cost_usd", 0) for r in rows), 4)
    agg["cost_marginal"] = round(sum(r.get("cost_marginal", 0) for r in rows), 4)
    for k in ("resubmits", "out_tokens"):
        agg[k] = round(sum(r.get(k, 0) for r in rows) / len(rows), 2) if rows else None
    agg["runs"] = len(rows)
    return agg


def cost_ratio(new: dict, old: dict, key: str = "cost_usd"):
    return round(new[key] / old[key], 3) if old.get(key) else None


def cost_by_tier(rows: list[dict]) -> dict:
    out = {}
    for t in ("T0", "T1", "T2", "T3"):
        v = [r["cost_usd"] for r in rows if r.get("tier") == t]
        out[t] = round(sum(v) / len(v), 4) if v else None
    return out


# ---------------------------------------------------------------- patch control
# The installed extension is never modified: the wrapper of any other pi session re-applies patches at
# startup, and a reverse racing with it corrupted plan-mode on 2026-11-13. The OLD arm runs on a shadow
# agent dir (symlinks, plus a private copy of plan-mode with the patch reversed).
AGENT = HOME / ".pi/agent"
SHADOW_CHAIN = ("npm", "node_modules", "pi-code", "extensions", "plan-mode")


def marker_present(index: Path = INDEX) -> bool:
    return MARK in index.read_text()


def old_agent_dir(tmp: Path, agent: Path = AGENT, patch: Path = PATCH) -> Path:
    """Shadow of the agent dir whose plan-mode is a copy with the patch reversed."""
    root = tmp / "agent-old"
    src, dst = agent, root
    for name in SHADOW_CHAIN:
        dst.mkdir()
        for e in src.iterdir():
            if e.name != name:
                (dst / e.name).symlink_to(e)
        src, dst = src / name, dst / name
    shutil.copytree(src, dst)
    with open(patch, "rb") as f:
        ok = subprocess.run(["patch", "-d", str(dst.parent), "-p1", "-R", "-s", "-f"], stdin=f,
                            capture_output=True).returncode == 0
    if not ok or marker_present(dst / "index.ts") or list(dst.glob("*.rej")):
        raise SystemExit("could not build the OLD arm shadow (patch does not reverse cleanly)")
    return root


def selfcheck_toggle() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="plan-ab-"))
    try:
        root = old_agent_dir(tmp)
        print("installed marker:", marker_present(), "shadow marker:",
              marker_present(root.joinpath(*SHADOW_CHAIN, "index.ts")))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return 0 if marker_present() else 1


# ---------------------------------------------------------------- fixture
FIXTURE = {
    "store.py": '''"""In-memory task store."""
lst = []


def add(title):
    task = {"id": len(lst) + 1, "title": title, "done": False}
    lst.append(task)
    return task


def all_tasks():
    return list(lst)
''',
    "app.py": '''# TODO(2019): migrar para Flask 0.12 antes do lançamento
"""taskapi: GET /tasks, POST /tasks."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

import store


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/tasks":
            self._send(200, store.all_tasks())
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/tasks":
            return self._send(404, {"error": "not found"})
        size = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(size) or b"{}")
        if not body.get("title"):
            return self._send(400, {"error": "title required"})
        self._send(201, store.add(body["title"]))


def serve(port=8000):
    HTTPServer(("", port), Handler).serve_forever()


if __name__ == "__main__":
    serve()
''',
    "test_app.py": '''import unittest

import store


class StoreTest(unittest.TestCase):
    def setUp(self):
        store.lst.clear()

    def test_add(self):
        self.assertEqual(store.add("a")["id"], 1)

    def test_all(self):
        store.add("a")
        self.assertEqual(len(store.all_tasks()), 1)


if __name__ == "__main__":
    unittest.main()
''',
    "README.md": "# Taksapi\n\nTiny task API.\n\n- `GET /tasks`\n- `POST /tasks` with `{\"title\": ...}`\n\nRun: `python3 app.py`. Test: `python3 -m unittest`.\n",
    "docs/README.md": "# Docs\n\nNo design docs yet. Storage is in memory (`store.py`).\n",
}


def make_fixture(root: Path) -> Path:
    for rel, body in FIXTURE.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body)
    return root


# ---------------------------------------------------------------- runs
def pi_cmd(arm: str, model: str, prompt: str) -> list[str]:
    # same flags for both arms (they differ only by the patch); `arm` kept for the call signature
    base = [str(PI), "--exclude-tools", "web_search", "--no-approve"]
    return base + ["-p", "--plan", "--mode", "json", "--no-session", "--model", model, prompt]


def run_one(arm: str, case: dict, model: str, tmp: Path, raw: Path, timeout: int, agent_dir=None) -> dict:
    work = make_fixture(tmp / f"{arm}-{case['id']}")
    env = {**os.environ, **ENV, "PI_PLANS_DIR": str(tmp / "plans")}
    if agent_dir:
        env["PI_CODING_AGENT_DIR"] = str(agent_dir)
    t0, timed_out = time.monotonic(), False
    proc = subprocess.Popen(pi_cmd(arm, model, case["prompt"]), cwd=work, env=env, text=True,
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            start_new_session=True)
    try:
        out, _ = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(proc.pid, signal.SIGKILL)
        out, _ = proc.communicate()
    dur = time.monotonic() - t0
    dst = raw / f"{arm}-{case['id']}.jsonl"
    n = 1
    while dst.exists():  # k>1: keep every repetition
        n += 1
        dst = raw / f"{arm}-{case['id']}-{n}.jsonl"
    dst.write_text(out or "")
    row = grade(parse_events((out or "").splitlines()), case, dur)
    row.update(arm=arm, timed_out=timed_out, exit=proc.returncode)
    return row


def load_cases() -> list[dict]:
    return [json.loads(x) for x in CASES.read_text().splitlines() if x.strip()]


def _fmt(v):
    return "-" if v is None else v


def summarize(rows: list[dict], skipped: list[str]) -> str:
    L = ["# /plan A/B (OLD vs NEW)", "",
         "| case | split | tier | arm | asked | " + " | ".join(SCORED) + " | tier_stated | score | $ | $marg | turns | resubmits | out_tokens | s |",
         "|" + "---|" * (len(SCORED) + 12)]
    for r in sorted(rows, key=lambda r: (r["id"], r["arm"])):
        cells = [r["id"], r.get("split", ""), r.get("tier", ""), r["arm"], r["asked"]]
        cells += [_fmt(r.get(k)) for k in SCORED] + [r["tier_stated"], _fmt(r.get("score")),
                  "%.4f" % r["cost_usd"], "%.4f" % r.get("cost_marginal", 0), r["turns"],
                  r.get("resubmits", 0), r.get("out_tokens", 0),
                  "%s%s" % (r["duration_s"], " TIMEOUT" if r.get("timed_out") else "")]
        L.append("| " + " | ".join(str(c) for c in cells) + " |")
    keys = BOOLS + ["score", "cost_usd", "cost_marginal", "resubmits", "out_tokens", "runs"]
    for name in ("all", "dev", "holdout"):
        sub = [r for r in rows if name == "all" or r.get("split") == name]
        aggs = {a: aggregate([r for r in sub if r["arm"] == a]) for a in ("old", "new")}
        L += ["", f"## Aggregates: {name}", "", "| metric | OLD | NEW |", "|---|---|---|"]
        L += [f"| {k} | {_fmt(aggs['old'][k])} | {_fmt(aggs['new'][k])} |" for k in keys]
        L += ["", f"Cost ratio NEW/OLD: total {cost_ratio(aggs['new'], aggs['old'])}, "
              f"marginal {cost_ratio(aggs['new'], aggs['old'], 'cost_marginal')}"]
    L += ["", "## Mean cost per tier (USD)", "", "| tier | OLD | NEW |", "|---|---|---|"]
    ct = {a: cost_by_tier([r for r in rows if r["arm"] == a]) for a in ("old", "new")}
    L += [f"| {t} | {_fmt(ct['old'][t])} | {_fmt(ct['new'][t])} |" for t in ("T0", "T1", "T2", "T3")]
    L += ["", "## Failed booleans (NEW runs)", ""]
    L += [f"- {r['id']}: {', '.join(failed(r))}" for r in sorted(rows, key=lambda r: r["id"])
          if r["arm"] == "new" and failed(r)] or ["- none"]
    if skipped:
        L += ["", "Skipped (budget/abort): " + ", ".join(skipped)]
    return "\n".join(L) + "\n"


def plan_runs(cases, k, arms="both"):
    sel = ("new", "old") if arms == "both" else (arms,)
    return [(arm, c, i) for arm in sel for c in cases for i in range(k)]


def select_cases(cases, split="all", ids=None):
    out = [c for c in cases if split == "all" or c.get("split") == split]
    if ids:
        out = [c for c in out if c["id"] in ids]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="anthropic/claude-sonnet-5-5")
    ap.add_argument("--k", type=int, default=1)
    ap.add_argument("--budget-usd", type=float, default=18.0)
    ap.add_argument("--timeout", type=int, default=420)
    ap.add_argument("--arms", choices=["new", "old", "both"], default="both")
    ap.add_argument("--split", choices=["dev", "holdout", "all"], default="all")
    ap.add_argument("--cases", help="comma-separated case ids")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--selfcheck-toggle", action="store_true")
    a = ap.parse_args()
    if a.selfcheck_toggle:
        return selfcheck_toggle()
    ids = set(a.cases.split(",")) if a.cases else None
    cases = select_cases(load_cases(), a.split, ids)
    if not cases:
        raise SystemExit("no cases selected")
    runs = plan_runs(cases, a.k, a.arms)
    if a.dry_run:
        print(f"model={a.model} k={a.k} budget=${a.budget_usd} timeout={a.timeout}s runs={len(runs)} (arms={a.arms} split={a.split}; new arm first, then old)")
        for arm, c, i in runs:
            print(f"  [{arm}] {c['id']} #{i} tier={c['tier']} ok={c['tier_ok']} split={c['split']} ask={c['expect_ask']}: {' '.join(pi_cmd(arm, a.model, c['prompt'])[:-1])} {c['prompt']!r}")
        return 0
    out = OUT_ROOT / time.strftime("%Y%m%dT%H%M%S")
    (out / "raw").mkdir(parents=True)
    tmp = Path(tempfile.mkdtemp(prefix="plan-ab-"))
    rows, skipped, spent = [], [], 0.0
    try:
        for arm in [x for x in ("new", "old") if x in {r[0] for r in runs}]:
            if not marker_present():
                raise SystemExit("installed plan-mode lacks the patch; start pi once (the wrapper applies it)")
            agent_dir = old_agent_dir(tmp) if arm == "old" else None
            for a_, c, i in [r for r in runs if r[0] == arm]:
                if spent >= a.budget_usd:
                    skipped.append(f"{arm}:{c['id']}#{i}")
                    continue
                row = run_one(arm, c, a.model, tmp, out / "raw", a.timeout, agent_dir)
                spent += row["cost_usd"]
                rows.append(row)
                with open(out / "results.jsonl", "a") as f:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
                print(f"{arm} {c['id']} ${row['cost_usd']:.4f} (total ${spent:.2f})", flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        (out / "summary.md").write_text(summarize(rows, skipped))
        print("results:", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
