import json
import unittest

import plan_ab as p


def msg(content, cost=0.0):
    return {"type": "message_end", "message": {"role": "assistant", "content": content,
                                               "usage": {"cost": {"total": cost}}}}


def text(t):
    return {"type": "text", "text": t}


def call(name, **args):
    return {"type": "toolCall", "name": name, "arguments": args}


CASE = {"id": "x", "tier": "T2", "tier_ok": ["T2", "T3"], "split": "dev", "expect_ask": True, "contradiction_terms": [], "doubt": False}


class GradeTest(unittest.TestCase):
    def test_question_and_cost(self):
        ev = [msg([call("question", q="Qual? Recomendado (80%)")], 0.5), msg([text("T2")], 0.25)]
        r = p.grade(ev, CASE, 3.0)
        self.assertTrue(r["asked"] and r["ask_correct"] and r["rec_pct"])
        self.assertEqual((r["cost_usd"], r["turns"], r["duration_s"]), (0.75, 2, 3.0))
        self.assertFalse(r["tier_stated"])  # tier only counts in the plan text

    def test_numbered_question_text_counts_as_asked(self):
        r = p.grade([msg([text("1. Qual storage?\n2. Qual formato?")])], CASE)
        self.assertTrue(r["asked"])
        self.assertTrue(p.grade([msg([text("Q1 qual?")])], CASE)["asked"])

    def test_no_ask_case(self):
        c = {**CASE, "expect_ask": False, "tier": "T0"}
        r = p.grade([msg([call("plan_mode_complete", plan="1. fix\n")])], c)
        self.assertTrue(r["ask_correct"] and r["plan_submitted"])
        self.assertFalse(r["tier_stated"] or r["tier_ok"])
        self.assertEqual(r["numbered_tasks"], 1)
        self.assertIsNone(r["rec_pct"])  # nothing asked

    def test_tier_ok(self):
        g = lambda t, c=CASE: p.grade([msg([call("plan_mode_complete", plan=t)])], c)
        r = g("Tier: T3\n1. a")
        self.assertTrue(r["tier_stated"] and r["tier_ok"])
        r = g("Tier: T1\n1. a")
        self.assertTrue(r["tier_stated"] and not r["tier_ok"])
        self.assertFalse(g("T2 sem rótulo")["tier_ok"])
        self.assertEqual(p.plan_tier("Tier: T1 ... Tier: T2"), 1)

    def test_rec_pct_applies_only_when_asked(self):
        self.assertFalse(p.grade([msg([call("question", q="Qual?")])], CASE)["rec_pct"])
        self.assertIsNone(p.grade([msg([text("ok")])], CASE)["rec_pct"])

    def test_contradiction(self):
        c = {**CASE, "contradiction_terms": ["formato", "UUID"]}
        ok = p.grade([msg([text("Há conflito: formato inalterado vs UUID")])], c)
        self.assertTrue(ok["contradiction_flagged"])
        self.assertFalse(p.grade([msg([text("formato e UUID ok")])], c)["contradiction_flagged"])
        q = p.grade([msg([call("question", q="formato x UUID são incompatíveis")])], c)
        self.assertTrue(q["contradiction_flagged"])
        self.assertIsNone(p.grade([msg([text("x")])], CASE)["contradiction_flagged"])

    def test_plan_tasks_and_ears(self):
        plan = "1. a\n2. b\n3) c\nWHEN x THEN system SHALL y"
        r = p.grade([msg([call("plan_mode_complete", plan=plan)])], CASE)
        self.assertEqual(r["numbered_tasks"], 3)
        self.assertTrue(r["ears"])
        self.assertTrue(p.grade([msg([call("plan_mode_complete", plan="QUANDO a o sistema DEVE b")])], CASE)["ears"])
        self.assertFalse(p.grade([msg([call("plan_mode_complete", plan="1. a")])], CASE)["ears"])
        t0 = {**CASE, "tier": "T0"}
        r0 = p.grade([msg([call("plan_mode_complete", plan="1. a")])], t0)
        self.assertTrue(r0["ears"] is None and r0["ac_traced"] is None and r0["has_check"] is None)

    def test_ac_traced(self):
        self.assertTrue(p.ac_traced("- AC1: x\n- AC2: y\n1. faz AC1\n2. faz AC2"))
        self.assertFalse(p.ac_traced("AC1: x\nAC2: y\n1. faz AC1"))
        self.assertFalse(p.ac_traced("1. sem criterios"))
        self.assertTrue(p.ac_traced("AC1: x\nAC2: y\nAC3: z\n1. faz (AC1–AC3)"))
        self.assertFalse(p.ac_traced("AC1: x\nAC2: y\nAC3: z\n1. faz (AC1-AC2)"))
        self.assertFalse(p.ac_traced("AC1: x só aqui"))

    def test_has_check_and_rollback(self):
        t3 = {**CASE, "tier": "T3"}
        g = lambda t, c: p.grade([msg([call("plan_mode_complete", plan=t)])], c)
        self.assertTrue(g("check: pytest", t3)["has_check"])
        self.assertTrue(g("Verificação manual", t3)["has_check"])
        self.assertFalse(g("1. a", t3)["has_check"])
        self.assertTrue(g("Rollback: git revert", t3)["rollback"])
        self.assertTrue(g("reversão do commit", t3)["rollback"])
        self.assertFalse(g("1. a", t3)["rollback"])
        self.assertIsNone(g("1. a", CASE)["rollback"])

    def test_assumptions_pct(self):
        self.assertTrue(p.assumptions_pct("- A1: x (80%)\n* A2: y 60%"))
        self.assertFalse(p.assumptions_pct("A1: x 80%\nA2: y"))
        self.assertIsNone(p.assumptions_pct("1. sem premissas"))

    def test_full_plan_and_title_len(self):
        self.assertFalse(p.full_plan("1. curto", "T2"))
        self.assertTrue(p.full_plan("1. curto", "T0"))
        self.assertFalse(p.full_plan("sem tarefas " * 20, "T2"))
        self.assertTrue(p.full_plan("1. a\n" + "x" * 130, "T2"))
        self.assertTrue(p.title_len_ok("1. " + "a" * 50 + "\n2) b"))
        self.assertFalse(p.title_len_ok("1. " + "a" * 51))
        self.assertIsNone(p.title_len_ok("sem tarefas"))

    def test_lean_t0_and_marginal_cost(self):
        t0 = {**CASE, "tier": "T0"}
        ev = [msg([text("a")], 1.0), msg([text("b")], 0.25)]
        r = p.grade(ev, t0)
        self.assertTrue(r["lean_t0"])
        self.assertEqual((r["cost_usd"], r["cost_marginal"]), (1.25, 0.25))
        self.assertFalse(p.grade([msg([text("x")])] * 5, t0)["lean_t0"])
        self.assertIsNone(p.grade(ev, CASE)["lean_t0"])
        self.assertEqual(p.grade([], CASE)["cost_marginal"], 0.0)

    def test_score_skips_none(self):
        row = {k: None for k in p.SCORED}
        self.assertIsNone(p.score(row))
        row.update(ask_correct=True, tier_ok=False, plan_submitted=True, ears=None)
        self.assertEqual(p.score(row), 0.667)
        self.assertEqual(p.failed(row), ["tier_ok"])
        r = p.grade([msg([call("plan_mode_complete", plan="Tier: T2\n1. a")])], {**CASE, "expect_ask": False})
        self.assertIsNotNone(r["score"])

    def test_parse_events_skips_noise(self):
        evs = p.parse_events(["noise", json.dumps({"type": "x"}), "{bad"])
        self.assertEqual(evs, [{"type": "x"}])

    def test_aggregate_ratio(self):
        a = p.aggregate([{"ask_correct": True, "cost_usd": 1.0, "contradiction_flagged": None},
                         {"ask_correct": False, "cost_usd": 1.0, "contradiction_flagged": True}])
        self.assertEqual(a["ask_correct"], 0.5)
        self.assertEqual(a["contradiction_flagged"], 1.0)
        self.assertEqual(a["cost_usd"], 2.0)
        self.assertEqual(p.cost_ratio({"cost_usd": 3}, {"cost_usd": 2}), 1.5)
        self.assertEqual(p.cost_ratio({"cost_marginal": 1}, {"cost_marginal": 2}, "cost_marginal"), 0.5)
        n = p.aggregate([{"score": 1.0, "ears": None}, {"score": None}, {"score": 0.5, "ears": True}])
        self.assertEqual((n["score"], n["ears"]), (0.75, 1.0))
        self.assertIsNone(p.aggregate([{"cost_usd": 1}])["ears"])
        rows = [{"tier": "T0", "cost_usd": 1.0}, {"tier": "T0", "cost_usd": 3.0}, {"tier": "T2", "cost_usd": 2.0}]
        self.assertEqual(p.cost_by_tier(rows), {"T0": 2.0, "T1": None, "T2": 2.0, "T3": None})

    def test_summary_and_selection(self):
        cs = p.load_cases()
        r = p.grade([msg([call("plan_mode_complete", plan="Tier: T1\n1. a")], 1.0)], cs[2])
        r.update(arm="new")
        o = {**r, "arm": "old"}
        md = p.summarize([r, o], ["x"])
        for h in ("Aggregates: all", "Aggregates: dev", "Aggregates: holdout", "marginal", "Failed booleans", "T3"):
            self.assertIn(h, md)
        self.assertEqual(len(p.select_cases(cs, "holdout")), 6)
        self.assertEqual([c["id"] for c in p.select_cases(cs, "all", {"t0-typo"})], ["t0-typo"])
        self.assertEqual(len(p.plan_runs(cs[:2], 2, "new")), 4)
        self.assertEqual({a for a, _, _ in p.plan_runs(cs[:2], 1)}, {"new", "old"})
        self.assertIsNone(p.cost_ratio({"cost_usd": 3}, {"cost_usd": 0}))

    def test_cases_file(self):
        cs = p.load_cases()
        self.assertEqual(len(cs), 14)
        self.assertEqual(sum(c["split"] == "dev" for c in cs), 8)
        self.assertEqual(sum(c["split"] == "holdout" for c in cs), 6)
        self.assertTrue(all({"id", "tier", "prompt", "expect_ask", "contradiction_terms", "doubt", "tier_ok", "split"}
                            <= set(c) for c in cs))


def usage_msg(content, out):
    m = msg(content)
    m["message"]["usage"]["output"] = out
    return m


class ContradictionAndMetricsTest(unittest.TestCase):
    def g(self, ev, terms):
        return p.grade(ev, {**CASE, "contradiction_terms": terms})

    def test_real_question(self):
        q = "Como conciliar 'deletar tasks antigos' com 'nunca perder dados de usuário'?"
        r = self.g([msg([call("question", q=q)])], ["delet|apag", "perd"])
        self.assertTrue(r["contradiction_flagged"] and r["contradiction_asked"])

    def test_real_plan_header(self):
        plan = 'Tier: T3 (sinais: deleção/irreversível, dados persistentes, contradição no pedido "deletar" vs "nunca perder dados")\n1. a'
        r = self.g([msg([call("plan_mode_complete", plan=plan)])], ["delet|apag", "perd"])
        self.assertTrue(r["contradiction_flagged"])
        self.assertFalse(r["contradiction_asked"])

    def test_real_plan_section(self):
        plan = 'Tier: T3\nlog de acesso\n## Contradição\n"Incluindo tokens" em claro conflita com LGPD art. 6º\n'
        r = self.g([msg([call("plan_mode_complete", plan=plan)])], ["log", "LGPD|token"])
        self.assertTrue(r["contradiction_flagged"])

    def test_not_flagged_and_words(self):
        r = self.g([msg([text("delete e perde, tudo certo")])], ["delet|apag", "perd"])
        self.assertFalse(r["contradiction_flagged"] or r["contradiction_asked"])
        r = self.g([msg([text("delete x perder")])], ["delet", "perd"])
        self.assertTrue(r["contradiction_flagged"] and not r["contradiction_asked"])
        self.assertIsNone(p.grade([msg([text("a")])], CASE)["contradiction_asked"])

    def test_resubmits_and_tokens(self):
        ev = [usage_msg([call("plan_mode_complete", plan="1. a")], 10),
              usage_msg([call("plan_mode_complete", plan="1. b")], 5),
              usage_msg([call("plan_mode_complete", plan="1. c")], 7)]
        r = p.grade(ev, CASE)
        self.assertEqual((r["resubmits"], r["out_tokens"]), (2, 22))
        self.assertEqual(p.grade([msg([text("x")])], CASE)["resubmits"], 0)
        agg = p.aggregate([r, p.grade([msg([text("x")])], CASE)])
        self.assertEqual((agg["resubmits"], agg["out_tokens"]), (1.0, 11.0))

    def test_title_len_as_shown(self):
        self.assertTrue(p.title_len_ok("1. Rename `lst` to `tasks` in store.py and test_app.py ok"))
        self.assertFalse(p.title_len_ok("1. Rename `lst` to `tasks` in store.py and test_app.py ok!"))

    def test_final_plan_after_edit_and_atfile(self):
        calls = [
            {"name": "plan_mode_complete", "arguments": {"plan": "Tier: T0 (x)\n1. um titulo bem longo que passa de cinquenta caracteres aqui"}},
            {"name": "edit", "arguments": {"path": "/tmp/x/plans/p.md", "edits": [
                {"oldText": "um titulo bem longo que passa de cinquenta caracteres aqui", "newText": "titulo curto"}]}},
            {"name": "edit", "arguments": {"path": "/tmp/x/other.md", "edits": [{"oldText": "Tier", "newText": "ZZZ"}]}},
            {"name": "plan_mode_complete", "arguments": {"plan": "@file"}},
        ]
        self.assertEqual(p.final_plan(calls), "Tier: T0 (x)\n1. titulo curto")
        self.assertEqual(p.final_plan(calls[:1] + [{"name": "plan_mode_complete", "arguments": {"plan": "Tier: T1 (y)"}}]), "Tier: T1 (y)")
        self.assertEqual(p.final_plan([]), "")
        enc = [calls[0], {"name": "edit", "arguments": {"path": "/tmp/x/plans/p.md", "edits": json.dumps(
            [{"oldText": "um titulo bem longo que passa de cinquenta caracteres aqui", "newText": "curto"}])}},
               {"name": "edit", "arguments": {"path": "/tmp/x/plans/p.md", "edits": "nao-json"}}]
        self.assertEqual(p.final_plan(enc), "Tier: T0 (x)\n1. curto")

    def test_old_agent_dir_shadow(self):
        import subprocess, tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            pm = d / "agent" / "npm/node_modules/pi-code/extensions/plan-mode"
            pm.mkdir(parents=True)
            (d / "agent/settings.json").write_text("{}")
            (pm / "index.ts").write_text("base\n")
            (d / "new").mkdir()
            (d / "new/index.ts").write_text("base\n" + p.MARK + "\n")
            diff = subprocess.run(["diff", "-u", "--label", "a/plan-mode/index.ts", "--label", "b/plan-mode/index.ts",
                                   str(pm / "index.ts"), str(d / "new/index.ts")], capture_output=True, text=True).stdout
            (d / "p.patch").write_text(diff)
            (pm / "index.ts").write_text("base\n" + p.MARK + "\n")
            (d / "tmp").mkdir()
            root = p.old_agent_dir(d / "tmp", d / "agent", d / "p.patch")
            self.assertEqual((root / "npm/node_modules/pi-code/extensions/plan-mode/index.ts").read_text(), "base\n")
            self.assertTrue((root / "settings.json").is_symlink())
            self.assertIn(p.MARK, (pm / "index.ts").read_text())  # installed copy untouched

if __name__ == "__main__":
    unittest.main()
