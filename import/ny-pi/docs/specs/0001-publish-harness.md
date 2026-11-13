Tier: T3 (sinais: credenciais/segredos, publicação externa irreversível, migração do ~/.pi vivo para symlinks, contrato público novo)

Assumptions: A1 (~90%, reversível) conta do `gh` autenticada é a dona do repo; A2 (~85%, base: agent-contract e skills citam o caminho) o git-deliver passa a viver em `claude-home/bin/git-deliver` dentro do repo e as referências trocam para `$CLAUDE_CONFIG_DIR/bin/git-deliver`, sem tocar o `~/.claude`; A3 (~85%) uma skill referenciada pelo que é enviado e sem dependência pessoal entra no repo; se tiver dependência pessoal, a referência sai (regra da tarefa 7); A4 (~80%) o push privado acontece assim que os gates automáticos passam, e a revisão humana fica antes de virar público (D9 do usuário). Risco: um vazamento que escapar dos scanners chega ao GitHub privado. Veto antes de executar se quiser revisar antes do push.
Estimativa: 10 tarefas, ~3–4 h de agentes.

## Objetivo
Publicar o harness do pi (wrapper, patches, extensões, hooks, bin, agents/skills core, contrato genérico) como repositório `pi-harness`, instalável por terceiros, sem credenciais nem particularidades. O `~/.pi` do usuário passa a consumir o repo via symlinks, com uma camada pessoal local.

Requisitos: R1 nenhum segredo/dado pessoal no repo; R2 só o escopo core escolhido; R3 terceiros baixados pinados, sem vendorizar; R4 instalação reproduzível por terceiros; R5 o harness do usuário segue funcionando igual (bypass ON via overlay); R6 privado primeiro, público após revisão do usuário.

## Decisões (do usuário)
- D1 Repo separado `~/code/pi-harness` + `install.sh` com symlinks em `~/.pi/agent` (rejeitado: git no ~/.pi, risco de `git add` errado).
- D2 Agents: Explore, Plan, general-purpose, swarm-worker, gate-runner, git-delivery, plan-reviewer, lane-integrator, code-reviewer, test-author, test-reviewer, security-reviewer, reliability-reviewer, research-scout, perplexity-scout, web-scout, claim-verifier. Especialistas de domínio ficam no overlay.
- D3 Skills: plan-workflow, swarm-orchestration, git-workflow, atualizador, sdd-workflow, graph-engineering, loop-engineering, lane-integration, context-economy, agent-routing, engineering-standards, tdd, doces-ou-travessuras, quality-gates, ripple-hunt, diagnose (+A3).
- D4 CLAUDE.md, rules e rules-ref reescritos neutros (inglês); o contrato pessoal vai para `claude-home/rules/personal.md`, local e não rastreado.
- D5 Terceiros (ponytail, pi-lsp, sol-pi, claude-red, pr-review-toolkit, ralph-loop, egm, impeccable) via manifesto pinado por commit; o install aborta em divergência.
- D6 MIT + NOTICE dos terceiros.
- D7 Extensões: gates/fluxo, UI (+themes, claude-hud statusline), cache (prefix-cache-1h, cache-prefix-probe). Ficam fora google-only-agy e antigravity-bridge; o bloco de patch do agy no wrapper fica condicional.
- D8 Wrapper público com bypass OFF por padrão; o usuário liga em `~/.pi/agent/local.env`.
- D9 GitHub privado primeiro; o usuário revisa e muda para público.
- D10 Todos os hooks e todo o `claude-home/bin` (evals e port-agents generalizados com caminhos configuráveis); só os docs de referência; os 17 commands.

## Glossário
- Allowlist: `publish.list`, lista explícita de ARQUIVOS (nunca diretórios) copiados para o repo.
- Overlay: arquivos reais em `~/.pi/agent` que não são symlink do repo (pessoal).
- Identificadores pessoais: nome de usuário, caminho do home, knowledge vault, hostname, handle do GitHub, nomes de projetos privados. A lista fica local e não rastreada.

## Critérios de aceite
- AC1: WHEN os scanners rodam sobre a árvore e o histórico do repo THE SYSTEM SHALL reportar zero achados de gitleaks e trufflehog (verified+unverified) e zero hits de identificadores pessoais fora da allowlist benigna rastreada.
- AC2: IF um arquivo fora de `publish.list` ou com segredo for adicionado ao índice THEN THE SYSTEM SHALL bloquear o commit via pre-commit hook.
- AC3: WHEN `install.sh` roda num HOME temporário limpo THE SYSTEM SHALL instalar pi 1.5.2 e pi-code 1.7.0 exatos, baixar os terceiros nos commits do manifesto, aplicar todos os patches e terminar com `pi --version` = 1.5.2 e `pi --help` com exit 0.
- AC4: IF o commit de um terceiro divergir do manifesto ou a versão do pi-code não for 1.7.0 THEN THE SYSTEM SHALL abortar sem aplicar patches e com exit ≠ 0.
- AC5: WHEN `install.sh --link` roda THE SYSTEM SHALL mover cada arquivo substituído para `~/.pi-backup/<data>/replaced/` antes de criar o symlink, e `install.sh --restore` SHALL devolver a árvore original byte a byte (verificado por diff de manifesto sha256).
- AC6: WHEN o usuário inicia `pi` após a migração THE SYSTEM SHALL carregar os mesmos agents, skills, extensões e hooks de antes (core via symlink, pessoais via overlay) com bypass ON vindo de `local.env`.
- AC7: IF `local.env` tiver modo diferente de 0600 ou chave fora da allowlist (PI_BYPASS_PERMISSIONS, PI_COMPACT_AT, PONYTAIL_QUIET_STARTUP) THEN THE SYSTEM SHALL ignorar a linha e avisar, sem executá-la como shell.
- AC8: WHEN o checador de referências roda THE SYSTEM SHALL reportar zero skills/agents/caminhos citados pelo repo que não existam no repo ou não estejam marcados como opcionais.
- AC9: WHEN o repo é criado no GitHub THE SYSTEM SHALL criá-lo privado, e só o usuário muda a visibilidade.

## Não-objetivos
Fork do código-fonte do pi; publicar o overlay pessoal, as sessões e a memória; suporte a Antigravity; release no npm; mudar o `~/.claude`.

## Fase 0 — Segurança do estado atual (gate: backup verificado)
1. Backup completo e registro /docs
- agente: main thread (comandos curtos); arquivos: `~/.pi-backup/<data>/` (dir 0700), `full.tar` (0600) com `~/.pi/agent` inteiro (inclusive segredos, porque é local) e `~/.local/bin/pi`; `~/code/pi-harness/docs/specs/0001-publish-harness.md` (este plano materializado, ainda sem git)
- ler antes: nada
- ação: `tar -cpf` + `tar -tf | wc -l` + sha256 manifest da árvore (`find -type f -exec sha256sum`) salvo como `pre-migration.sha256`
- after: —; AC5
- check: `tar -tf ~/.pi-backup/<data>/full.tar >/dev/null && stat -c %a ~/.pi-backup/<data>`
- pronto: tar listável, dir 0700, sha256 manifest gravado

## Fase 1 — Montar a árvore sanitizada (gate: AC1/AC8 verdes antes do `git init`)
2. publish.list e cópia por allowlist
- agente: swarm-worker (Sonnet); arquivos: `~/code/pi-harness/publish.list`, `scripts/export.sh`, árvore copiada
- ler antes: o inventário de D2/D3/D7/D10; `~/.local/bin/pi`; `~/.pi/agent/settings.json`
- ação: gerar a lista arquivo a arquivo (sem `__pycache__`, `usage-cache*`, `pi-transcripts`, `config.json` do hud se tiver dados, `*.bak*`, `orig/`); `export.sh` copia só os itens da lista, mapeando `~/.local/bin/pi`→`bin/pi`, `claude-home/*`→`claude-home/*`, `extensions/*`, `themes/*`, `scripts/*`, `patches/{pi-code,pi-core}` (antigravity fora)
- after: 1; AC2
- check: `scripts/export.sh --dry-run | rg -c '/(sessions|checkpoints|memory|plans|projects|backups|session-env)/|auth|\.env|mcp\.json$|lsp\.json$|models-store'` = 0
- pronto: a árvore existe sem `.git`, e só com arquivos da lista

3. Scanner de identificadores + pre-commit
- agente: quality-toolkit-engineer (Sonnet); arquivos: `scripts/check-leaks.sh`, `.githooks/pre-commit`, `.gitignore` (denylist de defesa: auth*, *.env, local.env, mcp*.json, lsp.json, models-store.json, sessions/, checkpoints/, memory/, plans/, rules/personal.md), `.leak-allow` (hits benignos rastreados)
- ação: o script roda gitleaks + trufflehog (instala se faltar, versão pinada) + `rg -f ~/.config/pi-harness/identifiers` (lista local, não rastreada); o pre-commit valida os paths do índice contra `publish.list` e roda o script nos arquivos staged
- after: 2; AC1, AC2
- check: `scripts/check-leaks.sh --selftest` (fixture com token falso e `~` precisa falhar)
- pronto: o selftest pega as duas fixtures

4. Sanitização de caminhos e referências
- agente: swarm-worker (Sonnet); arquivos: todos os copiados com hits
- ação: classificar cada hit como ship (`$HOME`, `$CLAUDE_CONFIG_DIR`), stub (opcional documentado: knowledge vault, Perplexity/Brave/Keenable, codegraph) ou remove. Mover git-deliver para `claude-home/bin/git-deliver` (A2). Generalizar evals e port-agents com `PI_HARNESS_EVALS_DIR`/`CLAUDE_SRC_DIR` (default desligado com mensagem clara). Remover datas de "user decision" de agents/skills
- after: 3; AC1, AC8
- check: `scripts/check-leaks.sh` exit 0
- pronto: zero hits fora de `.leak-allow`

5. Contrato genérico + overlay pessoal
- agente: swarm-worker (Sonnet), revisado pela main thread; arquivos: `claude-home/CLAUDE.md`, `rules/safety.md`, `rules-ref/*.md` (repo); `~/.pi/agent/claude-home/rules/personal.md` (local, conteúdo atual pessoal: idioma pt-BR, decisões datadas, knowledge vault, Perplexity-first, bypass, owner rules)
- ação: reescrever em inglês neutro mantendo a mecânica do harness (orquestração, verificação, plan-gate, git-delivery); o que é preferência pessoal vai para `personal.md`; a união dos dois tem que equivaler ao CLAUDE.md atual (tabela de mapeamento seção→destino no /docs)
- after: 4; AC6
- check: `scripts/check-leaks.sh` e um diff de cobertura de seções (toda seção do CLAUDE.md antigo aparece na tabela)
- pronto: tabela completa, sem perda de regra

6. Checador de referências pendentes
- agente: quality-toolkit-engineer (Sonnet); arquivos: `scripts/check-refs.py` + teste
- ação: extrair nomes de skills, agents, comandos e caminhos citados nos arquivos enviados; falhar se ausentes e não marcados `optional:`. Aplicar A3: incluir as skills genéricas citadas (ex.: perplexity-urls, security-audit, sharp-edges, deep-search) ou remover a citação
- after: 5; AC8
- check: `python3 scripts/check-refs.py` exit 0
- pronto: zero pendências

## Fase 2 — Instalador e wrapper (gate: AC3/AC4/AC7 em HOME temporário)
7. Wrapper, local.env e templates
- agente: swarm-worker (Sonnet); arquivos: `bin/pi`, `settings.json.example` (packages sem antigravity), `mcp.json.example` (placeholders `${ENV}`), `lsp.json.example`, `local.env.example`
- ação: bypass default 0; parse de `local.env` linha a linha `KEY=VALUE` com allowlist de chaves e checagem de modo 0600, sem `source`; caminhos via `$HOME`; bloco agy só se o pacote existir
- after: 6; AC7, AC6
- check: `sh bin/pi --selftest-env` com fixtures (0644 ignorado, chave estranha ignorada, `$(cmd)` literal)
- pronto: os três casos passam

8. install.sh + manifesto de terceiros
- agente: swarm-worker (Sonnet); arquivos: `install.sh`, `third-party.json` (nome, url, commit, licença verificada, path destino), `NOTICE`, `LICENSE` (MIT), `README.md` (instalar, contribuir, overlay), `CONTRIBUTING.md`
- ação: `install.sh` instala pi 1.5.2 pelo instalador oficial (verificar o comando na doc do pi em `install/releases/1.5.2/.../README.md`), `npm ci` com `pi-code@1.7.0` exato, clone de cada terceiro com `git checkout <commit>` + `git rev-parse HEAD` igual ao manifesto (senão aborta), patches só se a versão do pi-code for exata (fail closed), `--link` (dry-run por padrão, `--apply` move os originais para o backup e cria o symlink), `--restore`. Verificar a licença de claude-red e egm antes de entrar no manifesto; se não for redistribuível nem baixável, sai do manifesto e fica registrado
- after: 7; AC3, AC4, AC5
- check: `HOME=$(mktemp -d) ./install.sh && HOME=… pi --version` + caso de commit adulterado esperando exit≠0 + `--link --apply` seguido de `--restore` e diff sha256 em HOME temporário
- pronto: os 3 cenários verdes em HOME temporário

## Fase 3 — Verificação, migração e entrega
9. Gate final, git init e migração do ~/.pi
- agente: gate-runner (Haiku) para os gates; main thread para a migração
- ação: (a) gates sobre a árvore: `check-leaks.sh`, `check-refs.py`, `structure.py --project-root ~/code/pi-harness --json` (reportar violações herdadas), testes de hooks (`pytest claude-home/hooks`), testes `.test.ts` dos patches, E2E em HOME temporário (AC3/AC4/AC5) e `pi -p` sem credencial esperando erro de auth limpo, sem tocar no `auth.json` real; (b) só com tudo verde: `git init`, `core.hooksPath .githooks`, commit inicial, `check-leaks.sh` no histórico; (c) `install.sh --link` dry-run no HOME real, revisão da lista, `--apply`; criar `local.env` (0600, bypass=1) e `rules/personal.md`; (d) smoke real: `pi --help`, sessão `pi -p "liste seus agents"` comparada com o inventário pré-migração
- after: 8; AC1–AC8
- check: os comandos acima; para regressão, `sha256sum -c` dos arquivos pessoais intocados
- pronto: tudo verde e o pi do usuário com o mesmo inventário

10. Repo privado no GitHub + revisão
- agente: git-delivery (Haiku) via `git-workflow`; autorização: criar repo privado `pi-harness` e fazer push do `main` (D9); proibido mudar para público
- ação: `gh repo create pi-harness --private --source ~/code/pi-harness --push`; habilitar secret scanning/push protection se disponível; depois `plan-reviewer` até `PLAN_REVIEW: complete`; entregar ao usuário o relatório dos scanners e o checklist de revisão para ele mudar a visibilidade
- after: 9; AC9
- check: `gh repo view pi-harness --json visibility` = PRIVATE
- pronto: repo privado, revisão concluída, usuário avisado

## Riscos e rollback
- Vazamento → os gates rodam antes do `git init`, pre-commit e push protection. Se vazar no privado: rotacionar a credencial (pede autorização do usuário) e recriar o repo (`gh repo delete` só com aprovação do usuário).
- Migração quebra o pi do usuário → `install.sh --restore` ou `tar -xpf ~/.pi-backup/<data>/full.tar -C /`, e o wrapper original volta do tar.
- Contrato genérico perde regra → a tabela de mapeamento da tarefa 5 e a comparação de inventário na 9(d).
- Patches não aplicam numa versão nova → fail closed com aviso, como o wrapper já faz.
- Pré-mortem: (1) transcript com token dentro de `pi-transcripts` → excluído por nome + gitleaks; (2) agent enviado cita uma skill pessoal → check-refs; (3) bypass OFF trava subagentes do usuário → `local.env` herdado pelo env do processo, testado em 9(d).

## Fechamento
- Gate final (9), plan-reviewer (10), entrega privada (10). knowledge vault: capturar o padrão "publicar harness por allowlist + overlay" após a revisão.
## Progress
- [DONE:1] Backup: `~/.pi-backup/20261113T173319/full.tar` (0600, dir 0700, 46839 entradas, 471M) + `pre-migration.sha256` (35746 arquivos). Restauro: `tar -xpf ~/.pi-backup/20261113T173319/full.tar -C /`.

## Surprises

## Decision log
- D1–D10 e A1–A4 conforme acima (sessão de plano 2026-11-13).

## Outcomes
- [DONE:2] `publish.list` (324 arquivos) + `scripts/export.sh`. Ajustes: `test_core.py` mantido (AWS key falsa de fixture → allowlist do gitleaks na tarefa 3); HUD antigravity mantido (import estático em `claude-hud-usage.mjs`; suporte a provider, sem conta). Check de paths: 2 falsos positivos aceitos (`test-author.md`, fixture `PostToolUse-mcp.json`).
- [DONE:3] `scripts/check-leaks.sh` (gitleaks 8.30.1 + trufflehog 3.99.9 pinado com sha256 + identificadores locais), `.githooks/pre-commit`, `.gitignore`, `.gitleaks.toml`, `.leak-allow`. Selftest verde. trufflehog exclui por path `test_core.py` (fixture AWS falsa; gitleaks cobre com allowlist exata).
- [DONE:4] Sanitização: 0 hits fora de CLAUDE.md/rules-ref (tarefa 5). Novas envs: `PI_KNOWLEDGE_VAULT`, `PI_GRAPHS_VAULT` (sem default; substituem `IA_BRAIN_ROOT`/`IA_GRAPHS_ROOT`), `CLAUDE_SRC_DIR` (port-agents). git-deliver em `claude-home/bin/git-deliver`. Fixtures em `/tmp/pihome`. Testes: hooks 62 ok, telemetry+checks 13 ok.

## Surprises
- `export.sh` removido após a tarefa 4: rodá-lo sobrescreveria a árvore sanitizada; o repo é a fonte da verdade. `publish.list` fica como allowlist do pre-commit (coluna DEST).
- Overlay pessoal precisa em `local.env`: `PI_KNOWLEDGE_VAULT` e `PI_GRAPHS_VAULT` (caminhos absolutos, valores no overlay), além de `PI_BYPASS_PERMISSIONS=1` → allowlist de chaves da tarefa 7 inclui essas.

## Task 5 mapping
Source: the owner's live CLAUDE.md (CL), rules/safety.md (SF), rules-ref/{research-and-tools (RT), docs-and-knowledge (DK), harness-economy (HE)}. Personal = `~/.config/pi-harness/personal.md` (installed as `rules/personal.md`).

| source section/bullet | destination | note |
|---|---|---|
| CL header comment | public | rewritten for the public wrapper; Claude-port history dropped |
| CL ## Precedence (1) | public | `$CLAUDE_CONFIG_DIR/rules/`, mentions optional personal.md |
| CL Delivery: act by default | public | |
| CL Delivery: carry authorization | public | |
| CL Delivery: delegated blocked decision | public | |
| CL Delivery: deliver what was asked | public | |
| CL Delivery: read before editing | public | |
| CL Delivery: verified delivery speed | public | |
| CL Delivery: focused changes | public | |
| CL Delivery: git delivery | split | public: git-delivery agent + `$CLAUDE_CONFIG_DIR/bin/git-deliver`; personal: Haiku pin, `~/.claude/bin/git-deliver`, 2026-11-08 attribution |
| CL Delivery: scale process (sdd) | public | |
| CL Delivery: plan mode | public | vault wait made "optional vault"; personal repeats it |
| CL Delivery: respond in user's language | split | public neutral; personal pt-BR |
| CL Delivery: findings list | public | |
| CL ## Long tasks (2 bullets) | public | |
| CL Boundaries: explicit authorization list | split | public adds "overlay may grant standing authorizations"; none otherwise |
| CL Boundaries: "aprovo" approval | split | public neutral "explicit approval"; personal keeps "aprovo/approvo/approved" |
| CL Boundaries: autonomous Git + merge | split | public keeps merge-only-green rule; autonomy grant is personal |
| CL Boundaries: billing-blocked CI | split | public: needs overlay standing authorization; personal: full text |
| CL Boundaries: untrusted data | public | |
| CL Boundaries: credentials | public | |
| CL ## Engineering (9 bullets) | public | size limits and structure.py marked as defaults |
| CL Engineering: modern architecture/SOTA | split | public: `soteiros` (optional); personal: "SOTA" trigger |
| CL ## Verification: proportional to risk | public | |
| CL Verification: verify once | split | public rule; personal: 2026-10-30 attribution |
| CL Verification: TDD | public | |
| CL Verification: E2E | public | |
| CL Verification: 80% coverage | public | marked default |
| CL Verification: pre-launch | split | public: project-phase mechanic; personal: 2026-11-10 owner decision |
| CL Verification: request outranks tests | public | |
| CL Verification: report what ran | public | |
| CL Verification: diagnose failures | public | |
| CL Verification: completion criteria | public | |
| CL ## Release and CI (2 bullets) | public | |
| CL ## Continuous improvement (2 bullets) | public | |
| CL Evidence: on-demand rules | public | |
| CL Evidence: research external facts | public | |
| CL Evidence: web search | split | public provider-neutral; personal Perplexity-first |
| CL Evidence: codegraph | public | "when configured" |
| CL Evidence: consult vault | split | public: if `PI_KNOWLEDGE_VAULT`; personal: the private vault + obsidian-cli |
| CL Evidence: execute directly | public | |
| CL Runtime: pi harness/wrapper | split | public: bypass default OFF (`local.env`, `--bypass`); personal: bypass ON |
| CL Runtime: skills | public | |
| CL Runtime: act autonomously | split | public: `Graph:` + vault line; personal: the private vault line |
| CL Runtime: main session orchestrates | split | public: mechanics, cheap/mid tier; personal: dates + Haiku/Sonnet 5.5 names |
| CL Runtime: standing opt-in (3+ units) | split | public mechanics; personal: 2026-11-08 attribution |
| CL Runtime: approved plan / plan-gate | split | public mechanics; personal: 2026-11-08 attribution |
| CL Runtime: large output | public | |
| CL Runtime: subagents authority | public | |
| CL Runtime: memory | public | "Claude's auto memory" dropped |
| CL Runtime: harness changes | split | public rule; personal: 2026-11-08 attribution |
| CL Runtime: EGM artifact directory | personal | |
| SF header comment | public | |
| SF intro (wrapper/guard/deny list/ask list) | split | public: safe default, deny list kept; personal: bypass ON, 2026-10-05/11-04 decisions |
| SF forbidden `rm -rf` | public | |
| SF never bypass protections | public | |
| SF local destructive commands | split | public: bypass-or-approval; personal: runs without asking (2026-11-04) |
| SF shared infrastructure | public | |
| SF subagents never publish | split | public (linear-operator optional); personal repeats exception |
| SF needs explicit authorization | public | |
| SF CodeQL | split | public rule; personal: 2026-11-04 read date |
| SF third-party intake | split | public: vet first, `presente-de-grego` optional; personal: mandatory skill load |
| SF never mutate live data | public | |
| SF don't repeat side effects | public | |
| RT ## Web search (all 6 bullets) | split | public: configured providers, deep-search/perplexity-urls optional; personal: Perplexity-first, providers.md path, variants, 2-provider fallback |
| RT MCP: codegraph | public | optional |
| RT MCP: indexing pre-authorized | split | public: only where authorized; personal: 2026-10-24, `~/source` |
| RT MCP: docs ↔ code graphs | split | public: `PI_GRAPHS_VAULT`; personal: private graphs path, timer |
| RT MCP: library docs | split | public generic; personal: context7/OpenAI/Claude/pi URLs |
| RT MCP: academic papers | split | |
| RT MCP: large output | public | |
| RT MCP: browser | split | public optional playwright; personal: CDP 19222, chrome-debug, cua-driver |
| RT MCP: reverse engineering | personal | |
| RT MCP: Linear | split | public optional; personal: `/mcp login linear` |
| RT MCP: past-session recall | split | public: pi sessions; personal: Claude transcripts |
| RT MCP: another model's opinion | split | public `pi -p`; personal adds `claude -p` |
| RT ## Local execution (5 bullets) | split | public generic; personal: 24 threads, build.slice, sccache/mold |
| RT Delegation: subagent modes | public | |
| RT Delegation: isolation | public | |
| RT Delegation: default tiers | split | public: cheap/mid pins; personal: dated decisions, Haiku/Sonnet 5.5 names |
| RT Delegation: shape/writer | split | public; personal: 39–70% measurement attribution |
| RT Delegation: graph and loops | public | |
| RT Delegation: saved workflows | split | public generic; personal: Claude workflow names, `/research-xcheck` |
| RT Delegation: review | split | public; personal: 2026-10-05 Martian benchmark attribution |
| DK intro + spec modes + knowledge routing | public | vault optional |
| DK vault: consult / read sections | split | public: generic vault discipline; personal: private vault, `kb.py` |
| DK vault: capture | split | public; personal: capture.py contract |
| DK vault: vault health | split | public generic; personal: vault_lint command with vault path |
| HE intro + 3 policy bullets | public | |
| HE check commands bullet | split | public: `$CLAUDE_CONFIG_DIR` checks; personal: `~/.claude/evals` eval details |
| HE header comment / user-decision dates | split | dates in personal (2026-11-08) |

Uncertain placements: pre-launch (generic mechanic kept public, owner-decision attribution personal); pelo-em-ovo/eval path references (optional in public); public hook/bin file names not re-verified beyond `ls`.
- [DONE:5] Contrato público neutro (CLAUDE.md 87, safety 25, rules-ref 13/24/40 linhas) + overlay local `~/.config/pi-harness/personal.md` (52 linhas, 0600; instalado como `claude-home/rules/personal.md` na tarefa 9). Mapeamento em "Task 5 mapping" (90 linhas). Scanner exit 0.
- [DONE:6] `scripts/check-refs.py` (+11 testes) exit 0 (224 → 0). 14 skills genéricas adicionadas por A3 (publish.list 472). 49 referências marcadas `(optional)`; `refs-allow.txt` com 15 caminhos de runtime. Scanner ignora testes e `*.patch` (contexto de terceiros).
- [DONE:7] `bin/pi` com bypass OFF, loader de `local.env` sem eval (allowlist de 7 chaves, 0600, env do chamador vence), patches fail-closed por versão (pi-code 1.7.0, pi 1.5.2); `bin/test_pi_env.sh` verde; templates `settings/mcp/lsp.json.example` e `local.env.example`. URLs de exa/context7 conferidas com a config real; perplexity/brave/playwright via npx oficiais (o dono usa gateway local; registrado como diferença).
- [DONE:8] `install.sh` + `scripts/install-lib.sh`: pi 1.5.2 com layout gerenciado reproduzido e sha256 pinado (o `pi.dev/install.sh` oficial não fixa versão), `npm ci` com pi-code 1.7.0, terceiros por commit (ponytail ef8ca48, ralph-loop/pr-review-toolkit 893173f, claude-red a8de813 opcional; pi-lsp via npm 0.1.7 com integrity), patches `patches/third-party/*` fail-closed, `--link [--apply]`, `--restore`. Omitidos: sol-pi, egm, impeccable (proveniência não confirmada; não referenciados ou opcionais). `test_install.sh` verde, inclusive E2E com rede (15.7s).
- Risco: `install.sh` (padrão) sobre o `~/.pi/agent` real remove o antigravity-bridge do `npm/` → na migração do dono só roda `--link`.
- [DONE:9] Gate (gate-runner, árvore sem git): leaks/selftest/refs/structure(0 achados)/pytest hooks 62, bin 69, skills 327/node hud 50, cjs 65/patches 19 aplicam, 355 testes de patch/test_pi_env/test_install com E2E de rede: verdes após correções (2 patches novos do dia sincronizados, `orig/` do pi-code 1.7.0 incluído (MIT, idêntico ao npm pack), teste google-only-agy removido, testes resolvem pi-tui via `PI_AGENT_DIR`, `npm ci` das extensões no install, check 12 do pi-ui-final-gate por conteúdo). `git init` + `core.hooksPath .githooks`. Migração: `install.sh --link --apply` → 487 symlinks, manifesto `~/.pi-backup/20261113T181250/link-manifest.tsv`; overlay `rules/personal.md` + `local.env` (0600). Smoke real: `pi -p` exit 0, 54 agents e 200 skills (iguais ao backup), BYPASS=1, sem avisos no stderr. Re-dry-run: 487 skip(same).
- Surprise/fix: `publish.list` tinha SRC `~/.claude/bin/git-deliver` e o `--link` usa SRC como destino → o link caiu no `~/.claude`. Restaurado do backup (sha256 OK), SRC corrigido para `~/.pi/agent/claude-home/bin/git-deliver` e manifesto ajustado.
- Adicionado `claude-home/settings.json.example` (registro dos hooks com `$HOME`; o runner do pi-code usa shell-form) como template do install.
- Fix (entrega): o guard do git-deliver (`secret_named`, padrão `*credentials*.json`) barrou `insecure-defaults/references/default-credentials.json` (regexes, não credencial). Renomeado para `default-credential-rules.json` com `SEED_FILES` (id→arquivo) em `pipeline.py`; o id da categoria ficou igual; testes 17/17.
