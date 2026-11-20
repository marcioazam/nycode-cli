#!/usr/bin/env python3
"""Gera o anexo E: destino de cada arquivo rastreado do ny-pi.

Uso: git -C <ny-pi> ls-tree -r --name-only origin/main | python3 gerar-mapa.py > E-mapa-arquivo-a-arquivo.tsv
A primeira regra que casa vence. Sai com código 1 se algum caminho não casar com regra nenhuma.
"""

import re
import sys

CA = "packages/coding-agent"
EXT = f"{CA}/src/extensions"
RES = f"{CA}/resources"
TEST = f"{CA}/test/harness"

# (id, regex, destino, ação, fase). Ações: mover, fundir, converter, absorver, remover.
RULES: list[tuple[str, str, str, str, str]] = [
    # Raiz e governança (F2)
    ("G01", r"^README\.md$", "README.md", "fundir", "F2"),
    ("G02", r"^CHANGELOG\.md$", "docs/harness/CHANGELOG-ny-pi.md", "mover", "F2"),
    ("G03", r"^(CODE_OF_CONDUCT|SUPPORT)\.md$", r"\1.md", "mover", "F2"),
    ("G04", r"^(CONTRIBUTING|SECURITY)\.md$", r"\1.md", "fundir", "F2"),
    ("G05", r"^NOTICE$", "NOTICE", "fundir", "F2"),
    ("G06", r"^LICENSE$", "LICENSE (a do destino, mesma MIT)", "remover", "F2"),
    ("G07", r"^\.(editorconfig|gitattributes|gitignore)$", r".\1", "fundir", "F2"),
    ("G08", r"^\.(gitleaks\.toml|leak-allow|pre-commit-config\.yaml)$", r".\1", "mover", "F2"),
    ("G09", r"^\.githooks/pre-commit$", ".husky/pre-commit", "absorver", "F2"),
    ("G10", r"^\.github/(CODEOWNERS|PULL_REQUEST_TEMPLATE\.md|release\.yml)$", r".github/\1", "mover", "F2"),
    ("G11", r"^\.github/DISCUSSION_TEMPLATE/(.+)$", r".github/DISCUSSION_TEMPLATE/\1", "mover", "F2"),
    ("G12", r"^\.github/ISSUE_TEMPLATE/(.+)$", r".github/ISSUE_TEMPLATE/\1", "fundir", "F2"),
    ("G13", r"^\.github/dependabot\.yml$", ".github/dependabot.yml", "converter", "F2"),
    # CI e ruleset (F3)
    ("C01", r"^\.github/zizmor\.yml$", ".github/zizmor.yml", "mover", "F3"),
    ("C02", r"^\.github/rulesets/main\.json$", ".github/rulesets/main.json", "converter", "F3"),
    ("C03", r"^\.github/workflows/(.+)$", r".github/workflows/\1", "converter", "F3"),
    ("C04", r"^scripts/ci/biome\.json$", "biome.json do destino (D-06)", "remover", "F3"),
    ("C05", r"^scripts/ci/(.+)$", r"scripts/ci/\1", "converter", "F3"),
    ("C06", r"^scripts/check-leaks\.sh$", "scripts/ci/check-leaks.sh", "mover", "F3"),
    ("C07", r"^scripts/(check-refs\.py|refs-allow\.txt|test_check_refs\.py)$", r"scripts/ci/lint/\1", "converter", "F3"),
    ("C08", r"^scripts/fixtures/leak/(.+)$", r"scripts/ci/fixtures/leak/\1", "mover", "F3"),
    ("C09", r"^claude-home/bin/structure/(.+)$", r"scripts/ci/lint/structure/\1", "converter", "F3"),
    ("C10", r"^docs/ci-local\.md$", "docs/ci-local.md", "converter", "F3"),
    # Benchmark (F3)
    ("B01", r"^bench/arms/omp$", "(braço omp fora das medições, D-26)", "remover", "F3"),
    ("B02", r"^bench/(.+)$", r"bench/\1", "converter", "F3"),
    ("B03", r"^docs/bench/(.+)$", r"docs/bench/\1", "mover", "F3"),
    ("B04", r"^claude-home/bin/evals/harbor/(omp-release\.sh|omp_agent\.py|tests/test_omp_agent\.py)$",
     "(braço omp fora das medições, D-26)", "remover", "F3"),
    ("B05", r"^claude-home/bin/evals/(.+)$", r"bench/evals/\1", "converter", "F3"),
    # Wrapper, configuração e patches de core (F4)
    ("K01", r"^bin/pi$", f"{CA}/src/cli/args.ts + src/core/settings-defaults.ts (K3, K4)", "absorver", "F4"),
    ("K02", r"^bin/test_pi_env\.sh$", f"{TEST}/core/settings-env.test.ts", "converter", "F4"),
    ("K03", r"^(settings\.json|local\.env)\.example$", f"{CA}/src/core/settings-defaults.ts + docs/settings.md (K4)",
     "absorver", "F4"),
    ("K04", r"^(mcp|models|lsp)\.json\.example$", rf"{CA}/examples/config/\1.json", "mover", "F4"),
    ("K05", r"^claude-home/patches/pi-core/cache-warm-identity\.mjs$", f"{CA}/src/core/sdk.ts (K1)", "absorver", "F4"),
    ("K06", r"^claude-home/patches/pi-core/mcp-close-grace\.mjs$", "packages/mcp/src/transports/stdio.ts (K2)",
     "absorver", "F4"),
    ("K07", r"^claude-home/patches/pi-core/mcp-close-grace\.test\.ts$", "packages/mcp/test/stdio-close-grace.test.ts",
     "converter", "F4"),
    ("K08", r"^claude-home/bin/tests/cache-warm-identity\.test\.ts$", f"{TEST}/core/cache-warm-identity.test.ts",
     "converter", "F4"),
    ("K09", r"^claude-home/bin/tests/config/models-example\.test\.ts$", f"{TEST}/core/models-example.test.ts",
     "converter", "F4"),
    # pi-code: patches viram fonte (F5, F6)
    ("P01", r"^claude-home/patches/pi-code/orig/.+$", "(original do pi-code; a referência é o tarball 1.7.0)", "remover", "F5"),
    ("P02", r"^claude-home/patches/pi-code/(commands-print)\.patch$", f"{EXT}/commands/", "absorver", "F5"),
    ("P03", r"^claude-home/patches/pi-code/(notify-focus)\.patch$", f"{EXT}/notify/", "absorver", "F5"),
    ("P04", r"^claude-home/patches/pi-code/(rewind-tree)\.patch$", f"{EXT}/git-checkpoint/", "absorver", "F5"),
    ("P05", r"^claude-home/patches/pi-code/(statusline-multiline|zzzzzzzz-statusline-provider)\.patch$",
     f"{EXT}/status-line/", "absorver", "F5"),
    ("P06", r"^claude-home/patches/pi-code/(todo-collapse)\.patch$", f"{EXT}/todo/", "absorver", "F5"),
    ("P07", r"^claude-home/patches/pi-code/(notify-focus|rewind-tree|statusline-multiline|todo-collapse)\.test\.ts$",
     rf"{TEST}/extensions/\1.test.ts", "converter", "F5"),
    ("P08", r"^claude-home/patches/pi-code/zzzzzzzz-statusline-provider/(.+)$",
     rf"{TEST}/extensions/status-line/\1", "converter", "F5"),
    ("P09", r"^claude-home/patches/pi-code/goal\.patch$", f"{EXT}/goal/", "absorver", "F6"),
    ("P10", r"^claude-home/patches/pi-code/(goal|goal-lifecycle)\.test\.ts$", rf"{TEST}/extensions/goal/\1.test.ts",
     "converter", "F6"),
    ("P11", r"^claude-home/patches/pi-code/(zz-hotkeys-no-alt|zzzz-plan-done-rule|zzzzz-plan-sota)\.patch$",
     f"{EXT}/plan-mode/", "absorver", "F6"),
    ("P12", r"^claude-home/patches/pi-code/(zzzz-plan-done-rule|zzzzz-plan-sota)/(.+)$",
     rf"{TEST}/extensions/plan-mode/\2", "converter", "F6"),
    ("P13", r"^claude-home/patches/pi-code/[a-z-]*(subagent|panel|team)[a-z0-9-]*\.patch$", f"{EXT}/subagent/",
     "absorver", "F6"),
    ("P14", r"^claude-home/patches/pi-code/subagent-nesting\.test\.ts$", f"{TEST}/extensions/subagent/nesting.test.ts",
     "converter", "F6"),
    ("P15", (r"^claude-home/patches/pi-code/(subagent-panel|subagent-render|team|zz-subagent-respawn|"
             r"zzzzzz-subagent-send|zzzzzzz-subagent-model-effort)/(.+)$"),
     rf"{TEST}/extensions/subagent/\1/\2", "converter", "F6"),
    ("P16", r"^scripts/check-patch-stack\.sh$", "(sem pilha de patches)", "remover", "F6"),
    # Extensões próprias (F7, F8)
    ("E01", r"^extensions/(cache-prefix-probe)/.+$", "(D-10)", "remover", "F7"),
    ("E02", r"^extensions/(no-web-search|no-context-files-covers-claude-md)\.ts$", "(D-10)", "remover", "F7"),
    ("E03", r"^claude-home/bin/tests/no-context-files\.test\.ts$", f"{TEST}/extensions/claude-rules/context-files.test.ts",
     "converter", "F7"),
    ("E04", r"^claude-home/bin/telemetry/(cache_probe_join\.py|test_cache_probe_join\.py|cache-remeasure\.sh)$",
     "(acompanha cache-prefix-probe, D-10)", "remover", "F7"),
    ("E05", r"^extensions/bash-timeout/index\.ts$", f"{CA}/src/core/tools/bash.ts (K8)", "absorver", "F7"),
    ("E06", r"^extensions/bash-timeout/index\.test\.ts$", f"{TEST}/core/bash-timeout.test.ts", "converter", "F7"),
    ("E07", r"^extensions/compact-at-400k\.ts$", f"{CA}/src/core/compaction/ (K9)", "absorver", "F7"),
    ("E08", r"^claude-home/bin/tests/compact-at-400k\.test\.ts$", f"{TEST}/core/compact-threshold.test.ts",
     "converter", "F7"),
    ("E09", r"^scripts/compaction-400k\.py$", "(K9)", "remover", "F7"),
    ("E10", r"^extensions/pi-docs/index\.ts$", f"{CA}/src/core/system-prompt.ts (K7)", "absorver", "F7"),
    ("E11", r"^extensions/pi-docs/index\.test\.ts$", f"{TEST}/core/docs-pointer.test.ts", "converter", "F7"),
    ("E12", r"^extensions/bypass-permissions/index\.ts$", f"{CA}/src/core/permissions/ (K11)", "absorver", "F8"),
    ("E13", r"^extensions/todo-sync/index\.ts$", f"{EXT}/todo/stale-reminder.ts", "fundir", "F7"),
    ("E14", r"^extensions/todo-sync/index\.test\.ts$", f"{TEST}/extensions/todo/stale-reminder.test.ts", "converter", "F7"),
    ("E15", r"^extensions/completion-gate\.ts$", f"{EXT}/completion-gate/index.ts", "mover", "F7"),
    ("E16", r"^claude-home/bin/tests/gates/completion-gate\.test\.ts$", f"{TEST}/extensions/completion-gate/index.test.ts",
     "converter", "F7"),
    ("E17", r"^extensions/plan-gate\.ts$", f"{EXT}/plan-gate/index.ts", "mover", "F7"),
    ("E18", r"^claude-home/bin/tests/plan-gate\.test\.ts$", f"{TEST}/extensions/plan-gate/index.test.ts", "converter", "F7"),
    ("E19", r"^extensions/footer-no-stats\.ts$", f"{EXT}/footer/index.ts", "mover", "F7"),
    ("E20", r"^extensions/puxar\.ts$", f"{EXT}/import-claude-session/index.ts", "mover", "F7"),
    ("E21", r"^claude-home/bin/puxar/(.+)$", r"scripts/harness/puxar/\1", "mover", "F7"),
    ("E22", r"^claude-home/bin/tests/(prefix-cache-1h|sound-notify)\.test\.ts$", rf"{TEST}/extensions/\1/index.test.ts",
     "converter", "F7"),
    ("E23", r"^extensions/syntax-check/package(-lock)?\.json$", f"{CA}/package.json (dependência exata)", "absorver", "F7"),
    ("E24", r"^extensions/([a-z0-9-]+)/test/(.+\.test\.ts)$", rf"{TEST}/extensions/\1/\2", "converter", "F7"),
    ("E25", r"^extensions/([a-z0-9-]+)/(.+\.test\.ts)$", rf"{TEST}/extensions/\1/\2", "converter", "F7"),
    ("E26", r"^extensions/([a-z0-9-]+)/(.+\.ts)$", rf"{EXT}/\1/\2", "mover", "F7"),
    ("E27", r"^themes/(.+)$", rf"{RES}/themes/\1", "mover", "F7"),
    ("E28", r"^claude-home/bin/tests/(pi-ui-final-gate\.sh|terminal-sota/.+)$", r"scripts/harness/ui-gates/\1",
     "converter", "F7"),
    # Recursos embarcados (F8)
    ("R01", r"^claude-home/CLAUDE\.md$", f"{RES}/instructions/contract.md", "converter", "F8"),
    ("R02", r"^claude-home/CLAUDE\.headless\.md$", f"{RES}/instructions/headless.md", "converter", "F8"),
    ("R03", r"^claude-home/lite/APPEND\.md$", f"{RES}/instructions/lite.md", "converter", "F8"),
    ("R04", r"^claude-home/lite/settings\.json$", f"{RES}/instructions/lite.settings.json", "converter", "F8"),
    ("R05", r"^claude-home/settings\.json\.example$", f"{CA}/src/core/settings-defaults.ts (hooks, statusLine, env)",
     "absorver", "F8"),
    ("R06", r"^claude-home/rules/(.+)$", rf"{RES}/rules/\1", "converter", "F8"),
    ("R07", r"^claude-home/rules-ref/(.+)$", rf"{RES}/rules/ref/\1", "converter", "F8"),
    ("R08", r"^claude-home/(agents|commands|skills)/(.+)$", rf"{RES}/\1/\2", "converter", "F8"),
    ("R09", r"^claude-home/hooks/fixtures/pi-code-1\.7\.0/(.+)$", rf"{TEST}/hooks/fixtures/\1", "mover", "F8"),
    ("R10", r"^claude-home/hooks/((?:.+/)?test_[^/]+\.py)$", rf"{TEST}/hooks/\1", "converter", "F8"),
    ("R11", r"^claude-home/hooks/(.+)$", rf"{RES}/hooks/\1", "converter", "F8"),
    ("R12", r"^claude-home/plugins/claude-hud/statusline\.mjs$", f"{RES}/statusline/statusline.mjs", "converter", "F8"),
    ("R13", r"^claude-home/bin/hud/tests/(.+)$", rf"{TEST}/statusline/\1", "converter", "F8"),
    ("R14", r"^claude-home/bin/hud/(.+)$", rf"{RES}/statusline/\1", "converter", "F8"),
    ("R15", r"^claude-home/bin/(.+)$", r"scripts/harness/\1", "converter", "F8"),
    # Terceiros (F9)
    ("T01", r"^patches/third-party/pi-lsp\.patch$", f"{EXT}/lsp/", "absorver", "F9"),
    ("T02", r"^patches/third-party/(ponytail|ralph-loop)\.patch$", r"fork próprio de \1 (D-11)", "converter", "F9"),
    ("T03", r"^third-party\.json$", "NOTICE + pacotes opcionais (D-11)", "remover", "F9"),
    # Documentação (transversal; entra com a fase que usa)
    ("D01", r"^docs/specs/(.+)$", r"docs/specs/\1", "converter", "F2"),
    ("D02", r"^claude-home/docs/(.+)$", r"docs/harness/\1", "converter", "F8"),
    # Instalação e publicação (F11)
    ("I01", r"^(install\.sh|publish\.list|scripts/install-lib\.sh|scripts/test_install\.sh)$",
     "instalador e campo files do pacote", "remover", "F11"),
    ("I02", r"^npm/.+$", "(pi-code é fonte do repositório)", "remover", "F11"),
]


def main() -> int:
    compiled = [(rid, re.compile(rx), dest, act, ph) for rid, rx, dest, act, ph in RULES]
    missing = []
    print("origem\tdestino\tacao\tfase\tregra")
    for line in sys.stdin:
        path = line.rstrip("\n")
        if not path:
            continue
        for rid, rx, dest, act, ph in compiled:
            match = rx.match(path)
            if match:
                print(f"{path}\t{match.expand(dest)}\t{act}\t{ph}\t{rid}")
                break
        else:
            missing.append(path)
    for path in missing:
        print(f"SEM REGRA: {path}", file=sys.stderr)
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
