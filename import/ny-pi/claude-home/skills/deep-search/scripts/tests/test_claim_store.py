"""Behavior tests for claim_store.py: verified claims persist across sessions with an as-of date and a TTL."""
import datetime as dt
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claim_store as cs  # noqa: E402

TODAY = dt.date(2026, 10, 29)


def row(**over):
    base = {"id": "C1", "claim": "MCP spec 2026-07-28 is current", "url": "https://modelcontextprotocol.io/specification/versioning",
            "quote": "The current protocol version is 2026-07-28.", "verdict": "supported",
            "origin_root": "modelcontextprotocol.io", "provider": "exa", "ttl_class": "docs"}
    base.update(over)
    return base


class ClaimStoreTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.store = Path(self.dir.name) / "sub" / "claims.jsonl"

    def tearDown(self):
        self.dir.cleanup()

    def run_cli(self, argv, stdin=""):
        out = io.StringIO()
        code = cs.main(argv + ["--store", str(self.store)], stdin=io.StringIO(stdin), stdout=out, today=TODAY)
        return code, out.getvalue()

    def add(self, rows, *extra):
        return self.run_cli(["add", "-", *extra], json.dumps(rows))

    def find(self, *terms):
        code, out = self.run_cli(["find", *terms])
        return code, [json.loads(line) for line in out.splitlines()]

    def test_add_keeps_only_supported_and_partial_with_required_fields(self):
        rows = [row(), row(id="C2", verdict="partial", quote="Move experimental tasks out of the core protocol."),
                row(id="C3", verdict="unsupported"), row(id="C4", verdict="unverifiable"),
                row(id="C5", quote=""), row(id="C6", url="file:///etc/passwd")]
        code, out = self.add(rows)
        result = json.loads(out)
        self.assertEqual(code, 0)
        self.assertEqual(result["added"], 2)
        self.assertEqual(sorted(s["id"] for s in result["skipped"]), ["C3", "C4", "C5", "C6"])
        self.assertEqual(self.store.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.store.parent.stat().st_mode & 0o777, 0o700)

    def test_same_claim_same_day_is_not_duplicated_but_a_newer_check_refreshes_it(self):
        self.add([row()])
        self.assertEqual(json.loads(self.add([row()])[1])["added"], 0)
        self.add([row(verdict="partial")], "--as-of", "2026-10-30")
        _, found = self.find("protocol")
        self.assertEqual(len(found), 1)
        self.assertEqual((found[0]["as_of"], found[0]["verdict"]), ("2026-10-30", "partial"))
        self.assertEqual(len(self.store.read_text().splitlines()), 2)  # append-only history

    def test_find_matches_all_terms_case_insensitively_and_flags_staleness(self):
        self.add([row(), row(id="C9", claim="graphiti-core 0.31.2 is the latest release", ttl_class="volatile",
                             url="https://pypi.org/project/graphiti-core/", quote="graphiti-core 0.31.2",
                             origin_root="pypi.org")], "--as-of", "2026-10-01")
        _, found = self.find("GRAPHITI", "release")
        self.assertEqual([f["claim"] for f in found], ["graphiti-core 0.31.2 is the latest release"])
        self.assertTrue(found[0]["stale"])  # volatile: 14 days
        self.assertEqual(found[0]["age_days"], 28)
        _, found = self.find("protocol")
        self.assertFalse(found[0]["stale"])  # docs: 90 days

    def test_fresh_filter_and_limit(self):
        self.add([row(id=f"C{i}", quote=f"The current protocol version is 2026-07-28 ({i}).", ttl_class="volatile")
                  for i in range(5)], "--as-of", "2026-10-01")
        self.add([row(id="N", quote="fresh quote about the protocol version")], "--topic", "mcp")
        code, out = self.run_cli(["find", "protocol", "--fresh"])
        self.assertEqual([json.loads(line)["quote"] for line in out.splitlines()], ["fresh quote about the protocol version"])
        code, out = self.run_cli(["find", "protocol", "--limit", "2"])
        self.assertEqual(len(out.splitlines()), 2)

    def test_topic_and_explicit_ttl_days(self):
        self.add([row(ttl_days=3)], "--topic", "mcp-spec", "--as-of", "2026-10-25")
        _, found = self.find("mcp-spec")
        self.assertEqual((found[0]["topic"], found[0]["ttl_days"], found[0]["stale"]), ("mcp-spec", 3, True))

    def test_missing_store_finds_nothing(self):
        self.assertEqual(self.find("anything"), (0, []))

    def test_bad_input_exits_2(self):
        self.assertEqual(self.run_cli(["add", "-"], "{not json")[0], 2)
        self.assertEqual(self.run_cli(["add", "-"], json.dumps({"id": "C1"}))[0], 2)
        self.assertEqual(self.run_cli(["add", "-", "--as-of", "29/10/2026"], json.dumps([row()]))[0], 2)
        self.assertEqual(self.run_cli(["find"])[0], 2)

    def test_default_store_honors_env(self):
        old = os.environ.get("RESEARCH_CLAIMS_FILE")
        os.environ["RESEARCH_CLAIMS_FILE"] = str(self.store)
        try:
            self.assertEqual(cs.default_store(), self.store)
        finally:
            os.environ.pop("RESEARCH_CLAIMS_FILE")
            if old is not None:
                os.environ["RESEARCH_CLAIMS_FILE"] = old
        self.assertEqual(cs.default_store(), Path.home() / ".local/share/research-claims/claims.jsonl")


if __name__ == "__main__":
    unittest.main()
