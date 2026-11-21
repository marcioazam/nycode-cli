# Transporte do teste de dispatch: payload em buffer antes do Popen (2026-11-14)

Origem: falha observada no gate A2, `test_missing_jq_reports_to_inbox_and_exits_zero`, `BrokenPipeError` em `parent.sendall`.

## Causa
`hook-dispatch.sh` (linha 12) sem `jq` registra no inbox e sai com 0 ANTES de ler o stdin. Em `DispatchBase.run_hook` o `child.close()` vinha antes do `sendall`; se o hook já tinha saído, o par do socket estava fechado e o `sendall` falhava. Sem bug de permissão ou de produção: era corrida do fixture.

## Correção (só teste)
`run_hook` põe o payload finito no socketpair ainda aberto (`parent.settimeout(20)`, `sendall`, `shutdown(SHUT_WR)`), só então faz `Popen(stdin=child)`, `child.close()` e `communicate`. O stdin do hook continua um socket Unix real (como o `pipe` do Node). Nenhuma exceção capturada, nenhuma asserção alterada, `hook-dispatch.sh` intocado. Fixtures têm poucos KB; um fixture enorme falharia por timeout explícito, não por deadlock.

## Regressão determinística
`test_missing_jq_exit_before_stdin_is_read` troca `subprocess.Popen` (via `mock.patch.object`, com o `Popen` real salvo) por um wrapper que faz `proc.wait(timeout=20)` antes de devolver, modelando a saída antecipada do hook. Mesmas asserções do teste de jq ausente (stdout vazio, rc 0, inbox exato). Sem sleep nem repetição.
- RED (código antigo): `BrokenPipeError` em `parent.sendall`.
- GREEN (após o fix): este teste + o teste original de jq ausente, 2/2 OK.

## Contrato de teste: repositório (2026-11-14)
Os dois testes de nota de repositório (`test_repo_note`, `test_session_start_repo_note`) criavam um repo com `git init` em tempdir. A restrição do usuário proíbe `git init`, então:
- Antigo: fixture temporário criado por `git init`.
- Novo: usam o checkout existente, `REPO = Path(__file__).resolve().parents[3]` (a raiz do harness; o `resolve()` segue o symlink do teste instalado). `DispatchBase.existing_repo()` afirma antes, só com leitura (`git --no-pager -C REPO rev-parse --is-inside-work-tree`, timeout 20, saída capturada), que é um work tree. Se não for, o teste FALHA (sem skip, sem repo falso, sem mock de git).
- A asserção positiva `repository context detected` ficou igual. O controle negativo já existia: `test_session_start_outside_repo` (cwd num tempdir, HOME isolado).
- Pré-requisito da suíte completa: rodar de um checkout git real (ambiente de dev), não de um export sem `.git`. O hook só lê o estado do repo. Não é afrouxamento do gate: restrição de permissão, mesma asserção.

## Verificação
- Suíte completa `python3 -m unittest test_dispatch`: 33/33 OK, sem nenhum `git init` no módulo (grep: 0).
- `lsp_diagnostics` do test_dispatch.py: sem diagnósticos.
- Histórico: antes disso, uma execução acidental do módulo antigo rodou os 2 testes com `git init` em tempdir (informado ao lead).
