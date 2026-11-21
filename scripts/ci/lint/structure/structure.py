"""Bounded first-party source inventory for the pi harness; never follows symlinks. pi-owned copy (2026-11-12) of ~/.codex/bin/harness_checks/structure.py; evolves independently of Codex."""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
import os
from pathlib import Path

CODE_SUFFIXES = frozenset('''.py .pyi .js .jsx .mjs .cjs .ts .tsx .mts .cts .rs .go .c .h
.cpp .hpp .cc .cxx .cs .java .kt .kts .swift .dart .rb .php .sh .bash .zsh .fish
.lua .pl .pm .r .R .sql .vue .svelte .astro .scala .sc .ex .exs .erl .hrl .hs
.clj .cljs .cljc .fs .fsx .f90 .f .jl .nim .zig .ps1 .bat .cmd .awk .sed
.html .css .scss .sass .less .graphql .gql .proto .rules'''.split())
# These are tool-owned formats/locations; ambiguous vendor, build, dist and docs count.
ARTIFACT_DIRS = {'.git', 'node_modules', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache'}
MAX_FILES = 100000
# Third-party files kept byte-identical to upstream, keyed by (root name, relative path); each is
# excluded only while its git blob hash equals the pinned upstream blob. The pins live here, never
# in the scanned tree, so a scanned file cannot exempt itself. Record:
# ~/.pi/agent/claude-home/docs/pi-agent-fleet-2026-11-12.md.
VENDORED = {
    # pbakaus/impeccable@e103efe779e2dd01274dabae83531fef00bf2563:.agents/skills/impeccable/scripts/live-browser.js
    ('impeccable', 'scripts/live-browser.js'): '2b149cbd90cfd4d2392cec740ba8b75e22981ff5',
    # npm pi-code@1.7.0 (shasum 8ba1f814773da6897f6708c62c7c517cee2baf4e):extensions/subagent/<file>, files the
    # local pi patches never touch (~/.pi/agent/claude-home/docs/pi-agent-fleet-2026-11-12.md).
    ('subagent', 'agents.ts'): '37b976fde0efd11fbdc046ff8e8c8dbe6991cfd7',
    ('subagent', 'child.ts'): '60247f4015be87b71be2e24f7d63d5aa75446f73',
    ('subagent', 'params.ts'): 'ef86f4e2eef678b4fe05ab0667b6396a00f3c2d4',
    ('subagent', 'render-result.ts'): 'f916512e42e9b5cb360a30e11f596476adbdcfc2',
    ('subagent', 'render.ts'): '2e9f1a023ec320f1e19ecdb9d0461b218850dfd0',
    ('subagent', 'types.ts'): 'ef3cd062c68089be5d7983f7c25f27d93ea0c468',
    ('subagent', 'worktree.ts'): 'd24c0a13a757450a7793a11479bea1cee9c7c4b5',
}


def git_blob_sha1(path):
    """Git blob id of a regular file, streamed (same value as `git hash-object`)."""
    digest = hashlib.sha1(b'blob %d\0' % path.stat().st_size)
    with path.open('rb') as stream:
        while chunk := stream.read(65536):
            digest.update(chunk)
    return digest.hexdigest()


def generated_outputs(root):
    """Verify a fixed local recipe; untrusted manifests never select executable code."""
    candidates = [root] if root.name == 'diagram-design' else [
        root / 'diagram-design', root / 'skills/diagram-design']
    verified, errors = set(), []
    for candidate in candidates:
        if not (candidate / 'assets/generated-examples.json').exists():
            continue
        try:
            # This implementation belongs to the installed harness, never the scanned tree.
            source = Path(__file__).resolve().parents[2] / 'skills/diagram-design/scripts/compose_examples.py'  # optional: diagram-design skill not shipped
            if any(path.is_symlink() for path in (source, *source.parents)):
                raise ValueError('untrusted verifier alias')
            spec = importlib.util.spec_from_file_location('harness_diagram_recipe', source)
            if spec is None or spec.loader is None:
                raise ValueError('missing trusted verifier')
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            verified.update(str((candidate / name).relative_to(root))
                            for name in module.verify_generated(candidate))
        except (OSError, ValueError, ImportError, AttributeError):
            errors.append(f'invalid-generation-proof:{candidate.relative_to(root)}')
    return verified, errors


def source_file(path):
    if path.suffix in CODE_SUFFIXES or path.name in {'Dockerfile', 'Makefile', 'Justfile'}:
        return True
    if path.suffix or path.name.startswith('.'):
        return False
    with path.open('rb') as stream:
        return stream.read(2) == b'#!'


def scan(root: Path):
    root = root.absolute()
    errors, notes, counts = [], [], Counter()
    if any(path.is_symlink() for path in (root, *root.parents)) or not root.is_dir() or root.resolve() in {Path('/'), Path.home().resolve(), Path('/home')}:
        return ['unsafe-or-missing-project-root'], notes, 0
    generated, proof_errors = generated_outputs(root)
    errors.extend(proof_errors)
    total = 0
    seen = set()
    def walk_error(exc):
        errors.append(f'unreadable-directory:{type(exc).__name__}')
    for current, directories, filenames in os.walk(root, followlinks=False, onerror=walk_error):
        current_path = Path(current)
        retained = []
        for name in sorted(directories):
            path = current_path / name
            relative = str(path.relative_to(root))
            if path.is_symlink():
                errors.append(f'symlink-directory:{relative}')
            elif name in ARTIFACT_DIRS:
                notes.append(f'excluded-tool-artifact:{relative}')
            else:
                retained.append(name)
        directories[:] = retained
        for name in sorted(filenames):
            path = current_path / name
            relative = str(path.relative_to(root))
            total += 1
            if total > MAX_FILES:
                return errors + ['inventory-limit-exceeded'], notes, sum(counts.values())
            if path.is_symlink():
                errors.append(f'symlink-file:{relative}')
                continue
            try:
                if not path.is_file():
                    errors.append(f'nonregular-file:{relative}')
                    continue
                if not source_file(path):
                    continue
                if relative in generated:
                    notes.append(f'verified-generated:{relative}')
                    continue
                pin = VENDORED.get((root.name, relative))
                if pin is not None and git_blob_sha1(path) == pin:
                    notes.append(f'verified-vendored:{relative}')
                    continue
                stat = path.stat()
                identity = (stat.st_dev, stat.st_ino)
                if identity in seen:
                    errors.append(f'hardlink-alias:{relative}')
                seen.add(identity)
                counts[str(path.parent.relative_to(root))] += 1
                # Count bytes to avoid Unicode newline/encoding ambiguity and bound memory.
                with path.open('rb') as stream:
                    lines, last = 0, b''
                    while chunk := stream.read(65536):
                        lines += chunk.count(b'\n')
                        last = chunk[-1:]
                    lines += int(bool(last) and last != b'\n')
                if lines > 800:
                    errors.append(f'over-800-lines:{relative}:{lines}')
            except OSError as exc:
                errors.append(f'unreadable-file:{relative}:{type(exc).__name__}')
    errors.extend(f'over-7-code-files:{name}:{count}' for name, count in sorted(counts.items()) if count > 7)
    return errors, notes, sum(counts.values())


def main(argv=None):
    """Run a project inventory without importing harness configuration or checks."""
    parser = argparse.ArgumentParser(description='Check 800-line and 7-code-file limits.')
    parser.add_argument('--project-root', required=True, type=Path,
                        help='Explicit project directory; home and filesystem roots are rejected.')
    parser.add_argument('--json', action='store_true', help='Emit a machine-readable report.')
    args = parser.parse_args(argv)
    root = args.project_root.absolute()
    findings, exclusions, code_files = scan(root)
    report = {'root': str(root), 'code_files': code_files,
              'findings': findings, 'exclusions': exclusions}
    if args.json:
        print(json.dumps(report, ensure_ascii=True))
    else:
        status = 'FAIL' if findings else 'PASS'
        print(f'{status}: {root} ({code_files} code files, {len(findings)} findings)')
        for finding in findings:
            print(f'  finding: {finding}')
        for exclusion in exclusions:
            print(f'  exclusion: {exclusion}')
    return 1 if findings else 0


if __name__ == '__main__':
    raise SystemExit(main())
