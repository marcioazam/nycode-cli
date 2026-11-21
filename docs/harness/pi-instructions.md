# Instruções globais do pi (porta de ~/.claude/CLAUDE.md e ~/.claude/rules, 2026-11-11)

## O que carrega e de onde

| Arquivo pi | Origem | Quem carrega |
|---|---|---|
| `claude-home/CLAUDE.md` | `~/.claude/CLAUDE.md` (o `~/.codex/AGENTS.md` que ele importa deixou de ser fonte em 2026-11-12) | pi-code `context-imports.ts` como *user CLAUDE.md* (`$CLAUDE_CONFIG_DIR/CLAUDE.md`), sem gate de trust |
| `claude-home/rules/*.md` | `~/.claude/rules/*.md` (4 arquivos) | pi-code `claude-rules.ts` como "Global Rules", sem gate de trust |
| `claude-home/commands/pre-launch.md`, `swarm.md` | `~/.claude/commands/` (citados pelo contrato) | pi-code `commands.ts` (`/pre-launch`, `/swarm`) |

O wrapper `~/.local/bin/pi` exporta `CLAUDE_CONFIG_DIR=~/.pi/agent/claude-home`; os subagentes herdam o env e
carregam os mesmos arquivos, salvo agentes com `omitClaudeMd: true` (campo do Claude Code v2.1.271+, que o
pi-code não implementa). Paridade com o Claude (code.claude.com/docs/en/sub-agents): os builtins Explore e Plan começam
sem CLAUDE.md; um agente do usuário com o mesmo nome substitui o builtin e carregaria o CLAUDE.md, salvo
`omitClaudeMd: true`. Como `claude-home/agents/Explore.md` e `Plan.md` substituem os builtins, os dois declaram o campo.
Quem aplica: a extensão `~/.pi/agent/extensions/no-context-files-covers-claude-md.ts` (fora do pacote, sobrevive a
`pi update`), que liga `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` (o interruptor do pi-code) no filho de um agente com o campo
(nome lido de `--system-prompt <tmp>/prompt-<nome>.md`) e em qualquer `pi --no-context-files`/`-nc`, cuja promessa
("desliga a descoberta de CLAUDE.md") antes só valia para os context files nativos. Testes:
`node --experimental-strip-types --test ~/.pi/agent/claude-home/bin/tests/no-context-files.test.ts`; verificado
2026-11-11 com um `subagent` paralelo (gate-runner com o contrato; Explore e Plan: NONE). Os originais em
`~/.claude` e `~/.codex` continuam só do Claude Code e do Codex; as cópias divergem daqui em diante.

Por que autocontido e não `@import` do `~/.codex/AGENTS.md`: o pi-code recusa import fora de cwd, repositório e
raízes de config (`~/.claude`, `~/.pi`), e o AGENTS.md traz a seção "Runtime: Codex" e caminhos que não valem no pi.
Cuidado: no texto (fora de código) qualquer `@palavra` vira tentativa de import.

## Adaptações por arquivo

- **CLAUDE.md**: seções Precedence, Delivery, Long tasks, Boundaries, Engineering, Verification, Release and CI,
  Evidence and tools mantidas na íntegra; troca de vocabulário (Skill tool → `read` do SKILL.md, AskUserQuestion →
  `question`, plan file → `plan_mode_complete`, ToolSearch → `tool_search`, context-mode → filtros no `bash`).
  "Runtime: Codex" e "Runtime: Claude Code" viraram "Runtime: pi": tiers por `model:` do agente (subagent sem modelo
  por chamada), 4 writers simultâneos (limite do pi, no lugar dos 5 do `swarm-lanes`), sem hook de plano (o loop do
  `plan-reviewer` é explícito), linhas `Graph:`/`knowledge vault:` pelo hook `hooks/graph_context.py` (SessionStart e SubagentStart), `memory` no lugar da auto memory.
  Removidos: ponytail/caveman (plugins inexistentes no pi), "seções 14–24" (referência a doc externo), o
  `harness-check` como passo global (foi para `rules/harness-economy.md`, só quando arquivos compartilhados mudam).
- **docs-and-knowledge**: caminhos do `kb.py`/`vault_lint.py` em claude-home; sem hook de lembrete de captura nem scan
  semanal (o modelo checa os gatilhos e roda o `vault_lint.py` quando preciso).
- **harness-economy**: escopo = harness do pi; checks concretos (`check-instructions.py`, `check-agents.py`,
  `test_guard`, testes do goal patch); custo pelo JSONL de sessão do pi (o `subagent_cost.py` só lê transcripts do
  Claude); adoção por eval via `pelo-em-ovo`. Melhoria: "requisito sem exceção vai para hook, não para prosa"
  (code.claude.com/docs/en/best-practices).
- **research-and-tools**: provedores e leitores em `skills/deep-search/references/providers.md` (versão pi);
  variantes de busca como `/skill:...`; workflows do Claude não portados (executar à mão); isolamento de writers
  com `git worktree add` + `cwd` (o `subagent` não tem `isolation`); codegraph sem auto-init; browser só playwright
  (sem chrome-devtools/browser-use); recall pelo `rg` nas sessões do pi; background via `nohup`.
- **safety**: descreve o controle real do pi (bypass do wrapper + `hooks/guard.py`). Melhoria com paridade: o guard
  passou a negar o `read` dos 12 caminhos de segredo que o Claude nega por `Read(...)` deny, mais `auth.json`,
  `mcp-auth.json` e `claude-home/.credentials.json` do pi (matcher `Bash|Edit|Write|Read`, testes em
  `hooks/test_guard.py`, custo medido: 44 ms ± 6 ms por `read`, hyperfine, 30 execuções). A exceção do preflight
  de worktree do Claude não se aplica. Intake de terceiros cobre `pi install`, extensões e `mcp.json`.

## Fontes consultadas (2026-11-11)

- https://code.claude.com/docs/en/memory: CLAUDE.md abaixo de 200 linhas; instruções específicas e verificáveis;
  rules sem `paths` carregam sempre; regras do usuário em `~/.claude/rules`; imports não reduzem contexto.
- https://code.claude.com/docs/en/best-practices: o que deve ficar sempre carregado; requisito sem exceção vai para
  hook ou deny.
- Docs locais do pi (`docs/configuration.md`, `security.md`): context files carregam sem trust; `AGENTS.md`
  global do pi existe, mas o caminho escolhido é o do pi-code para manter a estrutura do Claude (CLAUDE.md + rules).
- Código do pi-code 1.7.0: `claude-rules.ts`, `context-imports.ts`, `subagent/child.ts`, `commands.ts`.

## Complementos (2026-11-11, segunda rodada)

- **Linhas `Graph:`/`knowledge vault:`**: `hooks/graph_context.py`, porta do hook do Claude (mesmo auto-init de `codegraph` em
  checkouts main sob `~/source`, mesmo diretório de marcadores, então Claude e pi não indexam em dobro), registrado em
  `settings.json` para SessionStart (`startup|resume|clear|compact`) e SubagentStart (`*`). Mudanças: `tool_search`,
  `rg/fdfind`, caminho do `kb.py` em claude-home, aviso de workspace sem o campo `isolation`. Testes:
  `hooks/test_graph_context.py` (5; red com o script do Claude, green com a porta). Custo: 23 ms ± 1 com cache de
  status (60 s), 230 ms ± 7 sem. Verificado com `pi -p` em `~/source/9router-astra-compat`: sessão com as duas
  linhas, subagente com `Graph:`.
- **Divergência das fontes**: `docs/pi-instructions.sources.json` guarda o sha256 de cada fonte portada (lista atual em Manutenção); o
  `check-instructions.py` acusa fonte mudada e rule nova no Claude. Depois de portar a mudança:
  `check-instructions.py --accept-sources`.
- **`$N` nas skills `offensive-*`**: 66 ocorrências de `$<dígito>`, `$@` e `${N:-x}` escapadas como `\$` (o
  pi-code tira a barra na expansão). Antes: `/skill:offensive-crash-analysis ALVO 10.0.0.5` trocava `"$1"` por (optional)
  `"10.0.0.5"` (30 linhas nas três skills medidas); depois: 0 linhas alteradas nas 79 skills, medido com o
  `substituteArgs` do próprio pi-code. Os 10 avisos que o `pi_harness_check.py` dava (`WIN!`, `${7*7}`) eram
  falsos positivos; desde 2026-11-12 ele segue a regra real do pi-code (`` !` `` só depois de espaço e fora de
  bloco cercado; `${...}` só com `N:-`) e dá 0.

## Hooks restantes do Claude: custo x benefício (2026-11-11, terceira rodada)

> **Atualizado em 2026-11-11 (quarta rodada), [`pi-hooks-port.md`](pi-hooks-port.md):** cada hook do `~/.claude` e
> dos plugins ligados foi relido e julgado de novo por custo x benefício. Entraram as notas e lembretes do
> `hook-dispatch.sh` (dispatcher), o gate do impeccable e o escopo de subagente do ponytail; telemetria, auditoria,
> ledger de claims e `route_hint` seguem fora, agora com dados. A tabela abaixo já reflete a quarta rodada.

Critério (terceira rodada): entra no pi só o que paga o próprio custo; observação passiva vira relatório offline, sem hook.

| Hook do Claude | No pi | Custo medido | Por quê |
|---|---|---|---|
| `plan/plan_gate.py` (Stop, SubagentStop, ExitPlanMode) | `~/.pi/agent/extensions/plan-gate.ts` | zero sem plano aprovado; com plano, 1 continuação e o `plan-reviewer` (~$0,09 no teste) | cumpre a decisão de 2026-11-08; antes dependia do modelo lembrar |
| `sound-notify.py` (Stop) | `~/.pi/agent/extensions/sound-notify/index.ts` | 1 processo por turno, só interativo | o `notify.ts` do pi-code só avisa quando o terminal está "ausente" |
| `tool_use_telemetry.py`, `subagent_telemetry.py`, auditoria do `hook-dispatch.sh`, `claims/cade_o_print.py` | `bin/telemetry/pi_telemetry.py` (relatório das sessões) | zero em execução; 0,28 s para 81 sessões | no Claude só observavam (nada bloqueavam); a sessão do pi já guarda chamadas, resultados, `usage` e custo |
| `route_hint.py` (UserPromptSubmit) | não portado | até 1200 caracteres por prompt que casa, 26 ms | no Claude está ligado (`CLAUDE_HARNESS_ROUTE_HINT=1`), mas as dicas foram "seguidas" numa mediana de ~38% sem controle; o pi já lista skills e agentes no prompt |
| `hook-dispatch.sh` SessionStart e PostToolUse (notas e lembretes) | `hooks/dispatch/hook-dispatch.sh` (quarta rodada) | 4,5 ms por chamada de ferramenta | mudam o comportamento do modelo: retomada pós-compactação, teste editado, injeção, knowledge vault, entrega git |
| `hook-dispatch.sh` PreToolUse `Agent\|Task` (worktree) | nativo do pi-code | — | `subagent/worktree.ts` falha a execução isolada fora de um checkout Git |
| plugins impeccable e ponytail | `hooks/impeccable_gate.sh`, `vendor/ponytail/pi-extension` (quarta rodada) | ~5 ms por Edit/Write; ponytail poupa ~1870 tokens por turno em subagentes não writers | detalhes em `pi-hooks-port.md` |

- **plan-gate**: aprovação = mensagem `plan-mode-execute` do plan-mode do pi-code; veredito = última linha
  `PLAN_REVIEW:` no resultado de um `subagent` com `plan-reviewer` (single, `tasks` ou `chain`); edição = `edit`/`write`
  depois da aprovação (como o ledger do Claude). Libera com `PLAN CANCELLED`/`BLOCKED:`/`WAITING:` (ou `PLANO ...`)
  e com plan mode ligado; desiste após 3 paradas sem progresso ou 30 bloqueios; só na sessão principal; falha
  aberta; `PI_PLAN_GATE=0` desliga. Estado = entradas `custom` `plan-gate` na sessão. Testes:
  `bin/tests/plan-gate.test.ts` (13). Verificado ao vivo: aprovação injetada, edição, bloqueio `no_review`, o modelo chamou
  gate-runner e plan-reviewer, `completed`.
- **completion-gate** (`extensions/completion-gate.ts`, 2026-11-13): em `agent_before_settle`, se o turno editou um
  arquivo de código (`edit`/`write`) e nenhuma checagem passou depois (`bash` de teste/lint/type/build ou `gate-runner`),
  bloqueia uma vez por turno pedindo a checagem ou a declaração de adiamento. Fora de subagentes e do plan mode;
  `PI_COMPLETION_GATE=0` desliga; falha aberta. Testes: `bin/tests/gates/completion-gate.test.ts` (11). A/B e decisão:
  `preamble-diet-completion-gate-2026-11-13.md`.
- **google-only-agy** (`extensions/google-only-agy/index.ts`, 2026-11-13): ferramentas do antigravity-bridge só com modelo
  Google; Keenable diferido no `mcp.json`. Medição e rollback: `preamble-diet-completion-gate-2026-11-13.md`, item 4.
- **skill hubs** (2026-11-13): `gsap-core` e `emil-design-eng` apontam para irmãs ocultas; registro no item 5 de
  `preamble-diet-completion-gate-2026-11-13.md`.
- **rules-ref/** (2026-11-13): `research-and-tools`, `docs-and-knowledge` e `harness-economy` saíram do carregamento
  fixo; o gatilho para lê-las está em CLAUDE.md (Evidence and tools). Só `rules/safety.md` continua inline.
- **sound-notify**: em `agent_settled` (uma vez por turno, depois de continuações), só com UI e fora de subagente;
  `PI_SOUND_NOTIFY=0` desliga. Teste: `bin/tests/sound-notify.test.ts`; verificado em tmux com player falso (1 som por
  turno interativo, 0 no `pi -p`).
- **prefix-cache-1h** (`extensions/prefix-cache-1h/index.ts`, 2026-11-12): em `before_provider_request`, põe
  `ttl: 1h` no cache de tools e system, só com UI e fora de subagente; `PI_PREFIX_CACHE_1H=0` desliga. Replay
  ≈ US$ 4,45/dia líquidos; A/B e testes em `pi-claude-harness-transfer-2026-11-12.md` ("Fechamento, rodada 2");
  teste `bin/tests/prefix-cache-1h.test.ts`.
- **Relatórios**: `python3 ~/.pi/agent/claude-home/bin/telemetry/pi_telemetry.py [tools|subagents|audit|claims|plan-gate|cost|all]
  [--since DIAS] [--json]`. `claims` usa `hooks/claims/claims.py` e `patterns.ere`, cópias literais das do Claude
  (vigiadas pelo manifesto). Só metadados; o alvo da auditoria sai mascarado.

## Manutenção

- Validar: `python3 ~/.pi/agent/claude-home/bin/checks/check-instructions.py [--refresh]` (tamanho, `@` como import,
  frontmatter, caminhos, skills/agentes, ferramentas MCP, comandos `/x`, vocabulário só do Claude, `$N`/`$@`
  acidentais em skills e commands pelo `bin/checks/arg-expansion-check.mjs`, divergência das fontes).
- Fonte do Claude mudou (o validador acusa): `check-instructions.py --diff` mostra o diff contra o snapshot da
  última porta (`docs/pi-instructions.sources/`) e o arquivo do pi que a porta; portar à mão, adaptando; depois
  `--accept-sources` grava hashes e snapshot. Fontes vigiadas: CLAUDE.md, as 4 rules, `graph_context.py`,
  `plan_gate.py`, `sound-notify.py`, `claims.py`, `patterns.ere` e, desde a quarta rodada, os hooks portados em
  `pi-hooks-port.md` mais o inventário de hooks do Claude (bloco `hooks` do `settings.json` e hooks dos plugins
  ligados); hook novo em `~/.claude/hooks` aparece como "hook novo no Claude, sem porta".
- Não criar `~/.pi/agent/AGENTS.md`: duplicaria este contrato no prompt. (optional)

## Desvínculo do Codex (decisão do usuário, 2026-11-12)

O pi e o harness dele não executam, não checam e não sincronizam nada do Codex. O `~/.codex/AGENTS.md` saiu das
fontes vigiadas (`PORTS`, manifesto e snapshot); o contrato do pi é o `claude-home/CLAUDE.md`. O checador de estrutura
é a cópia própria `claude-home/bin/structure/structure.py` (com testes); `harness-check` do Codex e `codex exec` saíram
das regras; licenças das fontes adaptadas foram copiadas para `docs/third-party/`. Detalhe e evidência:
`docs/pi-agent-fleet-2026-11-12.md`, seção "Desvínculo do Codex".

## Sincronização 2026-11-12: 13 regras Read de bloqueio

- Fonte: `~/.claude/rules/safety.md` (23:07) passou de "twelve" para "thirteen" regras `Read(...)` de bloqueio; a nova é
  `Read(~/.claude-44/.credentials.json)` em `~/.claude/settings.json`.
- O `guard.py` do pi já negava o caminho (`CLAUDE_CREDENTIALS_RE` cobre `~/.claude-<qualquer>/.credentials.json`);
  mudaram só o texto de `rules/safety.md` e do docstring do guard. `test_guard.py` passou a listar um caminho por
  regra (`.claude-3` e `.claude-44` incluídos): hooks 30 OK, dispatch 29 OK. `check-instructions --accept-sources`
  depois da porta: 0 problema(s).
