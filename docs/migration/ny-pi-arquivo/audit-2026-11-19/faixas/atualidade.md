# Faixa atualidade (relatório bruto do subagente, 2026-11-19)

**Status: completo, com lacunas listadas ao fim.** Nada foi alterado no repositório nem instalado. Os testes dos patches rodaram só em cópias sob `/tmp/tmp.HoKL4Q6cAK`. Datas de acesso: 2026-11-19. O repositório não tem índice codegraph, então a cobertura estrutural é degradada e usei `rg`.

**Correção ao pedido:** o scanner de 2026-11-16 está velho. O pi-code estável mais recente é a **1.10.1** (2026-11-17), não a 1.9.0.

## Tabela

Fontes: npm = `https://registry.npmjs.org/<pacote>`, lido direto. PyPI e Actions vieram de `mcp__package_version_check`. Para as Actions, a linha da tabela traz a releases/latest do GitHub.

| item | atual no repo (arquivo:linha) | estável mais recente (data) | URL primária | lacuna relevante? | custo/risco | rollback |
|---|---|---|---|---|---|---|
| pi-code | 1.7.0 em `npm/package.json:5`, lock, `install-lib.sh:7`, `settings.json.example:4` | **1.10.1** (2026-11-17) | https://registry.npmjs.org/pi-code ; https://github.com/ilovepixelart/pi-code/releases | Sim: mudanças de comportamento em 1.8.0, correção do `/goal` em 1.10.0, novos recursos (ver (a)). Sem CVE novo. | Alto: 12 dos 74 arquivos patcheados quebram | manter o pin 1.7.0; `npm ci` do lock |
| pi core | `install-lib.sh:6` = 1.5.2 | 1.5.2 (2026-11-10), **atual** | https://registry.npmjs.org/@earendil-works/pi-coding-agent | Não | – | – |
| pi-lsp | `third-party.json` 0.1.7 (+ patch local) | 0.1.8 (2026-11-17) | https://registry.npmjs.org/pi-lsp | Talvez: commits upstream mexem em recuperação de cliente e shutdown de subprocesso, que é o foco do patch local. Não li o diff. | Médio: reconferir `pi-lsp.patch` | re-pin 0.1.7 + integrity |
| ponytail | `third-party.json` commit ef8ca48 (v4.10.3) + patch | **v5.3.3** (2026-10-29) | https://github.com/DietrichGebert/ponytail/releases | Salto de major (5.x traz "band" etc.). Notas completas e compatibilidade do patch não verificadas. | Alto | commit atual |
| ralph-loop / pr-review-toolkit | commit 893173f | `main` df9699a (2026-11-19); o repo não tem releases | https://github.com/anthropics/claude-plugins-official | Não avaliado | Baixo | commit atual |
| Claude-Red (opcional) | commit a8de813 | `main` 6196ba7 (2026-11-17) | https://github.com/SnailSploit/Claude-Red | Não relevante (opcional) | Baixo | commit atual |
| @agent-sh/computer-use-linux | 0.7.53 instalado globalmente, não pinado no repo | **0.7.56** (2026-11-17); o scanner dizia 0.7.54 | https://registry.npmjs.org/@agent-sh/computer-use-linux | Os docs de 11-12 notam que a 0.7.53 trocou o parser de teclado; changelog de 0.7.54–0.7.56 não lido | Baixo | npm i @0.7.53 |
| @bitbonsai/mcpvault | 0.18.3 instalado, não pinado | 0.18.4 (2026-11-14) | https://registry.npmjs.org/@bitbonsai/mcpvault | Não avaliado | Baixo | idem |
| Node mínimo | `install-lib.sh:8` 22.19.0 | LTS ativa: **v26.13.1 Lithium** (2026-11-10). A 22 (Jod) está em manutenção desde 2025-10-21, fim 2027-04-30. | https://raw.githubusercontent.com/nodejs/Release/main/schedule.json ; https://nodejs.org/dist/index.json | Parcial: 22.19 é o piso de engines do pi/pi-code, então o piso é legítimo. | Baixo | – |
| Node no CI | `ci-static.yml:54` `"24"` | 26.13.1 (LTS ativa desde 2026-10-28); a 24 (Krypton) entrou em manutenção em 2026-10-20 | idem | Sim, pela barra "LTS ativa mais nova". A 26 remove `--experimental-transform-types` e o Corepack. | Médio: validar o pi nela | voltar `"24"` |
| Python no CI | `ci-static.yml:50,96`, `ci-security.yml:48`, `requirements-ci.in:3` = 3.12 | 3.15.2 (2026-10-25); 3.14.10 também recebe correções | https://endoflife.date/api/python.json | Parcial: 3.12 fica sem suporte em 2028-10 e já saiu da fase de bugfix. Python não tem canal LTS. | Médio: regenerar `requirements-ci.txt` com hashes | voltar 3.12 |
| uv | só em comentário (`requirements-ci.in:2`) | 0.13.9 (2026-11-17) | https://api.github.com/repos/astral-sh/uv/releases/latest | Não exigido nem pinado no repo | – | – |
| `--experimental-strip-types` | nos docs `docs/designs/*` | desnecessário desde 22.18 (padrão); estável em 24.12 e 25.2 | https://nodejs.org/api/typescript.html | Cosmético. Passar a flag continua funcionando em 22/24; na 26 não verifiquei. | Trivial | – |
| harden-runner | `ci-*.yml` v2.22.4 (1d88384) | **v2.23.0** (aebdcf6, 2026-11-18) | https://github.com/step-security/harden-runner/releases/latest | Não avaliado | Baixo: trocar o SHA e conferir o changelog | SHA anterior |
| checkout / setup-python / setup-node | v7.0.1 / v7.1.0 / v7.1.0 | iguais (atuais) | https://github.com/actions/checkout/releases/latest | Não | – | – |
| ruff / mypy / zizmor / mutmut | 0.17.5 / 2.4.1 / 1.32.0 / 3.8.1 (`requirements-ci.in`) | iguais (atuais) | https://pypi.org/project/ruff/ (idem os demais) | Não | – | – |
| semgrep | 1.185.0 | 1.186.0 (2026-11-18) | https://pypi.org/project/semgrep/ | Não avaliado | Baixo | pin anterior |
| diff-cover | 11.0.1 | **11.0.4** (2026-11-19) | https://pypi.org/project/diff-cover/ | Não avaliado | Baixo | pin anterior |
| coverage / pytest | `7.*` / `9.*` (faixas) | 7.17.3 / 9.2.0 | https://pypi.org/project/coverage/ | Não: as faixas resolvem sozinhas | – | – |
| biome (binário no CI) | `install-tools.sh` 2.6.7 | 2.6.8 (2026-11-15) | https://github.com/biomejs/biome/releases | Não avaliado | Baixo: trocar versão e sha256 | – |
| actionlint, gitleaks, trufflehog, osv-scanner, shellcheck, shfmt, rg | `install-tools.sh` 1.7.12 / 8.30.1 / 3.99.9 / 2.7.1 / 0.11.0 / 3.14.1 / 15.2.0 | iguais (atuais) | https://api.github.com/repos/<owner>/<repo>/releases/latest | Não | – | – |
| Harbor (bench) | `bench/tasks/README.md:3` 0.25.0 | 0.26.0 (2026-11-13) | https://pypi.org/project/harbor/ | Changelog não lido; as tasks foram geradas com a 0.25.0 | Médio: pode mudar o formato das tasks | `uvx harbor==0.25.0` |
| Claude Code do braço `cc-vanilla` | `bench/arms.toml:11` 2.1.323 | não verificado | – | – | – | – |
| `mcp.json.example` | perplexity, brave e playwright via `npx -y` sem versão; playwright em `@latest` | perplexity 1.3.0, brave 2.1.5, playwright 0.0.86 (2026-11-18) | https://registry.npmjs.org/@playwright/mcp | Sim: é a única superfície sem pin nem hash, em contraste com todo o resto do repo | Baixo: pinar | – |
| npm audit do lock | `npm/package-lock.json` | 0 vulnerabilidades (low a critical) | `npm audit --package-lock-only` contra o registro npm | Não | – | – |

`lsp.json.example` e `settings.json.example` só referenciam binários e pacotes. As versões das ferramentas de LSP (typescript-language-server 6.0.3→6.1.0 etc.) estão só no scanner, com `harness:false`, e não foram verificadas por fonte primária.

## (a) pi-code 1.7.0 → 1.10.1 e o pi upstream

Fonte: release notes em https://github.com/ilovepixelart/pi-code/releases, lidas hoje.

**O que o salto traz:**
- **1.8.0** (5 mudanças de comportamento):
  - `CLAUDE_PROJECT_DIR` passa a ser o diretório de início da sessão, não a raiz do git. `claude-home/hooks/guard.py:465` usa essa variável como "project", então precisa de revisão.
  - `updatedToolOutput` só vale sob `hookSpecificOutput`. Nenhum hook local o usa (grep vazio).
  - Skills de plugin viram `/kit:deploy`; `/skill:x` fica deprecado e some no próximo major.
  - Bash que estoura o timeout vai para segundo plano (com UI) em vez de morrer. Isso pode interagir com a extensão `bash-timeout` local (teto de 1800 s).
  - Esc e Enter mudam no formulário de `question`.
- **1.8.0** também traz bash em segundo plano (`task_stop`, `/tasks`), a ferramenta `monitor`, `piCode.enabledPlugins` e `autoMemoryStorage:"claude"`.
- **1.9.0**: linha "Chat about this" no `question`; corrige o contexto do SessionStart `compact`.
- **1.10.0**: o `/goal` e os hooks `prompt` usavam no máximo 512 tokens de saída, o que cortava o veredito e deixava o goal ativo. Agora usam o limite do modelo. Também traz `/todos-widget off|compact|full`, e skills sincronizadas da conta não entram mais como pessoais.
- **1.10.1**: refatoração interna, sem mudança de comportamento.

**pi core 1.5.1/1.5.2**, já em uso, de https://github.com/earendil-works/pi/releases:
- `cacheWarming` com padrão `"idle"` (até 30 min, só se evitar ao menos US$ 0,05).
- Mensagens Anthropic em thread (envia só mensagens novas).
- Fork de sessão cuja pasta sumiu.
- O pi-code 1.6.2 corrige o undici do pi 1.1–1.4 (GHSA-xjj6-f33q-929c); o pi 1.5.2 já está além disso.

**Patches locais (observado):** copiei o pacote de cada versão para `/tmp`, apliquei `claude-home/patches/pi-code/*.patch` em ordem `LC_ALL=C` com `patch -N` e rodei `permission-control/apply.mjs`.

| versão | patches que falham |
|---|---|
| 1.7.0 (linha de base) | 4: `status-names`, `icon-gap`, `plan-sota-and-fleet`, `plan-state` |
| 1.9.0 | 9: os 4 acima, mais `subagent-panel` (`subagent/index.ts`), `onda5-hooks` (`hooks/index.ts`), `onda5-question`, `question-view`, `question-dialog` (todos em `question.ts`) |
| 1.10.1 | 12: os da 1.9.0 mais `goal.patch` (3 de 24 hunks), `onda5-goal` (`goal.ts`) e `todo-collapse` (`todo.ts`) |

- As 4 falhas da linha de base podem ser artefato da minha ordenação, porque `bin/pi` aplica na ordem do glob do locale; trate como não confirmado.
- Os arquivos que o upstream alterou e que os patches tocam são: `commands.ts`, `goal.ts`, `hooks/index.ts`, `hooks/runners.ts`, `internal/model-complete.ts`, `memory.ts`, `question.ts`, `skills.ts`, `status-line.ts`, `subagent/agents.ts`, `subagent/index.ts` e `todo.ts`. Só os acima falharam. Os demais aplicaram, mas o comportamento não foi validado.
- `permission-control/apply.mjs` recusa qualquer versão ≠ 1.7.0 (observado: "pi-code 1.10.1 != 1.7.0"). `bin/pi` tem a mesma trava, com padrão 1.7.0.
- **Hipóteses de patch ficar obsoleto** (não validadas):
  - `todo-collapse` frente ao `/todos-widget` upstream.
  - A correção local de limite de tokens do `/goal` (`internal/model-complete.ts` em `goal.patch`) frente à correção upstream da 1.10.0.
  - A extensão local `run/` frente a bash em segundo plano e `monitor`.
  - Os patches de `question` frente à reescrita do formulário (+955 a +1011 linhas de diff).

## (b) Decisões do harness frente à prática documentada

1. **Subagentes aninhados até profundidade 3.** É coerente com o Claude Code (padrão: até 3 camadas; a ferramenta Agent é retirada no limite). Fonte: https://code.claude.com/docs/en/sub-agents, seção "Let subagents spawn their own subagents", lida hoje. Não é divergência.
2. **MCP deferido.** O pi-code 1.6.0 já defere atrás de `tool_search`, como o Claude Code. Fontes: https://code.claude.com/docs/en/mcp e a doc da API (https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool), que recomenda manter 3–5 ferramentas frequentes sem diferir. `mcp.json.example` não marca `alwaysLoad` em nenhum servidor. Gap pequeno de latência, e a medição é do parent.
3. **Cache de prompt.** O Claude Code documenta que o prefixo precisa ser estável: mudar o system prompt, a lista de ferramentas, o modelo ou o esforço invalida o cache. Fonte: https://code.claude.com/docs/en/prompt-caching. Patches como `plan-cache-keep` mostram que o harness conhece o problema, mas sistema de prompt reescrito por patches (plan-mode, rules-notice) é risco **não medido**. A escolha de TTL de 1 h no pi para chave de API **não foi verificada**; o Claude Code oferece `promptCacheTtl`.
4. **Ferramentas de subagente como único limite.** O pi-code 1.7.0 carrega agentes com escopo (`Bash(git log:*)`) como ferramenta inteira, sem fluxo de permissão, e ignora `permissionMode` e `hooks` de agentes de plugin (https://github.com/ilovepixelart/pi-code/releases/tag/v1.7.0). O Claude Code roda cada chamada pelo fluxo de permissão. O papel "somente leitura" dos agentes depende de disciplina de prompt e da lista `tools:`. Dono: security-reviewer.
5. **Hooks só do tipo `command`** (`settings.json.example`, `PreToolUse` com `Bash|Edit|Write|Read` rodando `guard.py`). O Claude Code documenta cinco tipos (`command`, `http`, `mcp_tool`, `prompt`, `agent`) e o campo `if` para filtrar sem iniciar processo (https://code.claude.com/docs/en/hooks). Isso vem da síntese do Perplexity; só os cabeçalhos da página foram lidos, não o texto completo. O custo do guard já foi medido em `docs/perf-sota.md` (~60 ms + ~50 ms por ferramenta). Sem ganho medido a reivindicar.
6. **`CLAUDE_PROJECT_DIR` no guard** (`guard.py:465`): a semântica mudou na 1.8.0 (ver (a)). Antes de subir o pin, rodar `test_guard.py`.
7. **Patches aplicados em `node_modules` na inicialização** (`bin/pi:185-260`; 74 arquivos-alvo, 89 entradas em `patches/pi-code`). Cada bump quebra patches: 4 releases em 2 dias, 12 falhas. O gate por versão falha fechado (bom). A forma alternativa (extensão própria sobre a API do pi, ou fork) é preferência de projeto sem fonte primária; fica em notas, não em achado.
8. **Modelo e esforço por spawn, com pins concretos.** O Claude Code aceita `model` e `effort` no frontmatter e por chamada, com herança (sub-agents). Alinhado. Mas trocar esforço no meio da sessão invalida o cache (fonte de prompt-caching): vale medir o efeito na sessão do parent.
9. **Skills com `/skill:`.** O pi-code 1.8.0 deprecia a forma para skills de plugin. `claude-home/commands/*.md` usa `/skill:atualizador` e `/skill:<nome>` (por exemplo em `commit-push-pr.md:10`); só quebra se virarem skills de plugin. Verificar antes do próximo major.
10. **`npx -y …@latest` no `mcp.json.example`**: inconsistente com a política do próprio repo (`third-party.json`: tarball com sha512 e commit fixo).

## (c) O que não vale migrar agora

- **pi core:** já está no último estável (1.5.2); a linha `legacy-node20` não serve.
- **Node 26 como piso mínimo do instalador:** pi e pi-code exigem ≥22.19, então subir o piso só exclui usuários. Mudar o CI para 26 é a ação barata. Não subir o piso até o pi mudar `engines`.
- **Python 3.15 no CI:** ganho zero medido, e é uma linha nova (3.15.2 recém-lançada). Se subir, prefira 3.14.
- **pi-code 1.7.0→1.10.1 de uma vez:** custo alto e retorno incerto até os 12 patches serem refeitos. O ganho de segurança é nulo (nenhum CVE do pi-code; npm audit zerado). Recomendo adiar, depois triar quais patches o upstream já cobre (`/todos-widget`, limite de tokens do goal, monitor/bash em segundo plano) e refazer só o resto.
- **ponytail 5.x:** salto de major sem notas lidas; ganho desconhecido, e o patch local seria refeito.
- **Harbor 0.26.0:** vale só entre rodadas de benchmark (muda o formato das tasks).
- **Remover `--experimental-strip-types` dos docs:** cosmético, sem urgência.
- **Atualizações pontuais** (semgrep, diff-cover, biome, harden-runner, mcpvault, computer-use-linux): baixo risco, mas sem correção de segurança conhecida; agrupar numa passada de manutenção.

## Não verificado

- Notas completas e compatibilidade do ponytail v5.x e do pi-lsp 0.1.8 com os patches locais.
- Changelog de Harbor 0.26, semgrep 1.186, harden-runner v2.23.0, computer-use-linux 0.7.54–0.7.56 e mcpvault 0.18.4.
- Versão atual do `@modelcontextprotocol/sdk` (o lock está em 1.32.2) e do Claude Code para o braço `cc-vanilla`.
- Páginas do pi upstream sobre extensões e pacotes, por orçamento.
- Hooks de `agent`/`prompt`/`http` do Claude Code: só confirmados via Perplexity, sem leitura da seção completa.
- Medições de desempenho (do parent) e exploração de segurança (do security-reviewer).
- Provedores: Perplexity `perplexity_search` e Brave `brave_llm_context` (cache e MCP deferido), Parallel `web_search` (Node), mais `web_fetch` nas páginas primárias; a lista de versões veio de `package_version_check` e do registro npm direto.

**Atualização do registro:** nenhum documento foi editado, conforme a regra de somente leitura. O registro `docs/audit-2026-11-19/README.md` pode ganhar esta tabela como `research/atualidade.md`, a cargo do parent.
