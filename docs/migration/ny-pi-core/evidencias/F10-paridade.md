# Evidência F10: paridade sem modelo

## Objetivo

Fechar com as camadas sem modelo de [09](../09-paridade-e-benchmark.md) §1 os itens de benchmark que a D-29 deixou
abertos: C-F3-09, C-F3-10, C-F5-29, C-F6-14 e C-F10-01 a 05. Dono, 2026-11-21 (D-39): "fazer estes itens sem
benchmark". Nenhuma chamada a modelo ou a provedor real, nenhum benchmark (D-29 segue valendo); a credencial do bench
foi um arquivo falso e o token real nunca foi lido.

**Veredito sem modelo: não inferior.** Vale para as três camadas medidas: contrato com a API falsa, falhas injetadas e
diferencial do guard. O braço `nycode` repete o resultado do braço de referência `ny-pi` em todas (28 ok, 1 falha e
4 pulados no contrato, com a mesma falha; 7 de 7 cenários de falha iguais; 12 201 de 12 201 vereditos do guard iguais).
Isto **não** é o critério global 4 de [00](../00-mega-plano.md): acerto, custo por tarefa e tempo de tarefa precisam de
modelo e seguem sem medida (seção "O que não foi medido"). As perdas medidas ou de desenho estão ao lado dos ganhos
(seção "Perdas e ganhos").

## Braços e onde ficam os dados

| Braço | O que é | Versões |
|---|---|---|
| `nycode` | monorepo construído do checkout (`npm ci --ignore-scripts` e `npm run build`), `cli.js` do bundle | `nycode --version` = 1.6.0; commit do bench `d594d675753f` (rodada final), `1f7d2943e1fc` (primeira rodada) |
| `ny-pi` (referência) | harness do ny-pi sobre o pi instalado do dono | pi 1.5.2 (`current-version` da instalação gerenciada) + `pi-code` 1.7.0, `marcioazam/ny-pi` `e4f8729` |
| `ny-pi@1.6.0` (D-25) | o mesmo braço `ny-pi` com `BENCH_PI_VERSION=1.6.0`; os dois patches do core do pi 1.5.2 ficam de fora ("skipping core patch" no stderr) | pi 1.6.0 + `pi-code` 1.7.0 |
| `pi-vanilla` | pi com diretório de agente vazio | `arms.toml` declara pi 1.5.2; versão do binário da rodada não gravada |
| `claude-vanilla` | Claude Code com configuração isolada | `arms.toml` declara 2.1.323; o `claude` da máquina hoje é 2.1.328 e a versão da rodada não foi gravada |

Duas rodadas, as duas sem rede (namespace de rede próprio, só loopback) e contra a API falsa do `bench/contract`:

- **Primeira rodada** (SHA `1f7d2943e1fc`): `nycode` sem `mcp.json` e sem `codemode`, `nycode+AGENTS` (camada do dono
  só com o `AGENTS.md`), `ny-pi`, `ny-pi@1.6.0`, `pi-vanilla` e `claude-vanilla`; velocidade; diferencial do guard.
- **Rodada final** (D-40, SHA `d594d675753f`): `nycode` e `ny-pi` com as ferramentas versionadas e **o mesmo
  `mcp.json`** nos dois braços; `nycode` com a camada do dono vazia. É a base do veredito acima. Só a primeira rodada
  mediu o `ny-pi@1.6.0`, os vanilla e a velocidade; elas não foram refeitas com o `nycode` final.

Os JSON e TXT brutos ficam fora do repositório (`$HOME/.local/share/nycode-mig/d39` e `d39v2`). A linha de base da
rodada final está em `docs/bench/baseline-main/sem-modelo/` (C-F10-05).

## Contrato com a API falsa, caso a caso (C-F10-01)

Rodada final (D-40): `nycode` 28 ok, 1 falha, 4 pulados (exit 1); `ny-pi` 28 ok, 1 falha, 4 pulados (exit 1).

| Caso | `nycode` | `ny-pi` |
|---|---|---|
| `inventario/pedido-capturado` | ok | ok |
| `regras/plan_mode_complete-ausente` | ok | ok |
| `regras/question-ausente` | ok | ok |
| `regras/sem-erro-de-interface:read` | ok | ok |
| `regras/sem-erro-de-interface:bash` | ok | ok |
| `regras/sem-erro-de-interface:edit` | ok | ok |
| `regras/sem-erro-de-interface:write` | ok | ok |
| `regras/sem-erro-de-interface:run` | pulado | — |
| `regras/sem-erro-de-interface:codemode` | pulado | pulado |
| `basicas/read` | ok | ok |
| `basicas/write` | ok | ok |
| `basicas/edit` | ok | ok |
| `basicas/bash` | ok | ok |
| `basicas/todo` | falha | falha |
| `plano/plan_mode_complete-presente` | ok | ok |
| `plano/sem-escrita` | ok | ok |
| `comandos/goal` | ok | ok |
| `comandos/plan` | ok | ok |
| `comandos/agents` | ok | ok |
| `comandos/tasks` | ok | ok |
| `comandos/team` | ok | ok |
| `skills/skill-frontmatter` | ok | ok |
| `skills/skill-nomes-unicos` | ok | ok |
| `skills/agente-frontmatter` | ok | ok |
| `skills/agente-nomes-unicos` | ok | ok |
| `mcp/brave-search` | ok | ok |
| `mcp/codegraph` | ok | ok |
| `mcp/context7` | ok | ok |
| `mcp/exa` | ok | ok |
| `mcp/perplexity` | ok | ok |
| `mcp/playwright` | ok | ok |
| `mcp/tools-list` | pulado | pulado |
| `regras/sem-erro-de-interface:web_fetch` | — | pulado |
| `regras/sem-erro-de-interface:__<marcador adiado>__` | pulado | pulado |

- `basicas/todo` falha **nos dois** (e nos vanilla): o caso espera a ferramenta `todo` em `-p` e nenhum braço a envia.
  Não é regressão do `nycode`; é uma divergência do contrato com a referência, aberta nos dois lados.
- As quatro linhas que diferem são o inventário: `run` só no `nycode` e `web_fetch` só no `ny-pi` (seção seguinte), e o
  marcador interno adiado, que cada braço nomeia à sua maneira.
- Os 30 skills (`name` e `description`, nomes únicos) e os 17 agentes são os mesmos nos dois (`description_chars`
  6788 contra 6784 nos skills; 2045 nos agentes). Os comandos são conferidos de forma estática (registro no código),
  não executados.

## Inventário por ferramenta

Caracteres de descrição mais esquema por ferramenta enviada ao modelo em `-p` (rodada final).

| Ferramenta | `nycode` | `ny-pi` | Origem da diferença |
|---|---|---|---|
| `read` | 857 | 857 | |
| `bash` | 669 | 669 | |
| `edit` | 1248 | 1248 | |
| `write` | 451 | 451 | |
| `run` | 1232 | — | só no `nycode`: patch das ondas 5 a 9 do pi-code importado pela D-32 ("Os 67"); o `ny-pi` `e4f8729` fixa `pi-code@1.7.0` sem ele |
| `web_fetch` | — | 677 | só no `ny-pi`: no `nycode` a extensão `web` nasce desligada (C-F5-24) |
| `codemode` | 1490 | 1525 | texto do `nycode` 35 caracteres menor (−2,3%) |
| marcador adiado | 107 | 107 | |
| **Total** | **6054** (7 itens) | **5534** (7 itens) | +520 no `nycode` (+9,4%) |

Seções do system na rodada final (caracteres): `nycode` 7121 (tools 426, rules 726, project_context 4598,
mcp_servers 515, headless 664, cwd 51, texto 141); `ny-pi` 15 346 (tools 324, rules 726, headless 664,
project_context 919, cwd 51, texto 12 662). **Os totais do system não se comparam:** o `nycode` rodou com a camada do
dono vazia e o `ny-pi` com a do dono (`overlay.list`). A comparação justa de tamanho é a da primeira
rodada, na seção "Contexto" das dimensões.

## Falhas injetadas por cenário (dimensão 7)

Cada célula é `status` (código de saída, requisições com ferramentas, segundos). `ok` = texto final presente;
`failed` = saiu com erro e sem texto. Roteiro e cenários: `bench/faults/README.md`.

| Cenário | `nycode` (final) | `ny-pi` (final) | `ny-pi@1.6.0` | `pi-vanilla` | `claude-vanilla` |
|---|---|---|---|---|---|
| `rate-limit` | ok (0, 3, 2,5) | ok (0, 3, 3,7) | ok (0, 3, 4,4) | ok (0, 3, 2,3) | ok (0, 3, 2,1) |
| `overloaded` | ok (0, 3, 2,4) | ok (0, 3, 2,6) | ok (0, 3, 3,1) | ok (0, 3, 2,2) | ok (0, 3, 1,4) |
| `mid-stream-cut` | ok (0, 3, 2,5) | ok (0, 3, 2,6) | ok (0, 3, 3,0) | ok (0, 3, 2,2) | ok (0, 3, 1,4) |
| `slow-first-byte` | ok (0, 2, 8,4) | ok (0, 2, 8,6) | ok (0, 2, 9,0) | ok (0, 2, 8,2) | ok (0, 2, 8,3) |
| `malformed-sse` | failed (1, 1, 0,4) | failed (1, 1, 0,5) | failed (1, 1, 1,0) | failed (1, 1, 0,2) | failed (1, 2, 0,8) |
| `bad-tool-json` | ok (0, 2, 0,4) | ok (0, 2, 0,5) | ok (0, 2, 1,1) | ok (0, 2, 0,2) | ok (0, 2, 0,8) |
| `unknown-tool` | ok (0, 2, 0,4) | ok (0, 2, 0,5) | ok (0, 2, 1,1) | ok (0, 2, 0,2) | ok (0, 2, 0,8) |

Seis de sete cenários se recuperam em todos os braços; `malformed-sse` (JSON truncado no meio do SSE) falha com
saída 1 em **todos**, vanilla inclusive. Nenhum cenário terminou `silent` (erro mascarado, exit 0 sem texto) nem
`hung`: `masked` é falso nos sete do `nycode` e do `ny-pi`. O `nycode` repete o `ny-pi` em 7 de 7. As colunas `ny-pi@1.6.0`,
`pi-vanilla` e `claude-vanilla` são da primeira rodada (a nota do `ny-pi@1.6.0` é o aviso do patch do core, não erro).

## Diferencial do guard (dimensão 8)

`packages/coding-agent/test/harness/permissions/guard-differential.test.ts`: o oráculo é o `guard.py` (importado por
`oracle.py`); o corpus é cada literal de texto dos testes do próprio guard mais comandos aleatórios com semente fixa
(mulberry32), cada um julgado como Bash, Read, Edit e Write, com o bypass desligado e ligado. Resultado
(`vitest`, 1 arquivo, 10 testes verdes, 932 ms): **`differential: 12201/12201 identical`**. O critério da D-08 é o mesmo
veredito em 100% do corpus e do fuzz; ele vale para o motor nativo contra o script. A troca do padrão de
`permissions.engine` para `"native"` continua à espera da revisão de segurança e do benchmark (D-29, P-16 não muda).

## Braços vanilla (C-F10-02)

`pi-vanilla` e `claude-vanilla`, medidos uma vez no contrato e nas falhas (primeira rodada), sem modelo.

| Braço | Contrato | Ferramentas | System (chars) | Observação |
|---|---|---|---|---|
| `pi-vanilla` | 11 ok, 1 falha, 1 pulado | 5 (`read`, `bash`, `edit`, `write`, marcador) | 2371 | só roda o grupo `basicas` e as regras; sem `plano`, `comandos`, `skills` nem `mcp` (não há harness) |
| `claude-vanilla` | 8 ok, 4 falhas, 8 pulados | 12 (`Agent`, `Bash`, `Edit`, `ListAgents`, `Read`, `ReportFindings`, `ScheduleWakeup`, `Skill`, `ToolSearch`, `Workflow`, `Write`, marcador) | 5703 | ferramentas 30 017 chars; as falhas de `basicas/read`, `write` e `edit` são o contrato enviando o parâmetro `path` do pi, que o Claude Code recusa (`file_path`): artefato do caso, não defeito do braço |

`basicas/todo` falha nos dois (`todo` não é enviada em `-p`), como no `nycode` e no `ny-pi`. Os dois vanilla se
recuperam dos mesmos 6 de 7 cenários de falha (tabela acima). Referência congelada de acerto com modelo, de 2026-11-14:
`docs/bench/BASELINE-VANILLA-2026-11.md` (D-14).

## Braço `ny-pi@1.6.0` (C-F3-09, D-25)

Medido sem modelo na primeira rodada, com o pi 1.6.0 gerenciado e os patches do core do 1.5.2 ignorados:

- **Contrato:** 25 ok, 2 falhas, 4 pulados, caso a caso **igual ao `ny-pi` sobre o pi 1.5.2** (nenhum caso mudou de
  estado). As duas falhas são `basicas/todo` e `comandos/subagents` (o verificador antigo procurava `/subagents` e o
  harness registra `/agents` e `/tasks`; o verificador atual troca esse caso por `/agents`, `/tasks` e `/team`, que passam no `nycode` e no `ny-pi`).
- **Inventário:** 7 ferramentas, 5546 chars de ferramentas e 15 349 de system (1.5.2: 5534 e 15 343).
- **Falhas:** as mesmas 6 de 7 (tabela acima), `malformed-sse` falha também.
- **Velocidade:** inicialização igual à do 1.5.2 (0,417 s contra 0,413 s), mas o encerramento do processo passou de 0,124 s
  para 0,524 s (total 1,030 s contra 0,641 s); causa não investigada. O `nycode` encerra em 0,025 s.
- **Plano `pr` em `--dry-run`:** US$ 6,72 estimados (16+12+10+4 unidades), igual ao do `nycode`.

Isto é a medida sem modelo do braço; `runs.jsonl` e veredito de gate (o que o texto antigo de C-F3-09 pedia) exigem
modelo e não existem.

## Velocidade (dimensão 5)

`bench/contract/speed.py`: 7 repetições, cache de compilação quente, a API falsa responde na hora (mede o processo, não o
modelo). Medianas; "razão" é a razão pareada **do primeiro braço (`ny-pi`) sobre o outro**, então valor acima de 1
significa que o `ny-pi` é o mais lento.

| Medida | `ny-pi` (pi 1.5.2) | `ny-pi@1.6.0` | `nycode` | `pi-vanilla` |
|---|---|---|---|---|
| Inicialização (`boot_s`) | 0,413 s | 0,417 s | 0,280 s / 0,266 s | 0,175 s |
| Intervalo entre turnos | 0,046 s | 0,045 s | 0,042 s / 0,040 s | 0,010 s |
| Encerramento (`exit_s`) | 0,124 s | 0,524 s | 0,027 s / 0,025 s | 0,027 s |
| Total | 0,641 s | 1,030 s | 0,387 s / 0,372 s | 0,226 s |
| Primeiro pedido | 22 513 bytes (≈5628 tokens) | 22 531 bytes (≈5633 tokens) | 21 123 bytes (≈5281 tokens) | 6423 bytes (≈1606 tokens) |
| Razão `ny-pi`/`nycode`, inicialização | 1,47 | 1,58 | | |
| Razão `ny-pi`/`nycode`, total | 1,62 | 2,77 | | |

O `ny-pi` é o mais lento: o `nycode` inicia em cerca de 68% do tempo dele (razão 1,47) e termina o ciclo em 62% (1,62)
contra o pi 1.5.2. Em cada linha com duas medidas do `nycode`, a primeira é a da rodada contra o 1.5.2 e a segunda a da
rodada contra o 1.6.0. **Ressalva:** o `nycode` desta rodada ainda não tinha `codemode` nem `mcp.json` (primeira rodada),
então o primeiro pedido e a inicialização medidos são menores que os de hoje; a velocidade não foi refeita com o
`nycode` final.

## As 11 dimensões (C-F10-03)

Cada uma com a medida sem modelo e a fonte, ou "sem medida" e o motivo. Fontes: seção 5.3 de
[09](../09-paridade-e-benchmark.md).

| # | Dimensão | Medida | Fonte | Estado |
|---|---|---|---|---|
| 1 | Confiabilidade | pass^k, oscilação, p90 e timeouts exigem repetição de tarefas com modelo. Sem medida. Proxy sem modelo: nenhum cenário `hung` nos 7 de falhas | `bench/metrics`, tabela de falhas | sem medida |
| 2 | Honestidade | falso sucesso e desistência honesta leem a mensagem final do modelo. Sem medida. Proxy sem modelo: nenhum erro mascarado (`silent`) nas falhas | `bench/metrics`, tabela de falhas | sem medida |
| 3 | Custo | mediana de razões de custo por tarefa exige modelo. Sem medida. O `--dry-run` do `nycode` estima US$ 6,72 (`pr`) e US$ 86,16 (`full`), mesma estimativa do `ny-pi@1.6.0` (é conta de `suites.toml`, não custo) | `stats.py`, `dryrun` | sem medida |
| 4 | Contexto | primeiro pedido e inventário: ver abaixo; prefixo em cache: estável em 4 de 4 casos nos 4 braços (conta própria sobre as capturas da primeira rodada) | `bench/contract`, `bench/contract/speed.py` | medida parcial |
| 5 | Velocidade | tabela acima; `nycode` mais rápido que o `ny-pi` (razão 1,47 a 1,62 em total). Tempo de tarefa com modelo: sem medida | `bench/contract/speed.py` | medida |
| 6 | Autonomia | pergunta ao usuário na mensagem final: lê a saída do modelo. Sem medida. Regra sem modelo: `question` e `plan_mode_complete` ausentes em `-p`, ok nos dois braços | `bench/metrics`, contrato `regras/*` | sem medida |
| 7 | Robustez | 7 cenários de falha, 6 de 7 iguais e `malformed-sse` igual (falha) | `bench/faults` | medida |
| 8 | Segurança | diferencial do guard 12 201 de 12 201; os casos `sec-*` do S1 e a regra do gate exigem modelo: sem medida | `guard-differential.test.ts`, `suites.toml` | medida parcial |
| 9 | Qualidade e dano colateral | casos `quality-*` do S1 exigem modelo; não há medida de alteração fora do escopo pedido (09 §5.3) | `suites.toml` | sem medida |
| 10 | Generalização | divisão `heldout` e conjuntos externos (TB2, SWE-bench Pro, TB 4.1) exigem modelo | `tasks/*.json` | sem medida |
| 11 | Interativo | o bench e o contrato usam `-p`; sem medida (09 §5.4) | seção 5.4 de 09 | sem medida |

### Contexto (dimensão 4)

- **Primeira rodada** (`nycode` com `AGENTS.md` do dono, mas **sem** `codemode` e sem `mcp.json`), em caracteres de
  ferramentas mais system: `nycode+AGENTS` 4173 + 15 441 = 19 614; `ny-pi` 5534 + 15 343 = 20 877; **−6,0%**. O
  primeiro pedido em bytes (`speed.py`): 21 123 contra 22 513, **−6,2%**.
- **Rodada final:** o `nycode` ganhou `codemode` (+1490 de ferramenta) e a seção `mcp_servers` (+515), mas o system
  rodou com a camada do dono vazia, então a soma não é comparável. Conta aritmética, **não medida**: 6054 + 15 441 + 515
  = 22 010 contra 20 880 do `ny-pi`, cerca de **+5,4%**. O sinal
  muda com o `codemode` e o MCP embutidos. Medir `nycode+AGENTS` no commit final com `bench/contract/check.py` fecha a
  dúvida; ela não bloqueia o veredito sem modelo, mas fica registrada como risco.
- **Prefixo em cache** (`system`, ferramentas e mensagens até a última marca `cache_control` do turno 0 comparadas com o
  turno 1, sem a marca): idêntico nos 4 casos (`read`, `write`, `edit`, `bash`) de `nycode+AGENTS`, `ny-pi`,
  `ny-pi@1.6.0` e `pi-vanilla`. A regra não existe em `bench/contract` (09 §1.2 a chama proposta); esta é uma conta
  avulsa sobre as capturas.

## Perdas e ganhos

| | Ganhos do `nycode` | Perdas ou diferenças |
|---|---|---|
| Ferramentas | `run` (patch das ondas 5 a 9 dentro do core, D-32) | **`web_fetch` desligada por padrão** (C-F5-24): o `ny-pi` a envia, o `nycode` não; quem quiser liga a extensão `web` |
| `codemode` | | descrição 35 caracteres menor (1490 contra 1525) |
| Velocidade | inicia em 0,28 s contra 0,41 s e encerra em 0,03 s contra 0,12 s (1.5.2) ou 0,52 s (1.6.0) | medida antes do `codemode` e do MCP no `nycode` |
| Contexto | −6,0% (ferramentas e system) na primeira rodada | cerca de +5,4% por estimativa com `codemode` e MCP; sem medida final |
| Contrato | mesmo resultado que o `ny-pi` em 28 casos; `comandos/team` e os de `/agents` e `/tasks` ok | `basicas/todo` **falha nos dois** (e nos vanilla) |
| Falhas | iguais às do `ny-pi`, 7 de 7 | `malformed-sse` falha em **todos** os braços |
| Segurança | guard nativo igual ao script em 12 201 de 12 201 | `permissions.engine` ainda `"script"` por padrão |

## O que não foi medido

- **Qualidade de resposta do modelo e acerto por tarefa** (S1 a S6, S8): exige modelo (D-29).
- **Custo real e razão de custo por tarefa** (`COST_MAX` 1,10): exige modelo; só há a estimativa do `--dry-run`.
- **Tempo de tarefa** (parede com modelo): só informativo no gate; sem medida.
- **Modo interativo** (dimensão 11): nenhum braço do bench o exercita.
- **Velocidade e contexto do `nycode` final** (com `codemode`, MCP e camada do dono): medidos só antes deles.
- **`tools/list` dos servidores MCP e ferramentas sem input inofensivo** (`run`, `web_fetch`, `codemode`): puladas.
- O `ny-pi@1.6.0` não foi repetido na rodada final (D-40); a comparação com ele usa a primeira rodada.

## Como reproduzir (RUNBOOK)

Venv Python 3.12 do CI (`scripts/ci/requirements-ci.txt`, com `--require-hashes`); o código do bench da rodada final está
no ramo `feat/bench-nycode-contract` (commit `d594d6757`, PR em entrega; reproduza a partir da `main` quando ele entrar).
As variáveis `PI_*`, `CLAUDE_*` e `ANTHROPIC_*` da sessão são removidas pelo próprio verificador; a credencial é um
arquivo JSON falso, nunca o token do dono.

```bash
export BENCH_REPO=marcioazam/nycode BENCH_CC_CREDENTIALS=<arquivo de credencial falso>
# estágios (fora do sandbox; só o ny-pi precisa de BENCH_NYPI_SRC, checkout do ny-pi em e4f8729)
BENCH_STAGE=<estagio-nycode> BENCH_OVERLAY_DIR=<camada vazia> bench/arms/nycode --version
BENCH_NYPI_SRC=<ny-pi> BENCH_STAGE=<estagio-ny-pi> bench/arms/ny-pi --version
# contrato e falhas (sem rede: bwrap --unshare-net, / somente leitura)
python3 bench/contract/check.py --arm nycode --json contract-nycode.json
python3 bench/contract/check.py --arm ny-pi --json contract-ny-pi.json
python3 bench/faults/run.py --arms nycode,ny-pi --json faults.json
python3 bench/contract/speed.py --help          # velocidade: braços e repetições
# diferencial do guard
cd packages/coding-agent && env -u OPENROUTER_API_KEY npx vitest --run test/harness/permissions/guard-differential.test.ts
# plano dos tiers sem executar
python3 bench/run.py run --arm nycode --tier pr --model claude-sonnet-5-5 --dry-run
```

Versões: Node do repositório, `nycode` 1.6.0, pi 1.5.2 e 1.6.0, `pi-code` 1.7.0, Claude Code 2.1.328 no `claude` da
máquina, vitest 4.1.12.

## Itens do checklist

| Item | Estado | Prova |
|---|---|---|
| C-F3-09 | feito sob a D-39 | contrato, falhas, velocidade e `--dry-run` do `ny-pi@1.6.0` (seção própria); sem `runs.jsonl` |
| C-F3-10 | feito sob a D-39, **sem status publicado** | classificador local e status em `--dry-run` (seção abaixo) |
| C-F5-29 | feito sob a D-39 | `nycode` contra `ny-pi@1.6.0` no contrato (casos comuns iguais, `comandos/subagents` do verificador antigo trocado por `/agents`, `/tasks` e `/team`) e nas falhas (7 de 7) |
| C-F6-14 | feito sob a D-39, texto reescrito | `plan`: casos `plano/*` (2 de 2 ok) e `comandos/plan`; `multi`: só `comandos/agents`, `tasks`, `team` (registro estático) e os testes de F6; acerto das suítes sem medida |
| C-F10-01 | feito sob a D-39 | veredito sem modelo acima |
| C-F10-02 | feito sob a D-39 | braços vanilla acima |
| C-F10-03 | feito sob a D-39 | tabela das 11 dimensões |
| C-F10-04 | feito | este arquivo |
| C-F10-05 | feito sob a D-39 | `docs/bench/baseline-main/sem-modelo/` |

### C-F3-10: classificação de um PR de documentação

O poster local (`bench/tools/bench-pr.sh`) chama `python3 bench/run.py affects --base main --head <sha>`; se a primeira
linha for `non-functional`, publica o status `bench-pr` `success` com "não funcional, sem rodada" por `bench/run.py
post-status` e comenta o PR. O classificador (`bench/classify/affects.py`) falha fechado. Sobre o PR #285 (documentação
de F9, head `f2e5fb7b5`, base `e811c2ae2`), no venv do CI:

```text
$ python3 bench/run.py affects --base e811c2ae2 --head f2e5fb7b5
non-functional
- docs/migration/ny-pi-core/11-decisoes-e-pendencias.md: docs
- docs/migration/ny-pi-core/12-checklist-mestre.md: docs
- docs/migration/ny-pi-core/evidencias/F9.md: docs
```

Status que seria publicado (`gate.post_status` com um `gh` simulado, nada enviado ao GitHub):

```text
repos/marcioazam/nycode/statuses/f2e5fb7b5a1948e4dd2914f6aa42900452884f69
  state=success  context=bench-pr  description=não funcional, sem rodada
```

**Não publicado:** a publicação é do poster da máquina do dono (unit `bench-pr` do systemd, com
`~/.config/nycode/bench.env`) e `bench-pr` ainda não está no ruleset (D-29, P-16); nenhum PR tinha status `bench-pr`
(`gh api repos/marcioazam/nycode/commits/f2e5fb7b5/statuses` devolveu lista vazia). Resta, em P-16, instalar o poster e
ver o status verdadeiro num PR de documentação.

### C-F10-05: linha de base sem modelo

`docs/bench/baseline-main/{runs.jsonl,verdict.json,meta.json}` seguem intactos (alimentam o `bench-pr` com modelo; o
gate nunca é enfraquecido). A linha sem modelo fica em `docs/bench/baseline-main/sem-modelo/` com o contrato e as
falhas da rodada final de `nycode` e `ny-pi` (JSON). Verificação de que nada do bench lê esse diretório: `rg -n
"baseline-main" bench scripts .github` só acha o diretório `baseline-main` por caminho fixo (`bench-pr.sh`,
`test_rounds.py`) e o gate lê `<dir>/runs.jsonl` e `<dir>/meta.json`, sem glob.

Único risco achado: `bench-nightly.sh` sugere, para regravar a linha com modelo, apagar `docs/bench/baseline-main` e copiar a rodada nova
no lugar, o que levaria `sem-modelo/` junto; o README do diretório manda preservá-lo (o script não foi alterado).
