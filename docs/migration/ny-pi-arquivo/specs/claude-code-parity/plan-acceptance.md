# Aceite TUI de permissões: plano nativo e status (2026-11-14)

Escopo: `extensions/claude-compat/test/acceptance/{fixture.ts,modes.sh,fixture-tests/}`. Sem mudança de código de produção.

## Asserção SUPERADA: "write fora das ferramentas ativas no plan real"
- Evidência nativa (pi-code 1.7.0 `extensions/plan-mode/index.ts`): `PLAN_MODE_TOOLS` (:38) **inclui** write/edit de propósito; o `tool_call`
  (:429+) restringe write/edit ao **arquivo do plano** via `isPlanModeToolAllowed`. A ausência de `write` em `getActiveTools()` nunca foi o contrato;
  a falha `write ativo no plan real` não indicava proteção quebrada. Asserções `toolNames` de plan removidas (ativas e "voltou ao sair").
- Substituta, mais forte (só `modes.sh real`): no plan nativo o provedor fixture emite `write` para arquivo **não-plano**
  (`plan-blocked-out.txt`, `FIXTURE-TAG:blocked`). Exige-se: 2 chamadas ao provedor no turno, ToolResult real `isError=true` (lido do contexto
  do provedor em `${PI_ACC_PROBE}.tools`: só toolName/id/isError), arquivo alvo e `tool-out.txt` intactos, nenhum prompt inesperado.
  O turno 1 (default) e o turno `two` (fora do plan) continuam exigindo `isError=false` e 2 chamadas por turno; contadores absolutos
  4 → 4+2 (o turno bloqueado só existe no `real`).
- O diálogo nativo "Plan mode - what next?" aparece ao fim do turno em plan; o teste o fecha com Esc (fica no plan). Responder
  "Execute the plan" dispara um turno nativo e restaura o modo anterior: caminho NÃO afirmado.
- Plan do modo `fixture` continua NÃO nativo: não afirma bloqueio de ferramenta.

## Bug do fixture na escolha do alvo
O plan-mode injeta mensagens de contexto com role `user`; olhar só a última mensagem user perdia a etiqueta e escrevia em `tool-out.txt`
(o bloqueio nativo ainda disparava, tornando o teste vacuamente verde). Agora usa o último prompt `FIXTURE-TAG:`.

## Status "auto indisponível"
`createPermissions` inclui o texto; o `grep` imediato podia ler tela antiga (notificação de mudança de modo). `wait_for 'auto indisponível'`
(frescor) no lugar do `grep` imediato; a asserção de disponibilidade foi mantida. Verde nos dois modos.

## RED/GREEN (nativo, tmux `-L` próprio, `-f /dev/null`, /tmp, CLAUDE_CONFIG_DIR vazio)
- RED anterior: `modes real` → `write not active`; `modes fixture` → grep imediato de "auto indisponível".
- Teste do helper (`fixture-tests/fixture-provider.test.ts`, 4 casos): 2 falham contra o fixture de HEAD, 4 passam agora.
- GREEN: `modes.sh real|fixture` passam pipeline, guard, Shift+Tab, plan, `/permissions` (inclusive status) e o turno bloqueado (real).

## /focus: corrida de tela antiga (resolvida; não era defeito do renderizador)
- Causa: o script lia a tela antes de `/focus on` terminar (tag `two` já visível, tag `one` talvez já fora da tela, grep imediato do resumo).
- `/probe` agora inclui `focus` (`isFocus()`) e `uiMode` (`mode()`) de `Symbol.for('pi-harness.ui-controls')`: só leitura; `null` = controlador/método ausente, `{error}` = getter lançou.
- `modes.sh`: após `/focus on` espera `probe focus=true` e só então `wait_for` (limitado) do resumo `N ferramentas`, do prompt `two`, de `one` ausente e de `fixture-done`; a asserção de settings intacto foi mantida.
- Precondições do foco (2026-11-14, restaura a asserção original): após os testes de permissão, `/clear` real (conversa lógica nova, mesmo app privado), janela tmux PRIVADA com 80 linhas, baseline de `calls` + 4 chamadas (um turno `one`, um `two`, 2 chamadas cada; nada truncado) e os dois prompts VISÍVEIS exigidos antes do foco. `/focus on`: `one` some, resumo e resposta final presentes. `/focus off`: `FIXTURE-TAG:one` volta (asserção original, `wait_for`; ausente = falha) e o `write` expandido também.
- Recibos: `modes.sh real` e `modes.sh fixture` rc=0 (tmux privado, /tmp, sem config de usuário). Persistência `viewMode` focus/default mantida.
- Não existe notificação "Modo foco ligado" nesta tela; a prova de ativação é o probe.

## Plan: Shift+Tab versus saída nativa (ações distintas, sem inconsistência)
- Shift+Tab (CICLO) a partir do plan vai ao próximo modo do ciclo: `default` (testado em `modes.sh`, mantido).
- Saída NATIVA do plan (diálogo "Execute the plan"/fim do plan-mode) restaura o modo anterior (acceptEdits). Caminho não afirmado em `modes.sh`. Política de produção inalterada.
