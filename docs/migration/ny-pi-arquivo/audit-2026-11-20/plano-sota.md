# Plano SOTA em cima do audit (2026-11-20)

Alvo: o menor conjunto de mudanças que elimina cada achado confirmado do audit de cinco domínios, no working tree de `feat/ui-onda9-harness`. SOTA aqui é o controle estável já exigido pelo próprio harness (fail closed, lockfile com hash, WCAG 2.2 AA no que o código decide, hot path sem trabalho por quadro), não uma reescrita nem uma versão mais nova do pi.

Nada de commit, push ou `install.sh --link --apply` sem pedido explícito. A coluna Estado começa vazia e só é preenchida no gate final.

## Fora deste plano

- Itens `needs_validation` (magic bytes do `xdg-open`, DNS rebinding do `quote_check.py`, ROI do cache de 1h, cliff de preço em 200k). Ficam registrados, sem código.
- Sandbox de SO (`bwrap`) e parser de shell por AST: decisão `dono` em [docs/audit-2026-11-19/06-melhorias.md](../audit-2026-11-19/06-melhorias.md). O guard por lista continua com o limite conhecido (baixar e executar depois, script escrito pelo agente, alias de arquivo).
- Subir `pi` 1.5.2 → 1.6.0 ou `pi-code` 1.7.0 → 1.10.1.
- Apagar scratch/backup em `~/.claude` e religar o `~/.pi/agent` vivo.
- Leitura de segredo, `local.env`, `auth*.json`.
- P3 (não mutar `tools` no plan mode): nota, sem patch. Muda o que o modelo vê.

## Estado

| ID | Onda | Estado | Prova |
| --- | --- | --- | --- |
| F1 | 1 | corrigido | `test_run_start_is_checked_and_unknown_action_is_deny`; pytest `claude-home/hooks` 280 passed |
| F2 | 1 | corrigido | `test_uniq_operand_after_pipe_is_not_allow` |
| F4 | 1 | corrigido | `AUDIT_2026_11_20`: 11 payloads deny, também com bypass |
| F6 | 1 | corrigido | `test_grep_ancestor_and_proc` |
| F8 | 1 | corrigido | `test_tmp_symlink_to_protected_file_is_deny`: symlink para `local.env` fica ask; escrever `guard.py` fica deny |
| D3 | 1 | corrigido | `test_lite_matcher_blocks_on_failure` |
| F3 | 2 | corrigido | `ArrayPathTests.test_array_path_does_not_run_id` (`jq -j`, sem `eval`) |
| F5 | 2 | corrigido | `extensions/ui/test/sanitizar.test.ts`; `set-clipboard external` em `test_server_args_have_no_user_args` |
| F9 | 2 | corrigido | `patches-manifest.test.sh`: `evil.test.patch` conta 1; sem manifesto recusa |
| V4 | 2 | corrigido | `patches-manifest.sh check` exit 0; carimbo inclui o manifesto |
| F7 | 2 | corrigido | `bundle.sh` umask 077, exclui `local.env*` e `mcp.json*`; `harbor==0.25.0` |
| V1 | 3 | corrigido | `osv-scanner.toml` GHSA-qx49-fqc8-xw99 até 2026-12-20 |
| V2 | 3 | corrigido | `install-lib.sh` copia `pi-lsp.package-lock.json` antes do `npm ci` |
| V3 | 3 | corrigido | `install_pi_core` confere sha512 dos 8 tarballs `@earendil-works/pi-*@1.5.2` |
| P1-mcp | 3 | corrigido | `check_mcp_pins.py` 0 problemas |
| D8 | 3 | corrigido | `check_publish_list.py` 0; `instruction_budget.py` 10571 / base 10578 |
| P1-render | 4 | corrigido | `arcoNoHud` só renova `visto` quando o render não é o próprio |
| P2 | 4 | corrigido | `mesmaSaida` em `chat-margin/inset.ts`; matcher do sticky só no `message_end` do usuário |
| P5 | 4 | corrigido | relógio de `motion.ts` e indicador de `working.ts` em `globalThis` |
| P4 | 4 | corrigido | `ligarCaminhos` não faz `stat` com a cerca aberta |
| P7 | 4 | corrigido | `memoHighlight` não guarda cerca sem `\n` final |
| B01 | 5 | corrigido | `image-open` `abrirUltima` e comando `imagem` |
| B02 | 5 | corrigido | `comandos/test/painel.test.ts`: Esc/q/ctrl+c fecham; setas não fecham |
| B03 | 5 | não corrigido | `try/catch` de `Theme.bg()` continua em `teclas()`, `comandos/painel.ts` e `diagnostico/painel.ts`; glifo de aba do patch tab-cyan não foi refeito |
| B04 | 5 | corrigido | glide, `suportado` e `enviar` usam `movimento()`; `PI_REDUCED_MOTION=0` ainda desliza (`sheet.test.ts`, `progresso.test.ts`) |
| B06 | 5 | corrigido | `theme-contrast.test.ts` 10 passed, 1 skipped (mono) |
| B07 | 5 | corrigido | o mesmo portão; HTML `g13-contraste.html` ganhou `lang`, viewport e `<main>` (a tabela é medição antiga, não o portão) |
| contrato | 6 | corrigido | skills ausentes marcadas como opcionais; `code-mapper` saiu da lista Haiku |
| V5 | 6 | corrigido | quatro `LICENSE-*` no `publish.list`; `NOTICE` já cita MIT, CC-BY-SA-4.0 e tree-sitter-wasm |
| P3 | — | não corrigido | fora do plano: mutar tools no plan mode |
| sandbox | — | não corrigido | decisão do dono |
| upgrade-pi | — | não corrigido | 12 patches não aplicam |
| needs_validation | — | não corrigido | sem código |

Gate estático (`CI=true`, `HOME=/tmp/tmp.Sm5y7K6Avn`, `scripts/ci/run-static.sh`): exit 1. O script lintou 528 arquivos mudados contra a base. Falharam ruff, mypy, biome, shellcheck, shfmt, markdownlint, structure, testes de install, dois casos de stamp que não são o manifesto, `check-refs` em docs antigos, pytest porque `coverage` não está no PATH, e testes de node sob `TERM=dumb`. `patches-manifest.test.sh` e `check_publish_list.py` passaram dentro dessa corrida. Sem commit, push ou `--link --apply` no `~/.pi` real. Allowlist do gitleaks não entrou: os três falsos positivos não estão rastreados.

## Onda 1 — o guard volta a ser fronteira

Testes em `claude-home/hooks/permissions/tests/test_guard_bypass.py`. Vermelho = `decide()` devolve `None`.

- **F1.** Tratar `tool == "run"` em `claude-home/hooks/guard.py` (`action: start` passa `command` por `check_bash`; ação desconhecida é deny). Matcher `Bash|run|Edit|Write|Read|Grep` em `claude-home/settings.json.example` e `claude-home/lite/settings.json`. O nome da tool continua `run`.
- **F2.** Em `claude-home/hooks/permissions/shell.py`, `uniq` usa operandos de verdade. `"-"` e o que vem depois de `--` são operandos. Mais de um operando, ou operando depois de pipe, não é somente-leitura.
- **F4.** Em `claude-home/hooks/permissions/parse.py` e `guard.py`: tirar `\\\n` fora de aspas simples antes do tokenize; extrair `$( )` de heredoc sem aspas; `builtin` e `coproc` entram em `START_DROP`/`WRAPPERS`; `function nome()`, `case PALAVRA in`, `bash -c -o OPT SCRIPT` e `env -S` grudado deixam de esconder `rm -rf /`.
- **F6.** `Grep` nega se o caminho é ancestral de qualquer entrada de `READ_DENY_FILES`/`READ_DENY_DIRS`, e nega `/proc`. O teste usa diretório temporário.
- **F8.** `check_file` compara `abspath` e `realpath` antes do atalho de `/tmp`. `local.env`, `mcp-auth.json`, `settings.json` do agente e `hooks/guard.py` não são graváveis: a auto-modificação do guard é deny (o bypass não promove deny a allow).

**D3.** `claude-home/lite/settings.json` ganha `Grep`, `run` e `"onFailure": "block"`.

Aceite: `pytest claude-home/hooks` verde; `rm -rf /` e os 11 payloads continuam deny com `PI_BYPASS_PERMISSIONS=1`; `uniq - arquivo` não é allow em `default`.

## Onda 2 — hooks, patches e o que o wrapper verifica

- **F3.** `hook-dispatch.sh` deixa de fazer `eval "$fields"`. `jq -j` emite campos separados por NUL, cada um forçado a string. O teste manda `path` como array e afirma que `id` não executa.
- **F5.** Sanitizador único (C0/C1, CSI, OSC, DCS) na borda de exibição: `motion/shell.ts`, `motion/marcas.ts` (texto do OSC 8), `mcp/linha.ts`, `sub/chips.ts`, `hook-msgs/index.ts`, `code-blocks/blocks.ts`, `calm-statusline.mjs`. `transport_tmux.py` troca `set-clipboard on` por `external`.
- **F9 + V4.** `bin/pi` usa `find -L`, falha fechado se `patches.sha256` sumiu (escape só por variável de teste). O manifesto exclui `*.test.ts|mjs|js|sh`, nunca `*.patch`. `pi_stamp_key` inclui o sha256 do manifesto e deixa `*.test.*` fora do digest. `run-static.sh` chama `patches-manifest.sh check`. Caso `evil.test.patch` no teste.
- **F7.** Harbor: excluir `local.env*` e `mcp.json*`; `OUT` em diretório `0700` com `umask 077`; unpack `a+rX` e escrita só em `diag/`; `harbor==0.25.0`.

## Onda 3 — o CI volta a dizer a verdade

- **V1.** Exceção curta de `GHSA-qx49-fqc8-xw99` em `scripts/ci/osv-scanner.toml`: dono, motivo (CI-only; fix em `mcp>=1.30.0`, preso pelo semgrep), `effectiveUntil` ≤ 30 dias a partir de 2026-11-20.
- **V2.** Lock do `pi-lsp` fora do patch, `package-lock.json` que o `osv-scanner` lê, regenerado com `--omit=dev --omit=peer`. `install-lib.sh` copia esse lock antes do `npm ci`.
- **P1, parcial.** Lock dos três `npx -y` de `mcp.json.example`, `npm ci --ignore-scripts`, example aponta para o binário local.
- **D8.** `check_publish_list.py` volta a 0. Dois diretórios de teste de `extensions/ui-visual/` descem a ≤7 arquivos de código. Apagar `undefined/` vazio. `extensions/cache-prefix-probe/` sai do catálogo e do `publish.list`. `CLAUDE.md` perde ≥138 tokens, cortando repetição.
- **V3.** `install_pi_core` confere os hashes `sha512` dos 8 `@earendil-works/pi-*@1.5.2` que já estão em `npm/package-lock.json`. Não troca o lock baixado do pi.dev.

## Onda 4 — render

- **P1.** `footer-no-stats.ts`: `visto` não é renovado pelo próprio `requestRender`. `NO_COLOR` e `mono` não emitem `\x1b[38;2;`.
- **P2.** `mesmaSaida` e os `.slice()` devolvem o mesmo array quando a entrada não mudou. O matcher do sticky-prompt só reconstrói em `message_end` de `user`.
- **P5.** Relógio de `motion.ts` em `globalThis`. `working.ts` não chama `setWorkingMessage` a cada chunk de SSE.
- **P4 e P7.** `ligarCaminhos` não faz `statSync` em token parcial. Bloco de código aberto não entra no `hlCache` como se estivesse fechado.

## Onda 5 — acessibilidade

- **B01.** Teclado em `image-open` abre a última imagem pelo mesmo caminho do clique.
- **B02.** Painéis de avisos (`recentes`) e comandos rolam com setas; `Esc`/`q` fecham.
- **B03.** Fundo via `noColor()` / fundo vazio, sem `try/catch` morto em `Theme.bg()`. Foco e aba aberta diferem por glifo.
- **B04.** Sheet, progresso, notificar e `liveComet` passam por `movimento()` / `noColor()`. `PI_REDUCED_MOTION=0` não conta como ligado. A barra para em `reduzido`.
- **B06 e B07.** Só os pares que a conta fechou abaixo do limiar. Texto ≥4,5:1, borda/scrollbar ≥3:1. 4,499 não passa.
- HTML de `docs/ui-ux-gallery/` por último: `lang`, viewport, landmark, botão com `type` e estado, atalho só com foco no demo, pausa no `.spin`.

## Onda 6 — contrato escrito igual ao código

- Alinhar `agent-contract.md`, `rules/safety.md`, docstring de `guard.py`, `general-purpose.md`, `git-delivery.md`, `doces-ou-travessuras/SKILL.md`.
- Frontmatter: tirar `code-mapper`, `reliability-operations` e `evidence-research` dos agentes que o repo não entrega, ou marcar a skill como opcional no texto.
- `claude-tier.md`: timeout dentro do teto de `bash-timeout`, ou sai do catálogo público.
- `settings.json.example`: `statusLine` usa `node` do `PATH`; `impeccable_gate.sh` não entra enquanto a skill não estiver em `third-party.json`.
- **V5.** Restaurar os `LICENSE-*` Apache-2.0 citados e uma linha no `NOTICE` para CC-BY-SA-4.0, `@vscode/tree-sitter-wasm` e os originais em `patches/pi-code/orig/`.
- Allowlist estreito do gitleaks só para os três falsos positivos se aqueles arquivos forem commitados.

## Aceite

- Cada ID das ondas 1–6 termina `corrigido` ou `não corrigido` com o motivo deste arquivo.
- `pytest claude-home/hooks`, `check_publish_list.py`, `instruction_budget.py check`, `patches-manifest.sh check` e `check_mcp_pins.py` verdes.
- Contraste: nenhum par declarado no teste novo fica abaixo de 4,5 (texto) ou 3,0 (borda/scrollbar).
- Gate único no fim: `scripts/ci/run-static.sh` com `CI=true` e `HOME` descartável. `run-security.sh` só se os binários já estiverem instalados.

## Risco que o plano não apaga

Quem tem o mesmo uid do agente ainda escreve o `guard.py` no disco. A onda 1 impede a tool de fazer isso pelo caminho `uniq`/`Write`; não impede um processo irmão. A resposta estrutural continua sendo o sandbox, fora daqui.

O `~/.pi/agent` vivo não recebe a onda 1 enquanto não houver `--link --apply` autorizado.
