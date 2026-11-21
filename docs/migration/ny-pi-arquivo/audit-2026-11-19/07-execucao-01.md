# 07 — Execução do documento 01 (pedido do dono, 2026-11-19)

Pedido: "01-gaps-bugs-logs.md: executar este e resolver tudo com precisão máxima". Supera a restrição anterior
("só segurança e performance") e a exclusão de `extensions/ui/` e `extensions/ui-visual/` (nenhum arquivo dessas
pastas mudou nos 40 min anteriores ao início; as mudanças não commitadas de outras sessões são preservadas e
editadas por cima). Continua valendo: sem commit, push ou PR; sem `git checkout/restore/stash`; sem tocar
`~/.pi/agent`; sem dependência nova; teste primeiro (vermelho → verde); arquivo ≤ 800 linhas, diretório ≤ 7 arquivos
de código; um gate no fim.

## Aceitação

- AC1: cada defeito das tabelas do doc 01 termina como `corrigido` (com teste que falhava antes), `não reproduz`
  (com a evidência) ou `não corrigido` (com o motivo concreto), e a coluna estado do doc 01 é atualizada.
- AC2: nenhum teste existente é afrouxado; mudança de contrato de teste é registrada aqui com o motivo.
- AC3: os testes dos arquivos tocados passam; o gate final é rodado uma vez e as falhas são classificadas.

## Fora desta execução (motivo)

- Subir pi-code 1.7.0 → 1.10.1 e demais atualizações: o próprio doc 01, parte (c), recomenda não migrar agora (12
  patches falham); é trabalho próprio, com rollback.
- Piso de cobertura de 80% por arquivo como bloqueio no CI (itens 3 e 4 do plano de testes): entra como medição
  informativa; bloquear hoje deixaria o CI vermelho em ~270 arquivos TS sem teste.

## Unidades

Onda 1 (arquivos disjuntos):

| unidade | defeitos | arquivos |
|---|---|---|
| A1 fluxo | F1 F2 F3 F4 F5 F6 F11 F15 F16 F17 F18 F19 F20 F22 F23 F24 | `extensions/{auto-resume,syntax-check,comandos,bash-timeout,cache-prefix-probe}/`, `extensions/compact-at-400k.ts`, `extensions/plan-gate.ts`, `extensions/no-context-files-covers-claude-md.ts`, `extensions/claude-compat/vim/engine.ts`, `extensions/claude-compat/background/record.ts`, `extensions/image-open/index.ts` |
| A2 diagnóstico | F14 F21 S8 L5 L6 L7 L9 | `extensions/diagnostico/**` |
| B UI | U5–U16, U23–U26 | `extensions/ui-visual/**`, `extensions/ui/editor.ts`, `extensions/chat-margin/**`, `extensions/code-blocks/{syntax,blocks}.ts` |
| D bench | B1–B7 | `bench/run.py`, `bench/runners.py`, `bench/tests/**` |

Onda 2:

| unidade | defeitos | arquivos |
|---|---|---|
| C scripts e HUD | G7 (resto: `.env.<qualquer>`), G12, S1, S5, S6, S7, S9, U17–U22, E1 | `claude-home/hooks/**`, `claude-home/bin/**`, `bin/pi`, `mcp.json.example`, `claude-home/skills/atualizador/scripts/**` |
| E testes e CI | plano de testes 1, 2, 5, 9–15; 3 e 4 informativos | `.github/workflows/**`, `scripts/ci/**`, testes novos |
| F instruções | L1 L2 L3 L4 L10 L11 L12 | `claude-home/agents/**`, `claude-home/skills/**/SKILL.md`, `claude-home/rules*/**` |

Decisão S1 (delegada pelo dono com "resolver tudo"): quem roda com o mesmo uid do agente consegue forjar qualquer
arquivo, variável ou segredo do processo; a única prova que o agente não fabrica é a resposta do usuário no terminal.
O supervisor passa a pedir confirmação em `/dev/tty` antes de reabrir com bypass uma sessão lançada sem ele; sem
terminal, nega. O teste `legado bypassPermissions:1 … default/1/0/1` muda de contrato por isso.

## Progresso

- [x] A1
- [x] A2
- [x] B
- [x] D
- [x] C
- [x] E
- [x] F
- [x] revisão, gate único, atualização da coluna estado do doc 01

## Evidência

### F (instruções de agentes)

- L1: 3 menções restantes de `$CLAUDE_CONFIG_DIR/docs/agent-contract.md` trocadas por `~/.pi/agent/claude-home/...`
  (agent-routing ×2, research-and-tools); `rg -l` vazio. Os agentes já usavam `~`.
- L2/L10/L3/L4: uma frase em `docs/agent-contract.md` (Evidência): teto 1800 s e `run start {await}`; `rm -rf`/`pkill
  -f` negados, alternativa, não repetir comando negado.
- L12: `rules-ref/research-and-tools.md` linha 10: 402/crédito/not found troca de provedor na hora.
- L11: sem causa no texto (`tools:` de perplexity-scout lista `mcp__keenable__search_web_pages`, o nome está certo): não
  mudado.
- Checagens: instruction_budget +138 antes e depois (CLAUDE.md, preexistente); check-refs igual; skill_lint 0 problemas.

### C (scripts, hooks, HUD, entrega)

O worker parou no limite de turnos depois de terminar todos os itens; este bloco foi escrito pela sessão principal a
partir do transcript (`fg-2ac51449`) e do disco.

- G7-resto: `.env.<qualquer>` negado no Read (no bash: `ask` nos modos com `PI_PERMISSION_MODE`; allow sem modo e com
  bypass, como antes), exceto `.example|.sample|.template|.dist`. **Contrato de teste
  mudado:** `test_guard.py` `.env.development` saiu de ALLOW e foi para DENY (autorizado em "resolver tudo").
  `hooks`: 255 testes, 287 subtestes verdes.
- Plano 13: `test_guard.py` e `test_guard_modes.py` com HOME temporário fixo.
- G12: `hook-dispatch.sh` varre só 64 KB iniciais + 64 KB finais do `tool_response`; hyperfine 10 runs: 1 MB
  57,0 → 38,4 ms. Teste: injeção no início e no fim ainda detectada. `test_dispatch.py` 34 verdes.
- S1: `supervisor.sh` pergunta em `/dev/tty` (s/N, 30 s) antes de reabrir com bypass uma sessão lançada sem ele; sem
  terminal nega. **Contrato de teste mudado:** `default:1 com opt-in, sem tty` agora espera `default/0/0/0` (antes
  `default/1/0/1`); `PI_RESTART_TTY` injeta o tty no teste.
- S5: `mcp.json.example` com versões exatas (`npm view`), checado por `scripts/ci/lint/check_mcp_pins.py` (unidade E).
- S6: manifesto `claude-home/bin/patches.sha256` gerado por `claude-home/bin/patches-manifest.sh gen`; `bin/pi`
  avisa e não aplica grupo divergente; sem manifesto, checagem desligada. `tests/lifecycle/patches-manifest.test.sh`:
  14 ok (inclui e2e com patch adulterado não executado).
- S7, U17–U22: HUD (`claude-hud-pi-transcript`, `calm-statusline`, `claude-hud-provider`, `claude-hud-usage`,
  `claude-hud-statusline`) com testes vermelhos antes (S7, U19, U22 vistos falhando); calm 17, statusline 4,
  usage 19, provider 5 verdes.
- S9: `puxar.py` temp único e unlink em falha; `test_puxar.py` 17 verdes.
- E1 e plano 11: `gd_common.Ctx.run` com `start_new_session` + `killpg`; teste do neto órfão vermelho antes;
  proof de SHA diferente recusa merge. atualizador 82 verdes.
- Plano 5: `hooks/claims/test_claims.py` (7 testes).
- Fora da unidade: `bin/pi:377` cita `patches/pi-core/contexto-reserve.mjs`, que não existe; a linha é trabalho não
  commitado de outra sessão (não está no HEAD), deixada como está.

### Revisão e gate final

Revisão (`code-reviewer`, somente leitura): 3 defeitos e 1 divergência de registro, todos tratados na sessão principal.

- S6: `find -type f` não seguia symlink, e a instalação viva é uma árvore de symlinks por arquivo. Agora usa
  `find -L`; caso novo em `patches-manifest.test.sh` (vermelho com `find`, verde com `find -L`; 15 ok). Script e
  manifesto movidos para `claude-home/bin/lifecycle/` (a pasta `claude-home/bin` passava de 7 arquivos de código).
  **Não publicado de propósito:** o live tem patches que o repo não tem (`plan-modal`, `question-nav`,
  `plan-no-interrupt`, `todo-active`, `question-title-only`…); publicar o manifesto hoje faria o `bin/pi` pular o
  grupo `pi-code` inteiro. Ligar exige o publish podar links órfãos (decisão do dono).
- L9: o bloqueio contava chamadas idênticas mesmo com resultado diferente (polling de `git status`, `run status`).
  Agora a chave inclui o hash do resultado e o `isError`; teste novo (10 polls com saída diferente não bloqueiam;
  3 resultados idênticos bloqueiam a 4ª). `detector.test.ts` 15/15; `correlacao.test.ts` com as mesmas 4 falhas alheias.
- G12: a janela de 64 KB + 64 KB deixava passar injeção no meio com preenchimento. Saída > 128 KB passa a receber o
  aviso sempre (o meio não é varrido); o teste que fixava `""` para o meio virou `untrusted data` (contrato mudado,
  porque fixava o defeito); `test_dispatch.py` 34/34. O `tostring` roda uma vez só.
- G7: o texto acima foi corrigido (bash não nega sem modo).
- `compact-at-400k.test.ts` movido para `claude-home/bin/tests/extensions-contract/` (a pasta `tests` tinha 8).
  `structure.py`: 0 achados.
- Removido `bin/.e2e_tmp.sh`, resto de teste da unidade C.

Gate (`gate-runner`, HEAD `4e38f41`, 294 caminhos sujos, logs em `/tmp/audit-gate2/`), rodado antes das correções
da revisão:

- Passaram: pytest 538 + 329, diff-cover ≥ 80, testes de patches 486/486, pins do `mcp.json.example`, skill-lint,
  selftests, actionlint, zizmor, trufflehog.
- Node 1546/1592; as 45 falhas estão em `ui/test/index`, `bypass-permissions`, `claude-compat/clear`, `hook-msgs`,
  `diagnostico` (32, as mesmas de antes da A2) e 4 em `claude-home/bin/tests` (`native-panels`, `plan-section`,
  `plan-table`, `native-cli-e2e`). Nenhuma está num teste escrito ou alterado por esta execução.
- ruff, ruff format e mypy nos `.py` desta execução: contagem igual ou menor que no HEAD em cada arquivo
  (`bench/*` e `compaction-400k.py` ficaram limpos); só `test_dispatch.py` ganhou 1 aviso `PLW1510` em
  `existing_repo`, hunk que não é das unidades.
- biome: 517 erros na árvore. Nos `.ts` tocados, só `ui/editor.ts` (+4), `ui-visual/diff.ts` (+1) e
  `ui-visual/tools.ts` (+5) sobem frente ao HEAD, em arquivos com edições de outras sessões, sem separar autoria.
  **Não corrigido.**
- shellcheck, shfmt, markdownlint (44 `.md`) e check-refs (16, entre eles `contexto-reserve.mjs`, de outra sessão):
  falham na árvore suja.
- Semgrep `python36-compatibility-Popen1` (bloqueante) vinha do E1 em `gd_common.py`: o `Popen` deixou de usar
  `text`/`errors` e decodifica com `errors="replace"` (mesma saída); semgrep sem o achado, atualizador 192/192,
  mypy 33 (HEAD 34), ruff 1 (HEAD 1).
- Segurança: gitleaks e os demais achados do semgrep (regex não literal em arquivos com trabalho alheio) sem separar
  autoria; osv-scanner ausente no PATH. **Não
  classificado.**
- Não rodado de novo depois das correções da revisão: o gate inteiro. Só os testes dos arquivos tocados.

### Incidente: guard PreToolUse falhando ("Failed with non-blocking status code")

Observado pelo dono em 2026-11-19: toda tool call mostrava `Hook PreToolUse falhou · python3 …/guard.py`.

- **Causa:** a U1 separou o guard em `permissions/parse.py` e `permissions/rules.py`. A instalação viva liga arquivo a
  arquivo (`install.sh --link`) para a árvore de trabalho, então o `guard.py` novo entrou no ar na hora, mas os dois
  módulos não tinham link (nem linha em `publish.list`). O `sys.path` usava `abspath(__file__)` (o diretório vivo),
  o import quebrou com `ModuleNotFoundError` e o hook saiu com 1.
- **Gravidade:** exit 1 é erro **não bloqueante** no Claude Code e no pi (`hooks/decisions.ts:178`): desde a U1 até a
  correção, toda tool call rodou **sem guarda**. Fontes: <https://code.claude.com/docs/en/hooks> ("The action goes
  ahead"), issues anthropics/claude-code #44707, #81458, #82323.
- **Contenção:** links de `parse.py` e `rules.py` no vivo; `rm -rf /` volta a dar deny.
- **Correção na causa (defesa em camadas, OWASP AI Agent Security "fail closed when … policy lookup … fails"):**
  1. `guard.py` carrega os módulos irmãos de `realpath(__file__)`: a classe "módulo novo sem link" some. Teste
     `TestSymlinkInstall` (vermelho: o mesmo `ModuleNotFoundError`; verde).
  2. Falha interna do guard (import, exceção, JSON inválido) agora **bloqueia** com exit 2 e diagnóstico no stderr;
     saída de emergência só pelo ambiente de quem lança o pi (`PI_GUARD_FAIL_OPEN=1`). **Contrato de teste mudado:**
     `test_invalid_json_allows` → `test_invalid_json_blocks`; inbox com exit 2. Testes novos de import quebrado e da
     saída de emergência. `hooks`: 258 testes verdes; mypy sem erro em `guard.py`; ruff limpo.
  3. Paridade do `onFailure: "block"` do Claude Code no pi-code (patch novo
     `zzzzzzzzzzzzzzzzzzzzzzz-hook-on-failure`, 8 testes, 4 vermelhos sem o patch): cobre o que o próprio guard não
     pega (`python3` ausente, erro de sintaxe no `guard.py`). Ligado no `settings.json` vivo (backup
     `settings.json.bak-2026-11-19-guard`) e no `.example`; o matcher vivo ganhou `Grep` (G8, que só estava no
     `.example`). O patch entra no próximo start do pi pelo wrapper (dry-run limpo na cópia viva).
  4. `install.sh --link --apply` faz smoke do guard (payload `rm -rf /` tem de voltar deny; senão aborta com dica de
     `--restore`); caso novo em `scripts/test_install.sh` (ALL OK).
  5. `publish.list` ganhou os 11 arquivos novos desta execução (inclui `parse.py`/`rules.py`), sem os quais o
     pre-commit bloquearia o commit.

Decisões do dono ("decida e aplique"):

- **Manifesto de patches (S6):** fica como checagem de integridade do repositório no CI; **não** é ligado no vivo. Os
  15 arquivos que só existiam no vivo (7 patches pi-code com testes e `pi-core/contexto-reserve.mjs`) foram copiados
  para o repositório e entraram em `publish.list`, e o manifesto confere com o vivo. Ligar no vivo faria qualquer
  edição de patch sem `gen` desligar o grupo inteiro no próximo start, por um ganho pequeno (o agente roda com o
  mesmo uid e reescreveria o manifesto).
- **`bin/pi:377` / `contexto-reserve.mjs`:** resolvido trazendo o arquivo do vivo para o repositório.
- **11 testes de patches fora do CI:** religados, `node-patches-excluded.txt` ficou só com o cabeçalho. Causa: 5
  arquivos de patch (`plan-state`, `fleet-sync` e 3 testes) fora de `publish.list`; no HOME do runner o manifesto
  divergia e o `bin/pi` pulava a pilha inteira. `question-dialog.test.ts` (largura 70 cortava a marcação do tema) e
  `onda5/question.test.ts` (revertia só 1 dos 7 patches que tocam `question.ts`) corrigidos sem afrouxar asserção.
  Suíte de patches 674/674 no HOME descartável com `CI=true`. O "redo the patch" original não reproduziu.
- **Prevenção da classe:** `scripts/ci/lint/check_publish_list.py` (+3 testes) reprova qualquer arquivo sob
  `claude-home/` ou `extensions/` fora de `publish.list` (exceto `*.example`); passo novo em `run-static.sh`. Achou
  15 lacunas de outras sessões (`todo-sync/index.ts`, `ui-visual/motion/{escrita,nycode,shell}.ts`,
  `ui-visual/read/chips.ts`, testes), acrescentadas ao `publish.list`; agora sai 0.

### Sessão principal (onda 1)

- U26 (parcial na unidade B): ligado em `code-blocks/index.ts` (`syntaxPalette` usa `themePalette` com os tokens
  `syntax*` do tema; a chave do cache passa a incluir o nome do tema). Teste novo `U26: paleta de sintaxe usa os
  tokens syntax*…` em `code-blocks/index.test.ts`: vermelho por construção no código antigo (mesma chave e mesma
  paleta para temas diferentes no mesmo fundo); verde: `code-blocks` 29 de 29.
- L5 (needs_decision da A2): decidido **não reproduz**. Dos 141 WARN `tool:bash`, nenhum tem saída 0 (106 saída ≠ 0,
  32 bloqueios, 3 timeouts); WARN para saída ≠ 0 é o contrato do teste `diagnostico/test/index.test.ts:116`. Sem
  mudança de código.
- Imagens Harbor: B8 (unidade D) remove, depois de cada etapa, só as imagens que a etapa baixou
  (`--keep-images`/`BENCH_KEEP_IMAGES=1` mantêm). As 77 imagens já presentes não foram apagadas.

(cada unidade acrescenta um bloco `### <unidade>` com vermelho, verde e o que não foi corrigido)

### A1 (fluxo)

Todos corrigidos, cada um com teste vermelho antes (asserção falhando ou, em F5, travamento/OOM) e verde depois.
Pré-existente: `auto-resume/index.test.ts` "cartão de limite" (1 falha, não é de A1: `2 !== 0` no erro vermelho do
cartão).
Testes novos (verde): auto-resume 21/22 (+4: F1, F15 ×2, F16),
`claude-home/bin/tests/extensions-contract/compact-at-400k.test.ts` 6 (arquivo novo aqui porque `extensions/` já tem 7
`.ts`), syntax-check 7 (+1), vim engine 155 (+3), plan-gate 30 (+2, em `claude-home/bin/tests/`), no-context-files 4
(+1), comandos paleta 9 (+2), bash-timeout 13 (+2), cache-prefix-probe 3 (arquivo novo), background record 13 (+1),
image-open 10 (+2).
- F1 `prior` para em mensagem `user` (503 e limite). F15 `jitter(ms, rand)` ±20%, `rand` injetável; só nos erros, não no
  limite da conta. F16 `usage-cache.json` só lido quando a decisão é retomar por limite.
- F2 `envPositive` (vazio/NaN/≤0 → padrão) em `PI_COMPACT_AT` e `PI_COMPACT_SUMMARY_MAX`. F3 `try/finally` zera
  `running`.
- F4 `tree.delete()` + `parser.delete()` em `finally` (contados nos protótipos reais do wasm).
- F5 contagem ≤ 9999 e `guardRepeat` (20 000 teclas, mesmo valor de `MAX_OPS` do host) em `leaveInsert` e antes do
  replay do `.`; vermelho = processo morre por memória (16 s).
- F6 `>` em vez de `>=`. F24 liberação (`allow`) com mesmo state/why da última entrada `plan-gate` não grava.
- F11 cache por `base64Data` (8 entradas, chaveado também por diretório, `lstat` uid/regular na reutilização) e trabalho
  pesado fora do tratador do clique (`setImmediate`; a CPU continua no laço, só adiada: `ponytail:` no código).
  Checagens `lstat`/`wx` preservadas.
- F17 hash em 1 passada e só das mensagens novas (varredura completa se a 1ª/última anterior divergem; mudança só no
  meio passa despercebida, `ponytail:`); `.jsonl` diário > 4 MB vira `<data>.1.jsonl`. Sonda mantida.
- F18 `try/continue`. F19 `ui-state.json` via tmp+`rename` (inode novo). F20 `lerEstado` memoizado por
  mtime+tamanho+ino.
- F22 `withoutBackground` descarta listas terminadas em `&` (aspas, parênteses, do/done); `if/fi`, `{ }`, `case` + `&`
  não reconhecidos. F23 `Deps.platform` (padrão `process.platform`): fora do Linux erro "plataforma sem /proc".

### A2 (diagnóstico; `extensions/diagnostico/**`)

Antes: 32 testes falhando (modal 14, painel 7, integracao 5, correlacao 4, index 1, registro 1), todos de trabalho
alheio.
Depois: os mesmos 32, mesmos nomes (diff de `not ok` vazio); +11 testes novos, todos verdes (vermelho confirmado antes
do código).

| id | resultado | teste | arquivo |
|---|---|---|---|
| F14 | corrigido: `rotacionar()` usa rename para `.rot.<pid>` como trinco; se o arquivo levado era pequeno (outro processo já rotacionou) devolve o conteúdo; mantém `.1` e `.2` (teto 3 arquivos) em diag e traces | `registro.test.ts` F14 ×2, `exportar.test.ts` F14 | `registro.ts`, `exportar.ts` |
| F21 | corrigido: try/catch por arquivo; JSON inválido vira achado `erro` do arquivo e o 2º arquivo segue | `doctor.test.ts` F21 | `doctor.ts` |
| S8 | corrigido: `podarInbox()` roda antes de `if (!ui) return` | `index.test.ts` S8 (sem UI e subagente) | `index.ts` |
| L5 | não alterado: dos 141 WARN `tool:bash` em diag.jsonl(.1): 106 são saída ≠ 0 (isError real, corpo = 1ª linha da saída), 32 bloqueios de guard/hook, 3 timeouts, nenhum com exit 0. O classificador (`index.ts` `tool_execution_end`, `isError`) não registra comando que não falhou; o que o dono chama de "falso positivo" é saída ≠ 0 esperada (grep/test) e não se distingue de falha. Decisão pendente: rebaixar sev para INFO quando só há `Command exited with code N`? | — | — |
| L6 | corrigido: o patch (`hook-diag.patch:14,27`) já enviava `durMs`; o diagnóstico o gravava como evento instantâneo. Novo `trilha.medido()` cria o span com início recuado em `durMs` | `integracao.test.ts` L6 | `trilha.ts`, `index.ts` |
| L7 | corrigido: `gen_ai.usage.cache_creation.input_tokens` (= `usage.cacheWrite`) e `pi.usage.cache_creation_1h.input_tokens` (= `cacheWrite1h`, só Anthropic) | `integracao.test.ts` L7 | `index.ts` |
| L9 | corrigido: `pi.on('tool_call')` devolve `{block:true, reason}` (API confirmada em extensions.md, evento tool_call); `criarGuardaLaco`, `PI_DIAG_TOOL_LACO_BLOQUEIO` (padrão 6, 0 desliga); conta só chamadas com resultado visto; entrada ou tool diferente zera; bloqueio registra `detector:tool-em-laco-bloqueio` | `detector.test.ts` L9 ×3, `correlacao.test.ts` L9 | `trilha.ts`, `index.ts` |

Mantido: o aviso de 3 falhas seguidas (`tool-em-laco`) não mudou. Ressalva L9: em execução paralela de tools do mesmo
turno o `tool_call` não vê resultados irmãos (extensions.md:979); a contagem usa só resultados já finalizados.

### D (bench)

Antes: `python3 -m pytest bench -q` = 95 passed. Depois: 107 passed (12 testes novos; os 12 falham contra o HEAD,
vermelho conferido em cópia em /tmp). ruff check/format e mypy --strict limpos em run.py, runners.py, images.py (testes:
mypy sem `pytest` instalado, pré-existente).

| id | resultado | teste | arquivo |
|---|---|---|---|
| B1 | corrigido: linhas não decodificáveis são puladas, avisadas e registradas em `meta.errors` | `test_resume_skips_truncated_last_line` | run.py |
| B2 | corrigido: `.tmp` + `os.replace`; `spent` soma runs com erro (e `cost_usd` do meta anterior); meta gravado cedo no resume | `test_resume_death_between_truncate_and_write_keeps_the_file`, `test_resume_counts_error_run_cost_against_the_cap` | run.py |
| B3 | corrigido: `run_group` (Popen em sessão própria + `killpg`) em `run_case`, S1 e Harbor | `test_timeout_kills_grandchildren` | runners.py |
| B4 | corrigido: timeout por chamada (S1 6 h `BENCH_S1_TIMEOUT_S`, Harbor 4 h `BENCH_HARBOR_TIMEOUT_S`); bloco encolhe para `ceil(saldo/custo médio)` tarefas (flag de teto do harbor não verificada, harbor não foi executado) | `test_run_s1_times_out`, `test_run_harbor_times_out_per_chunk`, `test_run_harbor_shrinks_chunk_to_remaining_balance` | runners.py |
| B5 | corrigido: estendido só com returncode 0 e `runs.ext.jsonl`; timeout `BENCH_EXTEND_TIMEOUT_S` (4 h); senão aviso e veredito não estendido | `test_gate_extension_needs_exit_zero_and_ext_file` | run.py |
| B6 | corrigido: `bundle.sh` uma vez por `short` por rodada | `test_harbor_step_bundles_once_per_checkout` | run.py |
| B7 | corrigido: `timeout` não é infra | `test_timeout_without_result_event_is_not_infra` | runners.py |
| B8 | feito: `bench/images.py` remove só refs novas `alexgshaw/*` e `<dataset>/*` após cada etapa Harbor (`docker rmi <ref>`, sem prune/-f; falha só avisa); `--keep-images` ou `BENCH_KEEP_IMAGES=1` mantém | `test_harbor_stage_removes_only_the_images_it_pulled`, `test_keep_images_flag_and_env_skip_removal` | images.py, run.py |

Testes usam `docker` falso no PATH (fixture autouse em `conftest.py`); nenhum docker, harbor ou modelo real rodou. Não
feito: `report.py` não precisou mudar; `load_round` (gate) ainda falha em linha truncada de `runs.jsonl`.

### B (UI de terminal)

Testes rodam com `env -u PI_CODE_SUBAGENT` (o agente exporta `PI_CODE_SUBAGENT=1`, e `tools.ts`/`compact.ts` saem cedo:
com ele 16 testes de `ui-visual/test/tools` "falham" por ambiente, não por código). Antes: ui-visual 0 falhas, ui/editor
0, chat-margin 0, code-blocks 0. Depois: ui-visual 188 pass/0 fail, ui/editor 41/0, chat-margin 10/0, code-blocks 28/0.
Fora do que B possui, falhas que já existiam e não foram tocadas: `ui/test/diff.test.ts` (2),
`ui/test/alias/autocomplete.test.ts` e `ui/test/index.test.ts` (módulo não resolvido na cópia de teste),
`hook-msgs/index.test.ts` (cópia sem `ui/a11y.ts`).

| id | resultado | teste | arquivo |
|---|---|---|---|
| U5 | corrigido: `prepareDiff` memoiza parse+ênfase por texto (64 diffs; >200 mil caracteres não fica retido); `memoLine` reaproveita o realce por linha entre larguras (limpo no `invalidate`) | `U5: prepareDiff…`, `U5: memoLine…` | ui-visual/diff.ts, tools.ts |
| U6 | reproduz (pi 1.5.2: `documentContainer.children[2]` é o `chatContainer`, o mesmo que `findChat` acha): `done` só se `attach` instalou; `attach` reconhece o render do hook do chat-margin e o chama (`pre`); `hookContainer` encadeia o render existente | 3 testes `U6` | ui-visual/compact.ts, chat-margin/inset.ts |
| U7 | corrigido: texto, `shellLabel` e respiro uma vez por `render()`; saída byte a byte igual (capturada antes) | `U7: render lê o texto…` | ui/editor.ts |
| U8 | corrigido: `compactRender` reaproveita linhas/layout com as mesmas referências e largura; igual à versão sem memo | `U8: mesmas referências…` | ui-visual/compact.ts |
| U9 | corrigido: `WeakSet` de vistos, `onChild` uma vez por filho | `U9: hookContainer chama onChild uma vez…` | chat-margin/inset.ts |
| U10 | corrigido (por contrato, não por contagem): `ligarCaminhos` reaproveita o último resultado por `NEGATIVO_MS`; `hostname()` uma vez | `U11 … U10 o mesmo texto reaproveita…` | ui-visual/motion/marcas.ts |
| U11 | corrigido: `false` só vale por 2 s | idem | marcas.ts |
| U12 | corrigido: chave = texto + componente mais novo (`acharMensagem`), LRU em vez de `clear()`; limite: o pi 1.5.2 não passa `messageId` em mensagem viva, então um re-render de mensagem antiga idêntica mostra a hora da mais nova | 2 testes `U12` | ui-visual/index.ts |
| U13 | corrigido só a formatação (`Intl.DateTimeFormat` único); a DFS de `afinarMensagem` fica (marcar por texto quebraria 2 mensagens idênticas no histórico) | `U13 …` | ui-visual/index.ts |
| U14 | corrigido: mapa `toolCallId→hora` montado uma vez por sessão (relê uma vez se o id é novo) | `U14 hora do histórico…` | ui-visual/tools.ts |
| U15 | corrigido: `reiniciar()` em `session_start`/`session_shutdown`; mapa `inicio` com teto de 300 | 2 testes `U15` | ui-visual/motion/vivo.ts, tools.ts |
| U16 | corrigido: `marcaUsuario` recebe `medir` (padrão code points, sem import novo em icons.ts); `index.ts` passa `visibleWidth`; corte por colunas | `U16 CJK e emoji…` | ui-visual/icons.ts, index.ts |
| U23 | corrigido: `reduce` em vez de spread | `U23 …` | ui-visual/diff.ts |
| U24 | corrigido: em bloco ≥ 4000 caracteres o tique refaz o Markdown no máximo a cada 100 ms | `U24 texto longo…` | ui-visual/motion/escrita.ts |
| U25 | corrigido: `repoGithub` assíncrono (`execFile`), `index.ts` preenche `repo` ao voltar | `U25 repoGithub…` | ui-visual/motion/marcas.ts, index.ts |
| U26 | parcial: `themePalette` em `code-blocks/syntax.ts` deriva as cores dos tokens `syntax*` (ausente/256 cores/inválido mantém a fixa; `fitPalette` continua depois). **Falta ligar** em `code-blocks/index.ts` (`syntaxPalette()`: `fitPalette(themePalette(isDark ? ONE_DARK : ONE_LIGHT, t => theme.getFgAnsi(t)), base)`); `TEXT_COLOR` (blocks.ts) não mudou: é constante usada por `resolveLang`, sem acesso ao tema | `U26 themePalette…` | code-blocks/syntax.ts |

Vermelho conferido rodando: U5, U6, U7, U8, U9, U12, U13, U16, U23, U24. U10, U11, U14, U15, U25, U26 tiveram o teste
escrito depois do código (vermelho por construção: função/contrato inexistente antes), não rodados contra o código
antigo.

### E (testes e CI)

Medido em `HOME` descartável (`install.sh` + `--link --apply`, `CI=true`, `env -i`), que é o que o runner vê; no
ambiente do agente, as variáveis `PI_CODE_SUBAGENT*` fazem 6 arquivos "falharem" por ambiente (com `env -i` passam 4).

| item | resultado | teste/arquivo |
|---|---|---|
| 1 | ligado: `claude-home/skills` (pytest, processo próprio + `coverage run -a`: junto com `claude-home/bin` o módulo `support` colide na coleta), `bin/test_pi_env.sh` e `lifecycle/*.test.sh` (com `env -u PI_RESTART_*`), `claude-home/patches/**/*.test.{ts,mjs}` (após `apply_pi_patches`: `bin/pi --help` aplica a pilha de patches do pi-code no HOME do runner) | `scripts/ci/run-static.sh`, `scripts/ci/node-patches-excluded.txt` |
| 2 | feito: `CI=true` sem `done-view.ts` reprova; fora do CI pula | `plan-gate.test.ts` (`missingParityFile`; vermelho com `HOME=/tmp/nohome CI=true`) |
| 3, 4 | informativos: cobertura nativa do node por arquivo (lcov → log e `GITHUB_STEP_SUMMARY`; só arquivos carregados pelos testes, os ~270 TS sem import não aparecem = não verificado) e `coverage report` por arquivo; nunca bloqueiam | `run-static.sh` (`node_cov`, `py_coverage_info`) |
| 9 | 4 casos offline (curl falso no PATH): `dest` `../x`, integridade npm errada, sha256 da licença divergente abortam sem escrever; controle com valores certos passa o estágio third-party. Caracterização do código que já fechava (sem vermelho) | `scripts/test_install.sh` a3–a6 |
| 10 | janela `LIMIT+16384` fora, `+16385` dentro com `reserveTokens 16385`, `PI_COMPACT_AT`; `models-store.json` ausente: vermelho = `FileNotFoundError` com traceback; verde = mensagem em stderr, exit ≠ 0, `settings.json` intacto. `open()` com `with` (ruff SIM115) | `scripts/test_compaction_400k.py`, `scripts/compaction-400k.py` |
| 12 | `/tmp/pwned` → sentinela em `$d` (`mktemp -d`), sem `rm -f` | `bin/test_pi_env.sh` |
| 14 | sleeps trocados por relógio controlado (`t.mock.timers`: `Date` em `fleet-sync`, `setTimeout/setInterval` em `estado`; o de `fleet-sync` agora também afirma "antes de 1 s não relê") | `fleet-sync.test.ts`, `ui-visual/test/tools/estado.test.ts` |
| 15 | contrato de `no-web-search` (3), `footer-no-stats` (4, pi-tui mínimo em dir temporário), `puxar` (7, HOME temporário); vermelho conferido por mutação em cópia (2, 2, 1 falhas). `cache-prefix-probe`: 3 passam. Em `claude-home/bin/tests/extensions-contract/` porque `tests/` já tem 8 arquivos | `claude-home/bin/tests/extensions-contract/*.test.ts` |
| a | `check_mcp_pins.py`: `@latest` em qualquer argumento ou pacote `npx` sem `nome@X.Y.Z` falha; vermelho = módulo ausente; `mcp.json.example` atual passa | `scripts/ci/lint/check_mcp_pins.py` + `test_check_mcp_pins.py` (7), passo no `run-static.sh` |
| b | `load_round` usa `_read_rows` (B1), avisa em stderr; vermelho = `JSONDecodeError` | `bench/tests/test_cli.py::test_load_round_skips_truncated_line_in_runs_and_ext`, `bench/run.py` |

Antes de ligar (local, `HOME` de runner): pytest skills 329 passed/1 skipped; patches + `bin/tests` 69 arquivos, 18
passavam sem a pilha de patches e 54 com ela; shell 2 + 1 scripts ok. Depois (execução completa de `run-static.sh` no
`HOME` descartável, com `coverage` num venv em /tmp): pytest 538 + 329, diff-cover ok, patches 40 arquivos/486 testes/0
falhas, `check-refs` falha, passo "node tests" falha.

Fora do CI (`node-patches-excluded.txt`, 11 arquivos de patch): os patches `status-names`, `icon-gap`, `box-padding` e
`plan-sota-and-fleet` não aplicam no pi-code 1.7.0 limpo ("redo the patch"); `fleet-entry` estourou 120 s uma vez nesse
ambiente. Nenhum teste foi afrouxado.

Vermelhos que já estavam (código alheio, não tocado): passo "node tests" (existente) com 45 falhas em 1592
(`extensions/{bypass-permissions,claude-compat,hook-msgs,ui}`, 32 do `diagnostico`, 4 de `claude-home/bin/tests`:
`native-panels`, `plan-section`, `plan-table`, `native-cli-e2e`); `check-refs` aponta
`claude-home/patches/pi-core/contexto-reserve.mjs` (citado por `bin/pi:377` e `compact-at-400k.ts`, inexistente no repo:
o wrapper só avisa), `claude-home/docs/bench/ny-pi-plan-gap-2026-11-14.md`, `claude-home/bin/pi-mock-src`.
`structure.py`: `claude-home/bin` e `claude-home/bin/tests` com 8 arquivos de código (limite 7).

## Origem das imagens Docker `alexgshaw/*`

Verificado em 2026-11-19 (somente leitura). São as imagens de tarefa do Terminal-Bench 2.0 que o Harbor baixa
(`alexgshaw/<tarefa>:20251031`, `bench/tasks/README.md:20`). 77 tags locais. O horário de `LastTagTime` de cada
imagem coincide com três rodadas da suíte S2 do `bench/`, em `~/.local/state/bench/`:

| janela (UTC) | imagens | rodada | evidência |
|---|---|---|---|
| 2026-11-15 23:53 → 11-16 03:xx | 49 | `tb2-sample-2026-11/s2-ny-pi` (49 tarefas) | primeiro job `s2-ny-pi.discarded-stack` 23:53Z, refeito 01:15Z |
| 2026-11-18 04:xx | 4 | `baseline-main-0ed4943` (4 tarefas: `gcode-to-text`, `gpt2-codegolf`, `merge-diff-arc-agi-task`, `regex-chess`) | diretório de 11-18 |
| 2026-11-18 15:xx | 24 | `tb2-remeasure-2026-11-18/s2-ny-pi` (72 tarefas; 24 imagens novas, as demais já estavam) | primeiro job 15:02Z |

Causa de ficarem: `bench/run.py` e `bench/runners.py` não removem imagens depois da etapa Harbor (`rg` por
`rmi|image prune` só acha a limpeza de worktree em `bench-pr.sh`). A limpeza manual descrita no README foi feita só
na geração das listas. O `bench-pr.timer` (a cada 10 min, por PR aberta) também roda
S2, mas só com as 4 tarefas do tier `pr` (`runs/<sha>/harbor/s2-*`): rebaixa essas 4 imagens se forem apagadas. `docker
system df` hoje: imagens
166,6 GB, 17,3 GB recuperáveis; as `alexgshaw/*` somam camadas compartilhadas, então o ganho real de apagá-las é
menor que a soma listada e só se mede apagando. Nada foi apagado.
