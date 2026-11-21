"""Gate a deep-search report against its verified ledger: every finding cites the supported claims it asserts.

Usage: python3 report_check.py REPORT.md --ledger LEDGER.json   (ledger: JSON list of rows with id, url, verdict)
Findings are the bullets and paragraphs under `## Findings` (its `###` subsections included); the template's `##`
headings stay verbatim in every language, so the parse never depends on the report's language. Each one cites at
least one ledger id as [C1] or [C1, C3], plus the URL of every cited row and no other URL, and every cited row is
`supported` or `partial`. A bullet in the Answer (text before the first `##`) cites its claim the same way; other
Answer lines and Findings tables follow the same rule without needing an id; other sections (Conflicts, Gaps,
Evidence, Method) may cite any ledger id.
Only the verdict gates: a cited row whose page is gone (HTTP 404/410, unknown host) adds a warning, and a timeout,
5xx or oversized page adds nothing (verification.md: unreachable never becomes unsupported).
Prints JSON {status: pass|fail|invalid, cited, problems, warnings}; exit 0, 1 or 2. No network, no writes.
"""
import argparse
import json
from pathlib import Path
import re
import sys
import urllib.parse

MAX_BYTES = 1024 * 1024
MAX_URLS = 200
SUPPORTED = {"supported", "partial"}
URL = re.compile(r"https?://[^\s<>\"'`\\\]\)|]+")
IDS = re.compile(r"\[(C\d+(?:\s*[,;]\s*C\d+)*)\]")
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*\Z")
BULLET = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")
DEAD = re.compile(r"HTTP 404\b|HTTP 410\b|Name or service not known|nodename nor servname|NXDOMAIN", re.I)


class Invalid(Exception):
    pass


def norm(url):
    """Same rule as the evals cite_check.norm (a parity test there pins them): no www, #fragment or final slash."""
    url = urllib.parse.unquote(url.rstrip(".,;:!?*_'\"")).split("#", 1)[0]
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:  # e.g. an unclosed IPv6 bracket: compare the raw text
        return url.lower()
    host = (parts.hostname or "").removeprefix("www.")
    return f"{host}{parts.path.rstrip('/')}" + (f"?{parts.query}" if parts.query else "")


def units(report):
    """(section, line, text, kind): kind 'claim' for a Findings bullet or paragraph, 'loose' for an Answer line or a
    Findings table row, 'other' elsewhere. Raises Invalid without a `## Findings` heading."""
    section, out, current, found = "answer", [], None, False
    for n, line in enumerate(report.splitlines(), 1):
        heading = HEADING.match(line)
        if heading:
            current = None
            if len(heading.group(1)) == 2:
                section = "findings" if heading.group(2).lower().startswith("findings") else "other"
                found = found or section == "findings"
            continue
        if not line.strip():
            current = None
            continue
        if section == "answer" and BULLET.match(line):
            out.append([section, n, line, "answer_bullet"])  # one claim per Answer bullet, cited like a finding
        elif section != "findings":
            out.append([section, n, line, "loose" if section == "answer" else "other"])
        elif line.lstrip().startswith("|"):
            current = None
            out.append([section, n, line, "loose"])
        elif current is None or BULLET.match(line):
            current = [section, n, line, "claim"]
            out.append(current)
        else:  # continuation of the bullet or paragraph above
            current[2] += "\n" + line
    if not found:
        raise Invalid("no `## Findings` heading: keep the template's `##` headings verbatim in every language")
    return out


def invalid(detail):
    return {"status": "invalid", "cited": [], "problems": [{"reason": "invalid", "detail": detail}], "warnings": []}


def check(report, rows):
    problems, warnings, cited = [], [], set()
    supported_urls = {norm(r.get("url", "")) for r in rows.values() if r.get("verdict") in SUPPORTED}
    if len(set(URL.findall(report))) > MAX_URLS:
        return invalid(f"more than {MAX_URLS} URLs")
    try:
        parts = units(report)
    except Invalid as exc:
        return invalid(str(exc))
    for section, line, text, kind in parts:
        ids = [i for group in IDS.findall(text) for i in re.split(r"\s*[,;]\s*", group)]
        urls = {norm(u) for u in URL.findall(text)}
        if kind in ("claim", "answer_bullet") and not ids:
            problems.append({"line": line, "reason": "uncited", "text": text[:160]})
            continue
        own, before = set(), len(problems)
        for cid in ids:
            row = rows.get(cid)
            if row is None:
                problems.append({"line": line, "id": cid, "reason": "not_in_ledger"})
            elif kind == "other":
                continue
            elif row.get("verdict") not in SUPPORTED:
                problems.append({"line": line, "id": cid, "reason": "not_supported",
                                 "verdict": row.get("verdict") or "unjudged"})
            else:
                cited.add(cid)
                own.add(norm(row.get("url", "")))
                reason = str(row.get("script_reason") or row.get("reason") or "")
                if row.get("script_status") == "unreachable" and DEAD.search(reason):
                    warnings.append({"id": cid, "url": row.get("url"), "reason": f"dead_link: {reason}"})
        if kind == "claim" and len(problems) == before:  # one problem per cause: a bad id already explains its URL
            problems += [{"line": line, "url": u, "reason": "url_mismatch"} for u in sorted(urls ^ own)]
        elif kind in ("loose", "answer_bullet"):
            problems += [{"line": line, "url": u, "reason": "not_supported"} for u in sorted(urls - supported_urls)]
    if not any(kind == "claim" for _, _, _, kind in parts):
        problems.append({"reason": "no_findings"})
    return {"status": "fail" if problems else "pass", "cited": sorted(cited, key=lambda i: int(i[1:])),
            "problems": problems, "warnings": warnings}


def read(path, label):
    data = Path(path).read_bytes()
    if len(data) > MAX_BYTES:
        raise Invalid(f"{label} larger than {MAX_BYTES} bytes")
    return data.decode("utf-8")


def load_ledger(path):
    items = json.loads(read(path, "ledger"))
    if not isinstance(items, list) or not all(isinstance(i, dict) and isinstance(i.get("id"), str) for i in items):
        raise Invalid("ledger must be a JSON list of rows with a string id")
    rows = {i["id"]: i for i in items}
    if len(rows) != len(items):
        raise Invalid("duplicate ledger ids")
    return rows


def main(argv=None, stdout=None):
    stdout = stdout or sys.stdout
    ap = argparse.ArgumentParser(prog="report_check.py")
    ap.add_argument("report")
    ap.add_argument("--ledger", required=True)
    try:
        args = ap.parse_args(argv)
    except SystemExit:
        return 2
    try:
        result = check(read(args.report, "report"), load_ledger(args.ledger))
    except (OSError, UnicodeDecodeError, ValueError, Invalid) as exc:
        result = invalid(str(exc))
    json.dump(result, stdout, ensure_ascii=False, indent=1)
    return {"pass": 0, "fail": 1}.get(result["status"], 2)


if __name__ == "__main__":
    sys.exit(main())
