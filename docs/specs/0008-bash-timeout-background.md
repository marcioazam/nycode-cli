# 0008: bash que estoura o tempo segue em segundo plano (O4, opt-in)

Estado: implementado atrás de `PI_BASH_TIMEOUT_BG=1` (desligado por padrão); medição contra o T1 ainda por fazer.

## Problema medido

O pi mata a árvore do processo no timeout e lança erro; o trabalho do comando se perde e o modelo costuma reexecutar o
mesmo comando. No Terminal-Bench houve 18 timeouts de bash em 8 tentativas. Kimi Code
(`bash_auto_background_on_timeout`), OpenCode 2.3, ZCode (`auto_on_timeout`) e Hermes convergem em deixar o comando
vivo e devolver um identificador.

## Comportamento

Com `PI_BASH_TIMEOUT_BG=1`, o hook `tool_call` de `extensions/bash-timeout` (ny-pi; no nycode absorvido em `packages/coding-agent/src/core/tools/bash.ts`, K8, F7) reescreve o comando do `bash`
(sem tocar no pi):

1. T = `decide(timeout)` (padrão 600 s, teto 1800 s, como no T1); `timeout` do pi passa a T + 60 s, folga para o pi
   não matar antes.
2. `wrapForBackground(command, T, id)` devolve um script POSIX sh: o comando roda em segundo plano com a saída (stdout
   e stderr) em `${TMPDIR:-/tmp}/pi-bg/<id>.log`; um vigia manda `USR1` ao shell após T s se o comando ainda vive.
3. Fim normal: o shell imprime o log inteiro e sai com o exit code original.
4. Estouro: o trap imprime os últimos 4000 bytes do log e `[bash-timeout] Still running after T s: left running in
   the background (pid P, log L). Do not start another copy. ...`, e sai com 0; o comando continua vivo.
   A mensagem sugere esperar com `while kill -0 P 2>/dev/null; do sleep 2; done`, que volta assim que o job
   acaba: no TB o ny-pi pedia 173 s de `sleep` fixo por sessão contra 41,5 s do Claude Code (mesmas tarefas).
5. Não embrulha comando vazio, terminado em `&` nem iniciado pela palavra `sleep`.

Sem a env o comportamento é o de antes, byte a byte; `TIMEOUT_HINT` segue valendo nesse caminho.

## Limites conhecidos

- Sem streaming: a saída só aparece ao fim (ou no estouro); durante a espera o modelo não vê progresso.
- Processos em segundo plano contam no limite total da tarefa e não são mortos pelo pi; ficam órfãos até acabarem.
- O pid é o do grupo `{ ... }` em segundo plano; matá-lo não mata netos (ex.: um `sleep` filho).
- Log em `/tmp` sem rotação nem limpeza; o `id` vem do `toolCallId` sanitizado.
- Comando que lê stdin recebe `/dev/null` (já era assim no pi).
- Testado com `sh`, `dash` e `bash`; outro shell não foi testado.

## Predição falsificável

Com a env ligada, as reexecuções do mesmo comando após timeout e as tentativas mortas com trabalho perdido caem; o
acerto fica ≥ o do T1 nas tarefas com timeout e o custo ≤ 1,05× o do T1, medido contra o T1 no mesmo lote. Se algum
critério falhar, a opção continua desligada.

## Testes

`extensions/bash-timeout/index.test.ts` (ny-pi; no nycode, teste ao lado do `bash.ts`, definido em F7): saída e exit code (0 e 3), heredoc e aspas, estouro (retorno em cerca de T s,
pid e log na mensagem, processo vivo e terminando depois), stderr, env desligada, hook (T + 60, `&`, `sleep`), nos
shells `sh`, `dash` e `bash` quando existem.
