"""pipeline.py: guardas, dedup, lotes e cobertura do /insecure-defaults-audit (porte do audit.js), mais o
seed-coverage do plugin (cada exemplo VULNERABLE do corpus casa algum seed via grep -E).

Run: python3 ~/.pi/agent/claude-home/skills/insecure-defaults/scripts/tests/test_pipeline.py
"""
import importlib.util
import json
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('pipeline', Path(__file__).resolve().parents[1] / 'pipeline.py')
assert SPEC and SPEC.loader
pipeline = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pipeline)

RECON = {'scope_exists': True, 'languages': ['python'], 'frameworks': [], 'config_locations': ['app/settings.py'],
         'config_accessors': [{'idiom': "get_config('X', d)", 'where': 'app/cfg.py:3', 'supplies_default': True}],
         'deploy_manifests': ['Dockerfile'], 'exclude_paths': ['tests/']}


def sweep(files_scanned=10, candidates=(), derived=('x',), corpus=True, patterns=True):
    return {'corpus_read': corpus, 'patterns_loaded': patterns, 'files_scanned': files_scanned,
            'seed_patterns_run': ['s1'], 'derived_patterns': list(derived), 'candidates': list(candidates)}


def cand(file, line):
    return {'file': file, 'line': line, 'snippet': 's', 'symbol': 'K', 'why_suspicious': 'w'}


class Base(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp()
        out = pipeline.cmd_init('src', self.base)
        self.assertEqual(out['status'], 'ok', out)
        self.run_dir = Path(out['run'])

    def write(self, name, data):
        (self.run_dir / name).write_text(json.dumps(data))

    def to_discover(self, sweeps):
        self.write('recon.json', RECON)
        self.assertEqual(pipeline.cmd_sweeps(self.run_dir)['status'], 'ok')
        for cid, data in sweeps.items():
            self.write(f'sweep-{cid}.json', data)
        return pipeline.cmd_discover(self.run_dir)

    def all_sweeps(self, **overrides):
        data = {cid: sweep() for cid in pipeline.CATEGORY_IDS}
        data.update(overrides)
        return data


class CorpusTest(unittest.TestCase):
    def test_shipped_corpus_is_consistent(self):
        self.assertEqual(pipeline.corpus_problems(), [])
        self.assertEqual(sorted(p.stem for p in pipeline.REFS.glob('*.json')), sorted(pipeline.SEED_FILES.values()))
        self.assertEqual(sorted(p.stem for p in pipeline.REFS.glob('*.md')), sorted(pipeline.CATEGORY_IDS))

    def test_every_vulnerable_example_matches_a_seed(self):
        """seed-coverage.js: um exemplo documentado que nenhum seed casa é uma lacuna silenciosa."""
        all_seeds = [(c, s) for c in pipeline.CATEGORY_IDS
                     for s in json.loads((pipeline.REFS / f'{pipeline.SEED_FILES[c]}.json').read_text())['seeds']]
        examples, gaps = 0, []
        with tempfile.NamedTemporaryFile('w', suffix='.txt') as snippet:
            def matches(pattern, code):
                Path(snippet.name).write_text(code)
                return subprocess.run(['grep', '-Eq', pattern, snippet.name]).returncode == 0
            for cid in pipeline.CATEGORY_IDS:
                md = (pipeline.REFS / f'{cid}.md').read_text()
                vulnerable = re.split(r'^## .*SECURE', md, flags=re.M)[0]
                for label, code in re.findall(r'\*\*(.+?)\*\*[^\n]*\n+```[a-z]*\n(.*?)```', vulnerable, flags=re.S):
                    examples += 1
                    if not any(matches(s, code) for _, s in all_seeds):
                        gaps.append(f'{cid}: {label}')
        self.assertGreater(examples, 10, 'a extração quebrou, não o corpus ficou limpo')
        self.assertEqual(gaps, [])

    def test_init_refuses_a_broken_corpus(self):
        real = pipeline.REFS
        broken = Path(tempfile.mkdtemp())
        try:
            pipeline.REFS = broken
            out = pipeline.cmd_init('.', tempfile.mkdtemp())
        finally:
            pipeline.REFS = real
        self.assertEqual(out['status'], 'corpus-unreadable')
        self.assertNotIn('run', out)


class PhaseGuardsTest(Base):
    def test_init_writes_recon_prompt(self):
        text = (self.run_dir / 'prompts' / 'recon.md').read_text()
        self.assertIn("test -e 'src'", text)
        self.assertIn(str(self.run_dir / 'recon.json'), text)

    def test_recon_failed_and_scope_missing(self):
        self.assertEqual(pipeline.cmd_sweeps(self.run_dir)['status'], 'recon-failed')
        self.write('recon.json', {**RECON, 'scope_exists': False})
        self.assertEqual(pipeline.cmd_sweeps(self.run_dir)['status'], 'scope-missing')

    def test_sweeps_write_six_prompts_with_context(self):
        self.write('recon.json', RECON)
        out = pipeline.cmd_sweeps(self.run_dir)
        self.assertEqual([s['category'] for s in out['sweeps']], pipeline.CATEGORY_IDS)
        text = Path(out['sweeps'][0]['prompt']).read_text()
        self.assertIn("get_config('X', d)", text)  # o perfil do recon chega à varredura
        self.assertIn('fallback-secrets.json', text)
        self.assertNotIn('scope_exists', text)
        # files_scanned = arquivos percorridos, não arquivos com casamento (senão uma busca limpa vira "não buscada")
        self.assertIn('**percorreram**, tenham casado ou não', text)
        self.assertIn('candidates: []', text)

    def test_corpus_failure_aborts(self):
        out = self.to_discover(self.all_sweeps(**{'weak-crypto': sweep(corpus=False)}))
        self.assertEqual((out['status'], out['categories_affected']), ('corpus-unreadable', ['weak-crypto']))

    def test_zero_files_is_search_failed_not_clean(self):
        out = self.to_discover({cid: sweep(files_scanned=0) for cid in pipeline.CATEGORY_IDS})
        self.assertEqual(out['status'], 'search-failed')
        self.assertIn('NÃO auditoria limpa', out['note'])
        out = self.to_discover({})
        self.assertEqual(out['status'], 'search-failed')

    def test_no_candidates_names_unsearched_categories(self):
        out = self.to_discover(self.all_sweeps(**{'debug-features': sweep(files_scanned=0)}))
        self.assertEqual(out['status'], 'no-candidates')
        self.assertEqual(out['unsearched_categories'], ['debug-features'])
        self.assertIn('não prova de ausência', out['note'])


class BatchTest(Base):
    def test_dedup_keys_on_category_file_line(self):
        dup = [cand('a/x.py', 1), cand('a/x.py', 1), cand('a/x.py', 2)]
        out = self.to_discover(self.all_sweeps(**{'weak-crypto': sweep(candidates=dup),
                                                  'permissive-access': sweep(candidates=[cand('a/x.py', 1)])}))
        self.assertEqual(out['status'], 'ok')
        st = json.loads((self.run_dir / 'state.json').read_text())
        keys = sorted(f"{c['category']}:{c['file']}:{c['line']}" for c in st['candidates'])
        self.assertEqual(keys, ['permissive-access:a/x.py:1', 'weak-crypto:a/x.py:1', 'weak-crypto:a/x.py:2'])
        self.assertEqual(st['sweeps_summary']['raw'], 4)

    def test_batches_cap_at_16_and_keep_directories_whole(self):
        cands = [cand('big/f.py', i) for i in range(20)] + [cand('a/x.py', i) for i in range(10)] + \
                [cand('b/y.py', i) for i in range(10)]
        for c in cands:
            c['category'] = 'weak-crypto'
        batches = pipeline.pack_batches(cands)
        self.assertTrue(all(len(b['candidates']) <= 16 for b in batches))
        self.assertEqual(sum(len(b['candidates']) for b in batches), 40)
        self.assertEqual([b['dirs'] for b in batches], [['a'], ['b'], ['big'], ['big']])
        self.assertEqual([b['label'] for b in batches], [f'weak-crypto-{i}' for i in range(1, 5)])
        one = pipeline.pack_batches([{**cand('z.py', 1), 'category': 'debug-features'}])
        self.assertEqual((one[0]['label'], one[0]['dirs']), ('debug-features', ['.']))

    def test_verify_prompt_groups_by_file(self):
        out = self.to_discover(self.all_sweeps(**{'weak-crypto': sweep(candidates=[cand('a/x.py', 3), cand('a/x.py', 9)])}))
        text = Path(out['batches'][0]['prompt']).read_text()
        self.assertIn('weak-crypto.md', text)
        self.assertIn('"a/x.py"', text)
        self.assertIn('em `a`', text)
        self.assertIn('```json', text)


class VerifyTest(Base):
    def setUp(self):
        super().setUp()
        self.out = self.to_discover(self.all_sweeps(
            **{'weak-crypto': sweep(candidates=[cand('a/x.py', 1), cand('a/x.py', 2)]),
               'permissive-access': sweep(candidates=[cand('a/x.py', 1)]),
               }))

    def verdict(self, label, verdicts, wrap=False):
        body = json.dumps({'verdicts': verdicts})
        text = f'Relato longo...\n```json\n{body}\n```\n' if wrap else body
        (self.run_dir / 'verdicts' / f'{label}.json').write_text(text)

    def test_confirmed_refuted_and_cross_category_omission(self):
        self.verdict('weak-crypto', [
            {'file': 'a/x.py', 'line': 1, 'refuted': False, 'severity': 'HIGH', 'rationale': 'md5 em senha'},
            {'file': 'a/x.py', 'line': 2, 'refuted': True, 'refuted_at_step': 3, 'rationale': 'cache key'}], wrap=True)
        # permissive-access voltou sem veredito para a mesma linha: não pode ser mascarado pelo weak-crypto
        self.verdict('permissive-access', [])
        out = pipeline.cmd_verify(self.run_dir)
        self.assertEqual((out['status'], out['confirmed'], out['refuted'], out['unadjudicated']), ('ok', 1, 1, 1))
        result = json.loads((self.run_dir / 'result.json').read_text())
        self.assertEqual(result['coverage']['unadjudicated'], ['permissive-access:a/x.py:1'])
        self.assertEqual(result['coverage']['batches_verified'], 2)
        self.assertEqual(result['findings'][0]['category'], 'weak-crypto')
        self.assertIn('md5 em senha', (self.run_dir / 'prompts' / 'report.md').read_text())

    def test_missing_refuted_field_counts_as_refuted(self):
        self.verdict('weak-crypto', [{'file': 'a/x.py', 'line': 1, 'rationale': '?'}])
        self.verdict('permissive-access', [{'file': 'a/x.py', 'line': 1, 'refuted': True}])
        out = pipeline.cmd_verify(self.run_dir)
        self.assertEqual(out['confirmed'], 0)

    def test_nothing_adjudicated_is_verify_failed(self):
        out = pipeline.cmd_verify(self.run_dir)
        self.assertEqual(out['status'], 'verify-failed')
        self.assertEqual(out['coverage']['batches_verified'], 0)

    def test_finish_statuses(self):
        self.verdict('weak-crypto', [{'file': 'a/x.py', 'line': 1, 'refuted': False, 'severity': 'LOW'}])
        pipeline.cmd_verify(self.run_dir)
        self.assertEqual(pipeline.cmd_finish(self.run_dir)['status'], 'report-failed')
        (self.run_dir / 'report.md').write_text('# Relatório\n')
        self.assertEqual(pipeline.cmd_finish(self.run_dir)['status'], 'findings')


class CliTest(unittest.TestCase):
    def test_exit_codes(self):
        script = Path(pipeline.__file__)
        ok = subprocess.run(['python3', script, 'check-corpus'], capture_output=True, text=True)
        self.assertEqual((ok.returncode, json.loads(ok.stdout)['status']), (0, 'ok'))
        bad = subprocess.run(['python3', script, 'verify', '/nonexistent-run'], capture_output=True, text=True)
        self.assertEqual(bad.returncode, 3)
        self.assertEqual(json.loads(bad.stdout)['status'], 'error')
        usage = subprocess.run(['python3', script], capture_output=True, text=True)
        self.assertEqual(usage.returncode, 2)


if __name__ == '__main__':
    unittest.main()
