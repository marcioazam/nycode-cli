"""A suíte visível tem de ficar verde, completa e independente de ordem (SPEC 14)."""

import os
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIN_TESTS = 77


def _run(*targets):
    """Roda pytest num subprocesso; devolve (código, contagens, fim da saída)."""
    with tempfile.TemporaryDirectory() as tmp:
        report = Path(tmp) / "report.xml"
        cmd = [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider"]
        cmd += ["-o", "xfail_strict=true", f"--junitxml={report}", *targets]
        env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        env.pop("PYTEST_ADDOPTS", None)
        proc = subprocess.run(
            cmd,
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        counts = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0}
        if report.is_file():
            for suite in ET.parse(report).getroot().iter("testsuite"):  # nosemgrep
                for key in counts:
                    counts[key] += int(suite.get(key, 0))
        return proc.returncode, counts, (proc.stdout + proc.stderr)[-1500:]


def _test_files():
    tests = ROOT / "tests"
    found = set(tests.rglob("test_*.py")) | set(tests.rglob("*_test.py"))
    return sorted(str(p.relative_to(ROOT)) for p in found)


def _check(result, minimum):
    code, counts, tail = result
    assert code == 0, tail
    assert counts["failures"] == 0 and counts["errors"] == 0, tail
    assert counts["skipped"] == 0, f"skip/xfail não é permitido: {counts}"
    assert counts["tests"] >= minimum, f"testes executados: {counts}"


def test_visible_suite_is_green_and_complete():
    _check(_run("tests"), MIN_TESTS)


def test_visible_suite_passes_with_files_reversed():
    files = _test_files()
    assert files, "tests/ sem arquivos de teste"
    _check(_run(*reversed(files)), MIN_TESTS)


def test_each_visible_file_passes_alone():
    files = _test_files()
    assert files, "tests/ sem arquivos de teste"
    total = 0
    for name in files:
        result = _run(name)
        _check(result, 1)
        total += result[1]["tests"]
    assert total >= MIN_TESTS, f"testes executados arquivo por arquivo: {total}"
