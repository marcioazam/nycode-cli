"""Testes do verificador estrutural do harness pi (em processo, para o tracer medir)."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).with_name('structure.py')
_spec = importlib.util.spec_from_file_location('pi_structure', SCRIPT)
structure = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(structure)


class StructureTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def write(self, name, lines=1):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('# comment\n' * lines)
        return path

    def run_main(self, root=None, json_output=True):
        argv = ['--project-root', str(root or self.root)]
        if json_output:
            argv.append('--json')
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = structure.main(argv)
        return code, out.getvalue()

    def report(self, expected_exit=0, root=None):
        code, text = self.run_main(root)
        self.assertEqual(code, expected_exit)
        report = json.loads(text)
        self.assertEqual(set(report), {'root', 'code_files', 'findings', 'exclusions'})
        self.assertEqual(report['root'], str((root or self.root).absolute()))
        return report

    def test_empty_project_reports_zero_and_cli_requires_explicit_root(self):
        self.assertEqual(self.report()['code_files'], 0)
        # Único teste via subprocesso: a entrada de CLI.
        bare = subprocess.run([sys.executable, str(SCRIPT), '--json'],
                              text=True, capture_output=True, timeout=15)
        self.assertEqual(bare.returncode, 2)
        self.assertIn('--project-root', bare.stderr)
        ok = subprocess.run([sys.executable, str(SCRIPT), '--project-root', str(self.root), '--json'],
                            text=True, capture_output=True, timeout=15)
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertEqual(json.loads(ok.stdout)['findings'], [])

    def test_800_801_physical_lines_with_unterminated_last_line(self):
        source = self.write('code.py', 799)
        source.write_text(source.read_text() + '# last')
        self.assertEqual(self.report()['findings'], [])
        source.write_text(source.read_text() + '\n# overflow')
        self.assertEqual(self.report(1)['findings'], ['over-800-lines:code.py:801'])

    def test_seven_eight_direct_files_and_subdirectory(self):
        for index in range(7):
            self.write(f'{index}.ts')
        self.write('child/eighth.ts')
        self.assertEqual(self.report()['code_files'], 8)
        self.write('eighth.ts')
        self.assertEqual(self.report(1)['findings'], ['over-7-code-files:.:8'])

    def test_rules_are_executable_source_in_scan_api(self):
        self.write('policy.rules', 801)
        findings, exclusions, total = structure.scan(self.root)
        self.assertEqual(findings, ['over-800-lines:policy.rules:801'])
        self.assertEqual(exclusions, [])
        self.assertEqual(total, 1)

    def test_tests_scripts_rules_docs_and_vendor_are_first_party(self):
        for name in ('tests/test.py', 'scripts/run.sh', 'policy.rules',
                     'docs/example.py', 'vendor/owned.ts'):
            self.write(name, 801)
        self.write('runner').write_text('#!/usr/bin/env bash\n' + '\n' * 800)
        report = self.report(1)
        self.assertEqual(report['code_files'], 6)
        self.assertEqual(len(report['findings']), 6)
        self.assertIn('over-800-lines:policy.rules:801', report['findings'])
        self.assertEqual(report['exclusions'], [])

    def test_artifacts_are_reported_and_non_code_files_ignored(self):
        self.write('node_modules/lib/index.js', 801)
        self.write('settings.toml', 801)
        self.write('README.md', 801)
        self.write('notes', 801)
        self.write('.hidden', 801)
        self.write('empty.py', 0)
        report = self.report()
        self.assertEqual(report['code_files'], 1)
        self.assertEqual(report['exclusions'], ['excluded-tool-artifact:node_modules'])

    def test_symlink_file_directory_and_hardlink_evasions_fail(self):
        source = self.write('source.py')
        os.link(source, self.root / 'duplicate.py')
        (self.root / 'alias.py').symlink_to(source)
        (self.root / 'linked').symlink_to(self.root, target_is_directory=True)
        report = self.report(1)
        self.assertEqual(report['code_files'], 2)
        self.assertEqual(set(report['findings']), {
            'hardlink-alias:source.py', 'symlink-file:alias.py',
            'symlink-directory:linked'})

    def test_missing_unsafe_file_and_symlink_roots_are_rejected(self):
        file_root = self.write('file.py')
        linked = self.root / 'alias'
        linked.symlink_to(self.root, target_is_directory=True)
        for root in (self.root / 'missing', Path('/'), Path.home(),
                     Path('/home'), file_root, linked):
            with self.subTest(root=root):
                report = self.report(1, root)
                self.assertEqual(report['findings'], ['unsafe-or-missing-project-root'])
                self.assertEqual(report['code_files'], 0)

    def test_human_output_includes_result_counts_findings_and_exclusions(self):
        self.write('safe.py')
        code, text = self.run_main(json_output=False)
        self.assertEqual(code, 0)
        self.assertIn('PASS', text)
        self.assertIn('1 code files', text)
        self.write('unsafe.py', 801)
        self.write('node_modules/dependency.js')
        code, text = self.run_main(json_output=False)
        self.assertEqual(code, 1)
        self.assertIn('FAIL', text)
        self.assertIn('over-800-lines:unsafe.py:801', text)
        self.assertIn('excluded-tool-artifact:node_modules', text)

    def test_vendored_pin_excluded_only_while_blob_matches(self):
        path = self.write('scripts/vendored.js', 801)
        pin = {(self.root.name, 'scripts/vendored.js'): structure.git_blob_sha1(path)}
        with mock.patch.dict(structure.VENDORED, pin):
            findings, exclusions, total = structure.scan(self.root)
            self.assertEqual(findings, [])
            self.assertEqual(exclusions, ['verified-vendored:scripts/vendored.js'])
            self.assertEqual(total, 0)
            # Editar o arquivo invalida o pin: vira finding.
            path.write_text(path.read_text() + '# edit\n')
            findings, exclusions, _ = structure.scan(self.root)
            self.assertEqual(findings, ['over-800-lines:scripts/vendored.js:802'])
            self.assertEqual(exclusions, [])

    def test_inventory_limit_is_bounded(self):
        self.write('a.py')
        with mock.patch.object(structure, 'MAX_FILES', 0):
            findings, _, total = structure.scan(self.root)
        self.assertEqual(findings, ['inventory-limit-exceeded'])
        self.assertEqual(total, 0)

    def test_unknown_extensions_ignored_and_shebang_decides_extensionless(self):
        self.write('data.xyz', 801)
        (self.root / 'plain').write_text('not a script\n')
        (self.root / 'tool').write_text('#!/bin/sh\n')
        self.assertEqual(self.report()['code_files'], 1)

    def test_invalid_generation_proof_is_a_finding(self):
        skill = self.root / 'diagram-design'
        (skill / 'assets').mkdir(parents=True)
        (skill / 'assets/generated-examples.json').write_text('not json')
        generated, errors = structure.generated_outputs(self.root)
        self.assertEqual(generated, set())
        self.assertEqual(errors, ['invalid-generation-proof:diagram-design'])
        # Com a raiz chamada diagram-design o candidato é a própria raiz.
        named = self.root / 'x' / 'diagram-design'
        (named / 'assets').mkdir(parents=True)
        (named / 'assets/generated-examples.json').write_text('{}')
        _, errors = structure.generated_outputs(named)
        self.assertEqual(errors, ['invalid-generation-proof:.'])
        self.assertEqual(structure.scan(named)[0], ['invalid-generation-proof:.'])

    def test_generated_output_is_verified_and_excluded(self):
        # Verificador falso: o caminho de sucesso não depende dos exemplos reais.
        skill = self.root / 'diagram-design'
        (skill / 'assets').mkdir(parents=True)
        (skill / 'assets/generated-examples.json').write_text('{}')
        (skill / 'gen.html').write_text('<p>x</p>\n' * 900)
        fake = mock.Mock(verify_generated=lambda candidate: ['gen.html'])
        with mock.patch.object(structure.importlib.util, 'spec_from_file_location'), \
                mock.patch.object(structure.importlib.util, 'module_from_spec', return_value=fake):
            findings, exclusions, total = structure.scan(self.root)
        self.assertEqual(findings, [])
        self.assertEqual(exclusions, ['verified-generated:diagram-design/gen.html'])
        self.assertEqual(total, 0)

    @unittest.skipIf(os.getuid() == 0, 'root ignora permissões')
    def test_unreadable_directory_is_a_finding(self):
        locked = self.root / 'locked'
        locked.mkdir()
        locked.chmod(0)
        self.addCleanup(locked.chmod, 0o700)
        findings, _, _ = structure.scan(self.root)
        self.assertEqual(findings, ['unreadable-directory:PermissionError'])

    def test_fifo_is_nonregular(self):
        os.mkfifo(self.root / 'pipe.py')
        findings, _, total = structure.scan(self.root)
        self.assertEqual(findings, ['nonregular-file:pipe.py'])
        self.assertEqual(total, 0)


if __name__ == '__main__':
    unittest.main()
