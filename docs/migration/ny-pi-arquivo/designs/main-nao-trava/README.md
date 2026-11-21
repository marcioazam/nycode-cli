# Sessão principal que não trava (2026-11-14)

Pedido do dono: "paralelizar o Main ao máximo com Todo, Subagents, Runs... para nunca nada travar a thread principal".
Sintoma: `bash` com `sleep 240; … python3 …` em primeiro plano prendeu o turno e a mensagem do dono ficou na fila.

## Objetivo e aceitação
- AC1: WHEN a sessão principal interativa chama `bash` com `sleep`s somando 30 s ou mais, ou com laço `while`/`until` contendo `sleep`, THE SYSTEM SHALL recusar a chamada e indicar `run start {command, await: true}`.
- AC2: WHEN a sessão principal interativa chama `bash` sem `timeout` THE SYSTEM SHALL aplicar 120 s; acima de 600 s SHALL recusar.
- AC3: WHEN a sessão principal interativa chama `run wait` THE SYSTEM SHALL limitar a espera a 30 s.
- AC4: WHEN a chamada vem de um subagente ou de `pi -p` THE SYSTEM SHALL manter 600 s / 1800 s, sem as recusas acima.

## Decisões
- O que já existia e continua: `run` (segundo plano com aviso de término), `subagent` em segundo plano por padrão na sessão interativa, `todo`.
- O que faltava era obrigar: um hook `tool_call` só bloqueia ou reescreve a chamada, não consegue mover um comando em andamento para segundo plano. Por isso a regra é recusar a espera antes de começar, na extensão que já era dona do tempo do `bash` (`extensions/bash-timeout/index.ts`); nenhuma extensão nova.
- Números: 120 s / 600 s são o padrão e o teto do Bash em primeiro plano do Claude Code; 30 s é o teto de espera inicial do `exec_command` do Codex.
- Rejeitado: mover o comando para segundo plano ao estourar o tempo (Claude Code faz; no pi exigiria patch no `bash` do core); entrega de mensagens no meio de uma tool (o `steer` do pi só entrega depois que as tools do turno terminam).
- Regra `rules-ref/research-and-tools.md` (Local execution): a linha "bash has no background mode … nohup" foi substituída pela de `run start {await: true}` (superada).

## Fontes (acesso 2026-11-14)
- Claude Code, tools-reference e env-vars (code.claude.com/docs/en/tools-reference, /env-vars): "`BASH_DEFAULT_TIMEOUT_MS` … (default: 120000, or 2 minutes)"; "`BASH_MAX_TIMEOUT_MS` … (default: 600000, or 10 minutes)"; "When a foreground command reaches its timeout without finishing, Claude Code moves it to the background instead of stopping it, unless the command starts with `sleep`."
- Claude Code, sub-agents: "With nothing configured, a subagent that Claude spawns from your main conversation starts in the background."
- Codex, `codex-rs/core/src/tools/handlers/shell_spec.rs` (github.com/openai/codex, main): "Wait before yielding output. Defaults to 10000 ms; effective range is 250-30000 ms."
- pi, extensions.md (github.com/earendil-works/pi, v0.74.1): "`event.input` is mutable"; "Return values from `tool_call` only control blocking"; `steer` "Delivered after the current assistant turn finishes executing its tool calls".
- Anthropic, multi-agent research system (2025-06-13): "the entire system can be blocked while waiting for a single subagent to finish searching".
- Limite de paralelizar: arXiv 2512.08296, planejamento sequencial piora 39–70% com vários agentes; por isso trabalho acoplado continua na sessão principal.
- Não verificado: o texto exato do prompt do Claude Code sobre `sleep`; se o Codex acorda sozinho ao fim de um comando em segundo plano. O `rules/personal.md` atribui os 39–70% a um "benchmark Martian"; a fonte primária achada é o arXiv acima, que não mede Claude Code.

## Custo e rollback
- Custo: uma regex por chamada de `bash`; nenhum byte a mais em instrução sempre carregada. Risco: um comando legítimo de mais de 120 s sem `timeout` na sessão principal é encerrado e precisa ser refeito com `timeout` (até 600 s) ou `run`.
- Rollback: `git checkout extensions/bash-timeout` e a linha da regra.

## Evidência
- `extensions/bash-timeout/index.test.ts`: vermelho antes (módulo sem os exports novos), 11/11 depois. Asserção antiga alterada: a recusa acima do teto cita `run start` em vez de `nohup`.
- Não verificado em sessão real: vale após `/reload`.
