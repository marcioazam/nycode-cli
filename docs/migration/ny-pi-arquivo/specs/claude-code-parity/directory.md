# `/cd`: troca REAL de diretório na mesma sessão (unidade `directory`)

Substitui a lacuna de API de `interface.md` §6 (superada: `/cd` deixa de ser "não registrado"). Código:
`extensions/claude-compat/directory/**` (comando, caminhos, completação) e `claude-home/patches/pi-core/session-cwd/**`
(patch gerenciado do core 1.5.2: transação `SessionManager.setCwd` + ponte de contexto). O registro em
`extensions/claude-compat/index.ts`, `bin/pi`, o manifest e `matrix.ts` ficam com o integrador.

## Evidência (core 1.5.2, só leitura)
- `AgentSessionRuntime.switchSession(path, {cwdOverride, projectTrustContextFactory})` aceita override, mas
  `InteractiveMode.handleResumeSession(path, options)` (alvo de `ctx.switchSession`) só repassa `withSession`.
- `SessionManager.open(path, dir, cwdOverride)` muda o cwd só em memória; `_rewriteFile()` abre com `"w"` (trunca; sem
  temporário, backup nem checagem de concorrência): não serve para reescrever o cabeçalho. `forkFrom` muda o id.
- O diretório de sessões é derivado do cwd na criação (`--<cwd>--`); `list/continueRecent/findById` no diretório padrão
  NÃO filtram pelo `cwd` do cabeçalho; fora do padrão filtram.
- `teardownCurrent()` roda ANTES de `createRuntime()`: falha na criação deixa o runtime derrubado (recuperação é nossa).
- Confiança: `createRuntime` (main) resolve por cwd (`hasTrustRequiringProjectResources`, `trust.json` com herança por
  ancestral, prompt nativo via `projectTrustContextFactory`); `--approve/-a` (`projectTrustOverride`) vale para QUALQUER cwd.

## Decisão
Persistir o cwd no próprio cabeçalho da sessão (campo nativo `cwd`, lido por resume/fork/list/continue e por clientes antigos:
nenhum formato novo, nenhum downgrade quebrado), por uma transação sob o dono do SDK, e religar o runtime com o fluxo nativo
de `switchSession` (mesmo id, mesmo arquivo, mesmas entradas). Alternativas recusadas: entrada custom de cwd (clientes antigos
e `list` não leem), `process.chdir` (ferramentas e confiança ficam no cwd antigo), `forkFrom`/`newSession` (id novo),
reescrita ad hoc do cabeçalho (`_rewriteFile`, não transacional), mover o arquivo (quebra `parentSession` por caminho).

## API (patch `session-cwd`, aditiva)
- `SessionManager.prototype.setCwd(cwd)` → `tx { previous, backup?, undo(), finish() }`. Sessão em arquivo:
  lê os bytes do disco, valida a 1ª linha (JSON, `type:"session"`, `id` igual ao da memória), troca SÓ o `cwd` dessa linha
  e preserva byte a byte o restante (entradas, acréscimos de outros processos); grava temporário `wx` com o modo do original +
  fsync; cria backup por hardlink do inode antigo; confere inode/tamanho/mtime antes do `rename`; depois do `rename` anexa ao
  arquivo novo qualquer cauda que um escritor concorrente tenha gravado no inode antigo (nada perdido). Falha em qualquer
  passo: nada muda, temporários removidos. Sessão ainda sem arquivo: grava o arquivo (id e entradas da memória) com `wx`
  (colisão = recusa); `undo()` remove só o que criou. Arquivo corrompido/diferente da memória/sem hardlink: aborta antes de gravar.
- `ctx.switchSession(path, {piSessionCwd: {cwd}})`: `handleResumeSession` desvia para o runtime só quando a opção existe
  (sem ela o corpo nativo roda intacto). O runtime: pré-voo (diretório existe, é a sessão atual, vazamento de `--approve`),
  `setCwd`, `runtimeHost.switchSession(file, {projectTrustContextFactory})`. Retorno `{cancelled, piSessionCwd:{ok, cwd|reason, trusted}}`.
- `installCwdFinders(SessionManager)` (D11), chamado no fim de `core/session-manager.js` e do chunk do bundle: substitui `list/continueRecent/findById` só para a pasta padrão. `Info` ganha `policy:true` (D6').
- O patch publica `globalThis[Symbol.for('pi-harness.session-cwd')] = {version:1}`; sem ele `/cd` recusa explicando o patch.

## Aceite (observável; escrito antes do código)
- D1: `/cd <dir>` com sucesso → mesmo `sessionId`, mesmo arquivo, mesmas entradas (bytes após a linha 1 idênticos); `cwd` do
  runtime, ferramentas, `resourceLoader`, contexto (AGENTS.md etc.) e confiança vêm do novo diretório (runtime recriado).
- D2: cabeçalho em disco passa a ter o novo `cwd`: `SessionManager.open(file)`, `forkFrom`, `list(newCwd, dirDaSessao)`,
  `listAll` e `--session` refletem o novo cwd; o arquivo NÃO muda de pasta (referências `parentSession` por caminho seguem válidas).
  `findMostRecentSession` com cwd do novo diretório acha a sessão quando a pasta é a da sessão.
- D3: recusa/cancelamento/falha (diretório inexistente, não-diretório, sessão ocupada, `session_before_switch` cancelou,
  cabeçalho corrompido, colisão, patch ausente, `--approve` vazando) → cwd antigo, sessão e arquivo intactos e utilizáveis;
  erro no `createRuntime` → `undo()` do cabeçalho e religação no cwd antigo; só se a religação falhar vale o erro fatal nativo.
- D4: acréscimo concorrente (outro processo) durante a transação não se perde (cauda reanexada); arquivo alterado entre a leitura
  e o `rename` → aborta sem gravar.
- D5: permissões do arquivo preservadas; temporário/backup nunca sobram no sucesso; backup só fica se `undo` falhar (caminho mostrado).
- D6 (SUPERSEDED 2026-11-14 pela revisão D6'; texto antigo: "recusar o prompt → `/cd` conclui avisando não confiável"): ver D6'.
- D7: validação: caminho existe, diretório, `realpath` (symlink resolvido), `~`, relativo ao cwd da sessão, aspas e `\ ` (espaço
  escapado), unicode, controles/NUL recusados, diretórios de segredos (`~/.ssh`, `~/.aws`, agentDir…) recusados, igual ao atual → "já está".
- D8: completação de Tab: só subdiretórios, não recursiva, `readdir` limitado (`MAX_ENTRIES`), ocultos só com prefixo `.`, espaços
  reescritos como `\ `, `~/` e relativos preservados, sem seguir symlink fora do que o usuário digitou, falha → lista vazia.
- D9: sem modelo, rede nem Git; nenhum turno; restrições de comando/ferramenta/agente/contexto/SDK (guardas globais) inalteradas.
- D10: applier: pinado a 1.5.2, idempotente, pré-voo de TODOS os alvos (nativo + chunk do bundle) antes de gravar, âncora ausente
  ou duplicada = nada gravado (saída 2), `--revert` exato preservando outros patches.

- D6' (vigente): confiança pelo fluxo nativo (prompt só com recursos que exigem confiança e sem decisão salva; `trust.json` e
  herança nativos). Cwd novo com recursos que exigem confiança vira RECUSA, e a recusa reverte tudo (cabeçalho em disco, memória e
  runtime religado no cwd antigo, mesma sessão, bytes originais), quando: (a) o prompt nativo foi recusado/cancelado, (b) uma
  extensão `project_trust` respondeu não, (c) há decisão salva `false`, (d) `--approve/-a` ativo sem decisão salva ou com decisão
  salva `false` (o override nativo é global e não pode autorizar escopo novo). A distinção é pelo estado nativo observado ANTES
  (`trust.json`, `projectTrustOverride` do argv, `defaultProjectTrust`) e DEPOIS (`settingsManager.projectTrusted`), nunca por texto.
  POLÍTICA que desativa configs de projeto (`--no-approve/-na` ou `defaultProjectTrust: "never"`) NÃO é recusa: `/cd` conclui e
  informa "configs de projeto desativadas por política; não carregadas" (`trusted:false`, nada fingido); o `info` do callback `withSession` e o resultado final saem da mesma regra (`okInfo`) e ambos trazem `policy:true` (ver `cwd-policy-notice.md`). Sem recursos que exigem
  confiança: nenhum consentimento extra. Nunca confiança automática de escopo novo; nenhuma config de terceiros é carregada.
- D11: `pi -c`/`pi -r`/`--session <id>` num processo NOVO respeitam o `cwd` do CABEÇALHO, independente da pasta do arquivo:
  `SessionManager.list/continueRecent/findById` no diretório padrão (a) filtram pelo cwd do cabeçalho (o cwd antigo deixa de listar
  a sessão movida) e (b) completam com sessões de outras pastas de `~/.pi/agent/sessions` cujo cabeçalho casa o cwd pedido. Mesmo
  arquivo, mesmo id, `parentSession` por caminho intacto; nada é copiado, linkado ou espelhado. Varredura só do cabeçalho
  (`MAX_FINDER_FILES`), id repetido (cópia/colisão) conta uma vez (o arquivo mais recente), cabeçalho corrompido é ignorado.
  Varredura limitada e FAIL-CLOSED (fix-cwd-review F1/F2): arquivos, entradas, diretórios e prazo (`scanLimits`), sem seguir links
  simbólicos, sem `readdir` completo; estouro/erro de E/S/abort lança `SESSION_SCAN_INCOMPLETE` (nunca resultado parcial nem sessão nova);
  só `sessions/` inexistente = vazio. Diretório explícito (`--session-dir`) mantém o comportamento nativo. Clientes sem o patch retomam o cwd real do cabeçalho
  (o agrupamento por pasta nos seletores antigos é limitação documentada).
- D12: transação do cabeçalho: nunca sobrescreve acréscimo recente: tmp `wx`, backup por hardlink, checagem inode/tamanho/mtime
  antes do `rename`, cauda do inode antigo reanexada em `finish()` E em `undo()` (antes de reescrever); falha ao reanexar mantém o
  backup (recuperável) sem fingir sucesso. Baseline declarado: escritor com descritor aberto por mais tempo que a reconciliação
  final não é garantido (nenhuma promessa além disso). Cauda do backup lida por inteiro (leitura curta repete, EOF curto falha), limitada por `MAX_SESSION_BYTES`
  e validada (sem NUL, termina em `\n`, linhas JSON); inválida = falha com backup retido. Falha na reconciliação final de `/cd` vira
  erro fatal nativo nomeando o backup (F3/F4; `fix-cwd-review.md`). Colisão de nome de backup/tmp = recusa sem apagar o arquivo do outro.

## Testes (node:test; só tmp; sem rede/modelo/Git)
- `session-cwd/runtime.test.mjs`: `SessionManager` REAL do release instalado (cópia só leitura importada; arquivos em tmp):
  D1–D5 (bytes, id, modo, `open/forkFrom/list/findMostRecent`, corrompido, id divergente, mtime alterado, cauda concorrente,
  colisão, undo, falha de `switchSession` com recuperação, cancelamento, `--approve`).
- `session-cwd/apply.test.mjs`: D10 sobre cópias isoladas de `interactive-mode.js`, `core/session-manager.js` e do chunk (finders D11).
- `directory/test/*.test.ts`: D6–D8 e o contrato do comando (patch ausente, ocupado, mensagens).

## Gate (integrador, uma vez)
`node --experimental-strip-types --test extensions/claude-compat/directory/test/*.test.ts` e
`node --test claude-home/patches/pi-core/session-cwd/*.test.mjs`; estrutura (≤ 800 linhas, ≤ 7 arquivos de código por diretório).
Aplicar ao vivo (integrador): `node claude-home/patches/pi-core/session-cwd/apply.mjs <dist>`; E2E TUI sem LLM: `/cd` entre dois tmp.

## Rollback
`apply.mjs <dist> --revert` remove só os blocos `pi-session-cwd` e o runtime copiado (ou reinstalar o release limpo); sem o
patch `/cd` recusa explicitamente. Sessões já movidas continuam válidas (o cabeçalho é um campo nativo). Reverter um `/cd`
isolado: `/cd <cwd antigo>`. Backup de falha: `<sessão>.cwd-bak-<hex>` (hardlink do inode anterior) restaura com `mv`.

## Lacunas conhecidas (declaradas)
- (SUPERSEDED 2026-11-14: "`pi -c`/`pi -r` no cwd novo/antigo erram a sessão" foi resolvido por D11; não é mais lacuna.)
- Um escritor com descritor aberto por mais tempo que a reconciliação final não é coberto (D12); escritores nativos abrem/gravam/
  fecham por entrada. Seletores de clientes antigos agrupam por pasta do arquivo (o cwd real do cabeçalho vale ao retomar).
- Decisão salva `false` conta como recusa (D6'); desfazê-la exige editar a confiança nativa do pi, não o `/cd`.
