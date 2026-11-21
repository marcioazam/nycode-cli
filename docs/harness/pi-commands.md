# Commands do Claude Code portados para o pi (2026-11-11)

O wrapper `~/.local/bin/pi` exporta `CLAUDE_CONFIG_DIR=~/.pi/agent/claude-home`, e o pi-code (`extensions/commands.ts`)
registra cada `claude-home/commands/*.md` como `/nome`, com `$ARGUMENTS`, `$N` (índice a partir de 0), `${N:-padrão}`,
`${ARGUMENTS:-padrão}`, `${CLAUDE_SESSION_ID}`, spans `` !`cmd` `` e blocos ```` ```! ````, `allowed-tools` (vira
restrição do turno inteiro, com escopo `Bash(...)`), `model:`, `effort:` e `disable-model-invocation`. Não ponha
arquivos `.md` que não sejam commands nessa pasta (viram `/nome`). Um `$` seguido de dígito no texto vira placeholder:
escreva `\$` (ex.: `US\$3`, `awk '{print \$0}'`). `$ARGUMENTS` entra cru no shell de um span: nunca o cole num comando
(use heredoc com delimitador entre aspas, como o `/ralph-loop`).

## Inventário e decisão, um por um

Fontes lidas: `~/.claude/commands/*.md` (4) e os `commands/` de todos os plugins em `~/.claude/plugins/cache`
(ligados e desligados), na versão mais recente de cada um. Plugins ligados cujos commands são skills (ponytail,
context-mode) também entram.

### Commands do usuário

| Original | No pi | Adaptação | Evidência |
|---|---|---|---|
| `claude-tier.md` | `/claude-tier` | sem `run_in_background` (o bash do pi não tem): uma execução em primeiro plano com `timeout: 3600`; `allowed-tools` `Bash(claude-tier-probe:*), Read`; `US\$3,6` escapado (no original `$3` virava placeholder com 4+ pastas) | `claude-tier-probe --selftest` = ok; expansão com 0, 1 e 4 argumentos |
| `pre-launch.md` | `/pre-launch` | instruções de agente do pi (`AGENTS.md`/`CLAUDE.md` por diretório, `.pi/`, `.agents/skills`); gate medido pelo histórico do CI (`gh run list --json`); verificação no `gate-runner`, entrega no `git-delivery` | fontes respondem 200; DORA confirma o teto de ~10 min |
| `puxar.md` | `/puxar` (extensão `~/.pi/agent/extensions/puxar.ts`) | o pi não lê o JSONL do Claude: `claude-home/bin/puxar/puxar.py` converte o ramo ativo (mensagens, thinking, tool calls mapeadas, compactações, título) para a sessão v3 do pi, e a extensão abre a sessão sem gastar tokens | 15 testes (`bin/tests/test_puxar.py`), 4 mutantes mortos; 6 sessões reais de 4 perfis importadas, 2 continuadas na API; `/puxar 3` no TUI |
| `swarm.md` | `/swarm` | lanes por `subagent` paralelo (até 4 writers), tier pelo `model:` do agente, restrições verbatim em cada brief, entrega só pelo `git-delivery` | `--mode json "/swarm ..."` devolveu o resultado completo |

### Plugins ligados no Claude

| Original | No pi | Adaptação | Evidência |
|---|---|---|---|
| differential-review `/diff-review` | `/diff-review` | sem `allowed-tools` (cortaria o `subagent` do `adversarial-modeler`); lê a skill `differential-review` | `pi -p "/diff-review"` responde o uso, EXIT=0 |
| insecure-defaults 2.0.3 `/audit` | `/insecure-defaults-audit` + skill `insecure-defaults` | a ferramenta `Workflow` não existe no pi: a parte determinística do `workflows/audit.js` virou `scripts/pipeline.py`; recon e varreduras em `swarm-worker`, verificação em `security-reviewer`; corrigido o `"$1" or "."` do original. `files_scanned` agora conta arquivos **percorridos**, não os que casaram: uma varredura limpa não aparece mais como "não buscada" | 17 testes, 5 mutantes mortos; execução real: 6/6 categorias buscadas (`unsearched_categories: []`), 5 achados, 6 refutados |
| claude-hud 0.10.0 `/setup`, `/configure` | `/claude-hud-setup`, `/claude-hud-configure` | launcher `bin/hud/claude-hud-statusline.mjs` acha o claude-hud nos caches de `~/.claude*` e traduz a sessão do pi para o transcript do Claude (`bin/hud/claude-hud-pi-transcript.mjs`, incremental): as linhas de tools, agents (`subagent` único, paralelo e em background), todos (`todo` → TodoWrite), skills (leitura de `SKILL.md`) e MCP funcionam | 8 testes (`node --test bin/hud/tests/*.test.mjs`), inclusive ponta a ponta pelo HUD e fechamento de agentes em background; sessão real: ~50 ms por atualização. HUD **ligado** (pedido do usuário 2026-11-11), layout `expanded`; 2+ linhas aparecem acima do rodapé via `patches/pi-code/statusline-multiline.patch` (`pi-plugins-port.md`) |
| ponytail 4.10.3 (commands = skills) | `/ponytail [off\|lite\|full\|ultra\|status\|default <modo>]`, `/ponytail-review`, `-audit`, `-debt`, `-gain`, `-help` | a extensão oficial do pi do pacote, copiada só com o que o pi usa para `~/.pi/agent/vendor/ponytail` e registrada em `settings.json` `packages` (como o `vendor/pi-lsp`); usa o `~/.config/ponytail/config.json` (padrão `full`, igual ao Claude); duas correções locais: os aliases repassam os argumentos (o upstream os descartava) e, sem UI, esperam a execução assentar (senão o `pi -p` quebrava) | vetado: só `fs`/`path`/`os`, sem rede nem processos; 26 testes (24 do upstream + 2), mutante da correção morto; `pi -p "/ponytail-review svc.py"` revisou o arquivo; TUI: status, troca de modo, autocomplete |
| context-mode 2.0.2 (`ctx-stats`, `ctx-doctor`, `ctx-upgrade`) | não portado | os três só relatam sobre o próprio context-mode (MCP, hooks, banco FTS5), que o harness do pi não usa por decisão anterior (`docs/pi-instructions.md`, `docs/pi-skill-adaptation.md`: filtros no `bash` e skill `context-economy`). Equivalente no pi: rodapé (tokens e custo) e `/session` | — |

### Plugins desligados no Claude (lidos um a um e portados)

| Original | No pi | Adaptação | Evidência |
|---|---|---|---|
| ralph-loop 1.0.1 `/ralph-loop`, `/cancel-ralph`, `/help` | `/ralph-loop`, `/cancel-ralph`, `/ralph-help` | scripts em `claude-home/vendor/ralph-loop` (Apache-2.0); Stop hook registrado em `claude-home/settings.json` (o pi-code roda Stop hooks com a semântica do Claude, e o transcript do pi tem o formato que o hook lê); sessão via `${CLAUDE_SESSION_ID}`; argumentos por heredoc + `shlex` (`scripts/pi-ralph-start.sh`): no original, `<promise>X</promise>` no prompt virava redirecionamento e `$(...)` executava; `allowed-tools` saiu (travaria o turno do loop) | loop real: 3 iterações, parou na promessa e apagou o estado; limite de iterações para; `/cancel-ralph` apaga o estado e o hook não reabre; injeção `$(touch PWNED)` não executa; hook sem estado ou de outra sessão não bloqueia |
| commit-commands `/commit` | `/commit` | commit pelo `git-delivery` (`git-deliver commit`: paths explícitos, varredura de segredos); na base cria branch nova em vez de commitar; arquivos que parecem segredo ficam de fora | repositório temporário: commit convencional em branch nova, `.env` fora |
| commit-commands `/commit-push-pr` | `/commit-push-pr` | `git-deliver commit` + `publish` (push e PR com corpo do `pr-body.md`), sem merge; para ir até o merge, `/skill:atualizador` | commit testado via `/commit`; push e PR dependem de remoto GitHub e não foram feitos de verdade (a suíte do `git_deliver`, 1 linha abaixo, cobre `publish`) |
| commit-commands `/clean_gone` | `/clean_gone` | o original fazia `branch -D` e `worktree remove --force` em toda `[gone]`, que inclui PR fechado sem merge e commits não enviados; aqui `git-deliver sync` (fetch --prune) e `git-deliver cleanup --pr N` só para PR mergeado cujo head é o head local; o resto é listado | `[gone]` sem PR provado: mantida, com motivo; o caminho de remoção é o `git-deliver cleanup`, coberto pela suíte do `git_deliver` |
| code-review 1.0.1 `/code-review` | `/code-review <PR> [--comment]` | haiku → `Explore`, sonnet/opus → `code-reviewer` (o pi não tem modelo por chamada); regras de `AGENTS.md` e `CLAUDE.md`; triagem de estado/draft feita pela conversa principal, que encerra (o modelo seguia mesmo com o `Explore` dizendo "draft"); comentários antigos pela REST (o `gh pr view --comments` falha no GraphQL); com `--comment`, uma única review pela REST `pulls/N/reviews` (o MCP `github_inline_comment` não existe no pi; campos conferidos em docs.github.com/rest/pulls) | PR draft real: "PR 1 não revisado: draft", sem subagente; PR aberto real: ver "Teste ponta a ponta" |
| pr-review-toolkit `/review-pr` | `/review-pr [aspectos] [sequential]` | os 6 agentes do plugin viraram prompts de referência em `claude-home/vendor/pr-review-toolkit/agents` (não registrados); cada aspecto roda num agente do pi que segue o prompt (code e comments e types → `code-reviewer`, tests → `test-reviewer`, errors → `reliability-reviewer`, simplify → `swarm-worker`, só quando pedido); paralelo por padrão | diff com `except Exception: pass`: 4 aspectos em paralelo, a falha silenciosa e a docstring "YAML" de código JSON apontadas com `arquivo:linha` |
| claude-md-management `/revise-claude-md` | `/revise-claude-md` | `AGENTS.md` e `CLAUDE.md` (o pi lê os dois); aprovação com `question`; corrigido o nome `.claude.local.md` (o Claude lê `CLAUDE.local.md`, code.claude.com/docs/en/memory); avisa que no pi `CLAUDE.local.md` e `.claude/CLAUDE.md` só carregam em projeto aprovado (o wrapper roda `--no-approve`) | expansão conferida |
| firecrawl 1.0.9 `/skill-gen` | `/skill-gen <url>` | CLI `firecrawl` → MCP `mcp__firecrawl__*` (map e crawl exigem conta: sem chave, cai para `scrape`/`web_fetch`); locais de skill do pi (`.pi/skills`, `.agents/skills`, `claude-home/skills`); regras de nome e descrição dos docs do pi; skill global passa pelo `check-instructions.py` | expansão conferida |

### Não portados, com motivo

| Original | Motivo | No pi |
|---|---|---|
| caveman `caveman-init.md` (os demais são `.toml` do Gemini) | plugin desligado; o command roda `curl ... \| node -` de um branch `main` sem versão fixa (código remoto não verificado) e grava regras do caveman no repositório | o modo caveman foi tirado do contrato do pi de propósito (`docs/pi-instructions.md`) |
| remember 0.43.1 `/doctor` | só diagnostica o plugin remember (hooks, pipeline Haiku), desligado no Claude e sem porte para o pi | memória do pi: ferramenta `memory` |
| ponytail e caveman `*.toml`, `review.toml` | commands do Gemini CLI, não do Claude | — |

## Custo x benefício (2026-11-11)

Medido no que entra no contexto a cada turno, em toda sessão e em todo subagente:

| Item | Custo por turno | Decisão |
|---|---|---|
| Commands invocáveis pelo modelo (lista do `slash_command`) | ~300 tokens com 8 commands | todos os 17 têm `disable-model-invocation: true`: o usuário digita, o modelo usa as skills equivalentes (`git-workflow`, `atualizador`, `pr-review`, `differential-review`). Também tira do modelo a chance de fazer commit, push ou comentar num PR sozinho. Custo agora: 0 |
| Descrições das 6 skills do ponytail | ~580 tokens | `disable-model-invocation: true` na cópia vendorizada: os aliases (`/ponytail-review`...) e `/skill:ponytail-*` continuam funcionando; perde-se só o acionamento por frase ("find bloat"). Custo agora: 0 (optional) |
| Regras do modo ponytail (`full`) | ~1870 tokens de entrada, quase todos lidos do cache | **mantidas: economia líquida medida** (abaixo) |
| Stop hook do Ralph | um `test -f` por parada, ~ms | mantido |
| Tradutor do HUD | 0 (só roda com o HUD ligado) | mantido |
| Corpo dos commands | 0 até serem invocados | mantido |

**A/B do ponytail neste harness (2026-11-11, Sonnet 5.5, `~/.local/state/pelo-em-ovo/ponytail-ab/`):** o harness
inteiro nos dois braços, mudando só `PONYTAIL_DEFAULT_MODE` (`full` vs `off`); 14 tarefas do benchmark agentic do
ponytail 4.10.3 (7 de código com armadilha de segurança, 7 pedidos abertos), 3 repetições, pares intercalados, 84
execuções, US\$ 3,52. Ponytail/off, mediana entre tarefas (IC 95% por bootstrap): linhas −29% (0,57-0,86, menor em
14/14), tokens de saída −31% (0,63-0,75, 14/14), tempo −21% (13/14), custo −20% (0,65-0,89; −18% e 13/14 sem as 6
execuções que gravaram cache; soma −26%). Correção e segurança: 42/42 nos dois braços. O corte foi funcionalidade
especulativa (`vibe-rename`: 12 opções sem ponytail, 3 com). Limites: um modelo, tarefas pequenas de um arquivo,
segurança sem discriminar (os dois braços acertaram tudo). Reproduzir: `ab.py --tasks ... --reps 3` e `report.py`.

Ao criar um command novo: `disable-model-invocation: true`, salvo se o modelo precisar chamá-lo sozinho e não houver
skill equivalente.

## `pi -p` e `--mode json`

Antes, `pi -p "/command"` terminava sem rodar ("turn_end could not resolve the persisted assistant entry ID", "ctx is
stale"): o print mode descarta o runtime quando o handler do command volta, e o handler só disparava
`sendUserMessage`. Corrigido por `claude-home/patches/pi-code/commands-print.patch` (reaplicado pelo wrapper; original
em `patches/pi-code/orig/commands.ts`): sem UI, o handler espera a execução assentar (`agent_settled`), e um span que
falha vai para o stderr com saída 1 (antes o erro sumia e a saída era 0). A extensão do ponytail tem o mesmo conserto.
Outras extensões que mandam mensagem num command continuam sujeitas ao bug do pi.

## Teste ponta a ponta (2026-11-11)

- `/insecure-defaults-audit .` num fixture (fallback de `SECRET_KEY`, MD5 em senha e em chave de cache,
  `os.environ[...]`, segredo em `tests/`, Dockerfile sem `USER`): 6/6 categorias buscadas, confirmou o fallback e o MD5
  de senha, refutou o resto com o passo e o motivo.
- `/ralph-loop "... <promise>TRES</promise>" --completion-promise TRES --max-iterations 6` (`pi -p`, Haiku): 3
  iterações, `count.txt` com 3 linhas, estado apagado.
- `/commit`, `/clean_gone`, `/review-pr` num repositório temporário com remoto bare.
- `/code-review` em PRs reais do GitHub, sem `--comment`: `AI-Team#1` (draft) parou na triagem sem subagente;
  `mare-digital-website#41` (aberto, 41 arquivos) passou por triagem, `Explore`, resumo e 4 `code-reviewer` em
  paralelo, sem achados, com o worktree inalterado. O `--comment` não foi exercitado (publicaria num PR real); o
  formato do corpo da review segue a REST documentada.

## Manutenção

- Validar: `python3 ~/.pi/agent/claude-home/bin/checks/check-instructions.py` (inclui `commands/*.md`).
- Testes: `python3 ~/.pi/agent/claude-home/bin/puxar/test_puxar.py`,
  `python3 ~/.pi/agent/claude-home/skills/insecure-defaults/scripts/tests/test_pipeline.py`,
  `node --test ~/.pi/agent/claude-home/bin/hud/tests/claude-hud-pi-transcript.test.mjs`,
  `cd ~/.pi/agent/vendor/ponytail/pi-extension && node --test ./test/*.test.js`.
- Cópias vendorizadas (`vendor/ralph-loop`, `vendor/pr-review-toolkit`, `~/.pi/agent/vendor/ponytail`) não se
  atualizam sozinhas: ao atualizar o plugin no Claude, compare com `diff -r` e reaplique as correções locais (marcadas
  "Cópia local" / "Porte para o pi" nos arquivos).
- O `/puxar` e o tradutor do HUD dependem dos formatos de sessão do Claude e do pi; os testes de cada um são o ponto de
  partida se um deles mudar.
