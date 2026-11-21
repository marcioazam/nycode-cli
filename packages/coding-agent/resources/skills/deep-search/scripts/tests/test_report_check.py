"""Behavior tests for report_check.py: every Findings bullet asserts supported ledger claims, offline."""
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import report_check as rc  # noqa: E402

A, B, C, D, E, F = (f"https://example.org/{p}" for p in "abcdef")
LEDGER = [
    {"id": "C1", "url": "https://www.example.org/a", "verdict": "supported", "script_status": "verified"},
    {"id": "C2", "url": B + "/", "verdict": "partial", "script_status": "mismatch"},
    # Shares C1's URL: the page carries one supported and one unsupported claim.
    {"id": "C3", "url": A, "verdict": "unsupported", "script_status": "verified"},
    {"id": "C4", "url": C, "verdict": "unverifiable", "script_status": "blocked", "script_reason": "HTTP 403"},
    {"id": "C5", "url": D, "verdict": "supported", "script_status": "unreachable", "script_reason": "HTTP 404"},
    {"id": "C6", "url": E, "verdict": "supported", "script_status": "unreachable",
     "script_reason": "URLError: timed out"},
    {"id": "C7", "url": F, "script_status": "verified"},  # the verifier returned no verdict for it
]

GOOD = f"""# Is the broker ready?

**Answer.** Yes for most loads [C1] ({A}).

**Scope.** standard mode, accessed 2026-10-31.

## Findings
### Release
- Version 4.0 shipped on 2026-03-12 (high) [C1] — {A}
- Latency is low on vendor hardware only (low) [C2] — {B}
  measured by the vendor.

### Operations
1. Recovery takes 4 s (medium) [C5, C6] — {D}, {E}

## Conflicts and open questions
- The 1.8M msg/s figure [C3] contradicts the docs: {A}

## Gaps
- Fortune 500 adoption [C4] — blocked: {C}

## Evidence
| id | claim | URL | quote | provider | verdict |
|---|---|---|---|---|---|
| C3 | 1.8M msg/s | {A} | ... | exa | unsupported |

## Method and cost
One verifier.
"""


def check(report, ledger=LEDGER):
    return rc.check(report, {row["id"]: row for row in ledger})


def reasons(result):
    return [p["reason"] for p in result["problems"]]


class GateTest(unittest.TestCase):
    def test_report_citing_only_supported_rows_passes(self):
        result = check(GOOD)
        self.assertEqual(result["status"], "pass", result)
        self.assertEqual(result["cited"], ["C1", "C2", "C5", "C6"])

    def test_answer_bullets_each_cite_their_claim(self):
        # 2026-10-31 (evals srch-write-01): three Answer bullets with one [C1, C2, C6] group on the last one passed
        # this gate while the eval grader counted two uncited claims; an Answer bullet now cites like a finding.
        grouped = GOOD.replace("**Answer.** Yes for most loads [C1] ({A}).".format(A=A),
                               "**Answer.** Yes for most loads:\n- 4.0 shipped on 2026-03-12.\n- Recovery takes 4 s "
                               "[C1, C5].")
        result = check(grouped)
        self.assertEqual(reasons(result), ["uncited"], result)
        cited = grouped.replace("- 4.0 shipped on 2026-03-12.", "- 4.0 shipped on 2026-03-12 [C1].")
        self.assertEqual(check(cited)["status"], "pass")

    def test_finding_without_a_ledger_id_is_uncited_output(self):
        result = check(GOOD.replace("[C1] — " + A, "— " + A))
        self.assertEqual(reasons(result), ["uncited"])
        self.assertEqual(result["status"], "fail")

    def test_prose_paragraph_in_findings_needs_a_citation_too(self):
        self.assertEqual(reasons(check(GOOD.replace("### Operations", "Adoption is broad.\n\n### Operations"))),
                         ["uncited"])

    def test_id_missing_from_the_ledger_fails(self):
        self.assertEqual(reasons(check(GOOD.replace("[C1] — " + A, "[C9] — " + A))), ["not_in_ledger"])

    def test_unsupported_claim_fails_even_when_its_url_also_carries_a_supported_one(self):
        result = check(GOOD.replace("[C1] — " + A, "[C3] — " + A))
        self.assertEqual(reasons(result), ["not_supported"])
        self.assertEqual(result["problems"][0]["verdict"], "unsupported")

    def test_unverifiable_and_unjudged_rows_never_carry_a_finding(self):
        self.assertEqual(reasons(check(GOOD.replace(f"[C2] — {B}", f"[C4] — {C}"))), ["not_supported"])
        result = check(GOOD.replace(f"[C2] — {B}", f"[C7] — {F}"))
        self.assertEqual(result["problems"][0]["verdict"], "unjudged")

    def test_url_must_be_the_cited_rows_url(self):
        self.assertEqual(reasons(check(GOOD.replace(f"[C1] — {A}", f"[C1] — {B}"))), ["url_mismatch", "url_mismatch"])
        self.assertEqual(reasons(check(GOOD.replace(f"[C1] — {A}", "[C1]"))), ["url_mismatch"])

    def test_url_variants_match(self):
        report = GOOD.replace(f"[C1] — {A}", f"[C1] — {A}/#release").replace(f"[C2] — {B}", "[C2] — https://www.example.org/b.")
        self.assertEqual(check(report)["status"], "pass")

    def test_answer_may_not_cite_unsupported_ids_or_urls(self):
        self.assertEqual(reasons(check(GOOD.replace(f"[C1] ({A})", f"[C3] ({A})"))), ["not_supported"])
        self.assertEqual(reasons(check(GOOD.replace(f"[C1] ({A})", f"({C})"))), ["not_supported"])
        self.assertEqual(check(GOOD.replace(f"[C1] ({A})", "")).get("status"), "pass")  # Answer needs no citation

    def test_other_sections_may_cite_any_known_id_but_not_unknown_ones(self):
        self.assertEqual(reasons(check(GOOD.replace("[C4] — blocked", "[C42] — blocked"))), ["not_in_ledger"])

    def test_liveness_only_warns_and_only_for_a_dead_page(self):
        result = check(GOOD)
        self.assertEqual(result["status"], "pass")
        self.assertEqual([(w["id"], w["reason"]) for w in result["warnings"]], [("C5", "dead_link: HTTP 404")])

    def test_findings_heading_without_findings_fails(self):
        start, end = GOOD.index("### Release"), GOOD.index("## Conflicts")
        self.assertEqual(reasons(check(GOOD[:start] + GOOD[end:])), ["no_findings"])

    def test_table_rows_in_findings_are_checked_for_what_they_cite(self):
        table = f"| x | y |\n|---|---|\n| 4.0 | [C3] {A} |\n"
        self.assertEqual(reasons(check(GOOD.replace("### Operations", table + "### Operations"))), ["not_supported"])

    def test_portuguese_report_with_the_template_headings_passes(self):
        report = f"""# O broker está pronto?

**Resposta.** Sim para a maioria das cargas [C1] ({A}).

## Findings
### Lançamento
- A versão 4.0 saiu em 12/03/2026 (alta) [C1] — {A}
- A latência é baixa só no hardware do fornecedor (baixa) [C2] — {B}

## Gaps
- Adoção na Fortune 500 [C4] — bloqueada: {C}

## Evidence
| id | afirmação | URL | citação | provedor | veredito |
|---|---|---|---|---|---|
"""
        self.assertEqual(check(report)["status"], "pass")
        translated = check(report.replace("## Findings", "## Achados"))
        self.assertEqual(translated["status"], "invalid")
        self.assertIn("## Findings", translated["problems"][0]["detail"])


class CliTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.ledger = self.dir / "LEDGER.json"
        self.ledger.write_text(json.dumps(LEDGER))
        self.report = self.dir / "REPORT.md"
        self.report.write_text(GOOD)

    def tearDown(self):
        self.tmp.cleanup()

    def run_main(self, *argv):
        out = io.StringIO()
        code = rc.main(list(argv), stdout=out)
        return code, json.loads(out.getvalue()) if out.getvalue() else None

    def test_pass_and_fail_exit_codes(self):
        self.assertEqual(self.run_main(str(self.report), "--ledger", str(self.ledger))[0], 0)
        self.report.write_text(GOOD.replace("[C1] — " + A, "— " + A))
        code, out = self.run_main(str(self.report), "--ledger", str(self.ledger))
        self.assertEqual((code, out["status"]), (1, "fail"))

    def test_ledger_is_mandatory(self):
        self.assertEqual(self.run_main(str(self.report))[0], 2)

    def test_unreadable_or_malformed_inputs_are_invalid(self):
        for ledger in ("not json", json.dumps({"C1": {}}), json.dumps([{"id": "C1"}, {"id": "C1"}]),
                       json.dumps([{"url": A}])):
            self.ledger.write_text(ledger)
            code, out = self.run_main(str(self.report), "--ledger", str(self.ledger))
            self.assertEqual((code, out["status"]), (2, "invalid"), ledger)
        code, out = self.run_main(str(self.dir / "missing.md"), "--ledger", str(self.ledger))
        self.assertEqual(code, 2)

    def test_size_and_url_caps(self):
        self.report.write_text(GOOD + "x" * rc.MAX_BYTES)
        self.assertEqual(self.run_main(str(self.report), "--ledger", str(self.ledger))[0], 2)
        many = "\n".join(f"- https://example.org/n{i}" for i in range(rc.MAX_URLS + 1))
        self.report.write_text(GOOD.replace("## Method and cost", "## Sources\n" + many + "\n## Method and cost"))
        code, out = self.run_main(str(self.report), "--ledger", str(self.ledger))
        self.assertEqual(code, 2)
        self.assertIn("URLs", out["problems"][0]["detail"])


if __name__ == "__main__":
    unittest.main()
