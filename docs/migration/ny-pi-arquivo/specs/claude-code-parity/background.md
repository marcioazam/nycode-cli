# Sessão raiz destacável: delta aprovado

## Constituição e autoridade
Usuário aprovou **“Aprovar tmux privado”**, inicialmente opcional, sem alterar configurações pessoais nem o launcher padrão. A proposta é `docs/designs/pi-background-session.md`. Implementação autorizada, não deploy/Git. A mensagem mais recente proíbe Git init e hooks fictícios em qualquer lugar. Preservar trabalho concorrente.

**Emenda compatível:** o opt-in será `pi-session start [-- <argumentos do pi>]`, em vez de modificar `bin/pi` para reconhecer `PI_SESSION_TRANSPORT`. `pi` normal permanece idêntico. `pi-session attach <id>` reanexa; `pi-session list` lista apenas transportes próprios. O helper novo pode chamar o launcher existente, que mantém seu supervisor; não copiar lógica de restart. Nenhuma sessão já em execução é migrada.

## Problema, vocabulário e limites
- Transporte = tmux privado, PTY e cliente. Conversa = sessão nativa do Pi (ID/arquivo/histórico).
- Detach fecha o cliente, não o agente. Attach volta ao mesmo agente; não é resume/fork/replay.
- Hospedagem inicial Linux: tmux 3.6 já instalado e Python3/Node já existentes. Sem dependências novas.
- Não resolver nesta unidade Ctrl+B de jobs Bash, fork `/subtask`, workflows ou serviços Claude autenticados.
- Guard, permissão, billing e provider seguem pertencendo aos donos nativos. TTY não é sandbox contra o mesmo usuário do SO.

## Especificação (EARS)
B1. WHEN `pi-session start` for interativo THE SYSTEM SHALL criar somente seu servidor/socket/config tmux privado e executar o launcher Pi já existente dentro dele.
B2. WHEN um lançamento for headless (`-p`, RPC/modo/utilitário ou sem TTY, ou subagente) THE SYSTEM SHALL fazer passthrough ao launcher original, sem criar servidor ou registro. Reutilizar a classificação do supervisor existente.
B3. WHEN `/background` for recebido na raiz gerenciada, inclusive ocupada, THE SYSTEM SHALL desconectar só o único cliente daquela sessão, sem abort, fork, novo modelo ou sessão.
B4. WHEN `pi-session attach <id>` for usado THE SYSTEM SHALL reanexar sem `-d/-a/-P`, mantendo PID/ID/arquivo/entradas anteriores e permissões; resultados novos podem ser anexados.
B5. WHEN `/background <prompt>` for usado THE SYSTEM SHALL validar a capacidade antes de enfileirar uma única mensagem literal pelo API nativo (sem expansão de templates/comandos), então destacar; se o detach falhar após enfileirar, informar que já foi enfileirado, nunca repetir automaticamente.
B6. IF houver cliente múltiplo, ID inválido, registro incompatível, processo obsoleto, socket ausente, subagente ou sessão direta THEN THE SYSTEM SHALL recusar explicitamente sem agir em outra sessão. Falha nunca vira simulação/fork.
B7. WHEN o terminal/cliente cair THE SYSTEM SHALL deixar a sessão viva; ao sair normalmente o Pi, propagar seu código ao launcher anexado. Não propagar sinal de detach como abort do Pi.
B8. WHEN houver histórico/transporte THE SYSTEM SHALL limitar tela a 2.000 linhas sem truncar o arquivo nativo; metadados não contêm prompts, transcript, argv, ambiente ou credenciais.
B9. WHEN iniciar, anexar ou limpar THE SYSTEM SHALL validar ownership, modos e links, e limitar recursos; nunca acessar socket/servidor padrão ou remover conteúdo desconhecido.
B10. WHEN teclas/resize atravessarem cliente real (inclusive tmux aninhado) THE SYSTEM SHALL preservar controles legados e CSI-u; OSC52 só terá sink fictício nos testes.

## Arquitetura decidida
```text
terminal -> cliente tmux -> servidor/PTY privado -> bootstrap fino -> launcher Pi existente -> supervisor existente -> Pi
```
Tmux possui PTY, tela, reconexão e sinais; não escrever daemon/PT Y próprio ou RPC adicional. O bootstrap é apenas o dono do wait/exit code; o supervisor existente continua dono de restart. Custo adicional de processos e latência ainda não medido.

### Inicialização sem persistir argumentos
O helper resolve o wrapper COM supervisor, nunca o primeiro `pi` do PATH: override explícito `PI_SESSION_LAUNCHER` (instalação alternativa/fixture), depois `bin/pi` do checkout obtido por realpath do helper, depois `~/.local/bin/pi`; requer executável e marcadores `supervisor.sh`/`pi_run_supervised`, senão falha antes de criar tmux. Não executar o wrapper global nos testes. Resolver tmux antes do lançamento. ID aleatório hex32, diretório privado por transporte em `<agentDir>/session-transport/<id>`, socket próprio (`-S`, `-f /dev/null`).
1. Criar sessão com bootstrap e somente ID/diretório/caminho de código nos argumentos tmux, nunca argv do usuário.
2. Bootstrap espera canal nativo `wait-for`. Parent carrega JSON do argv por **stdin** em buffer tmux nomeado; sem `load-buffer -w` (não escreve clipboard). Sinaliza canal.
3. Bootstrap captura buffer em memória, remove-o imediatamente, valida limite e faz spawn do launcher com argv separado (não shell/eval). Não imprimir payload nem capturá-lo em log/arquivo. Não existe replay após handoff.
4. Bootstrap escreve metadados iniciais antes do spawn, espera o launcher e registra exit code antes de sair. Root Pi atualiza somente identidade durante `session_start`; bootstrap só volta a escrever após o launcher inteiro terminar. Escritas atômicas. Bootstrap usa handler SIGINT no-op (o grupo já recebe INT), sem matar o Pi por KeyboardInterrupt; TERM/HUP são encaminhados no máximo uma vez ao filho próprio, aguardando saída e registrando 128+sinal. Nunca sinalizar outro grupo/cliente.
Usar recurso nativo de buffer+wait do tmux em vez de socket/control daemon novo. Testar a ordem (sinal antes/depois do waiter), falha em cada estágio e ausência de payload no `pane_start_command`/arquivos. Payload limitado a 1MiB; handoff tem deadline10s; tmux de controle deadline3s. Antes de sinalizar ready, falha limpa recursos próprios; após ready, attach falhar NÃO mata nem repete o trabalho (imprimir ID para recuperação). Pane inicial usa dimensões do TTY pai, depois aceita resize normal.

### Controle e isolamento
- Extensão Node chama apenas comandos tmux fixos com argv separado, nunca prompt como argumento do shell. Marker único `PI_SESSION_TRANSPORT_ID` hex32 só no env do filho; derivar registro do agentDir, não confiar em TMUX/TMUX_PANE herdados. Para prompt opcional usar `sendUserMessage(args, {deliverAs:'followUp', expandPromptTemplates:false})`, inclusive quando ocupado; não alterar bytes dos args nem repetir em falha.
- Marker de transporte não basta: root PID = `PI_LIFECYCLE_ROOT_PID`, sem flag de subagente, UID/diretório/registro confiáveis, ascendência ao PID do pane e birth-time Linux `/proc/*/stat` válidos. Só ler metadados de processos, nunca seus argv/environ.
- Subagente herda marker mas não tem o PID raiz: recusa antes de qualquer controle. Sem simular tenant isolation como sandbox de mesmo UID.
- Detach consulta clientes do servidor/sessão exatos; exige exatamente um e usa o alvo retornado, sem detach amplo. Attach usa lock privado não bloqueante e verifica que não há cliente; nunca desanexa concorrentes.
- Opções somente no servidor privado: prefix e prefix2 None, status off, history-limit2000, exit-unattached off, exit-empty on; sem history-file/logs/pipes. Teclas estendidas segundo tmux3.6 (`extended-keys`/`extended-keys-format csi-u`); testar com cliente de verdade, não só `send-keys` diretamente no pane interno.
- Estado persiste somente em diretórios0700/arquivos0600 próprios, sem symlinks. Máximo128 registros, JSON16KiB e IDs hex32; excesso falha explicitamente. Cleanup de itens encerrados apenas por artefatos conhecidos, sem remoção recursiva de arquivos desconhecidos. Registro stale nunca reexecuta comando.
- Arquivo não é autoridade de liveness: conferir socket/pane, PID e birth-time. List é limitado e não mostra prompts/argv.

### Contrato compartilhado v1
`contract.json` fixa versão/limites/nomes nativos e campos do registro; vetores compartilhados ligam os dois consumidores. Sem interpretar dados como configuração executável.
Registro: `v,id,owner,tmuxSocket,paneId,panePid,paneStart,state,rootPid,rootStart,sessionId,sessionFile,exitCode`.
`state`: starting/running/ended; rootPid/rootStart/sessionId/sessionFile podem ser null durante startup; sessionFile pode continuar null se usuário pediu no-session. Só propriedades conhecidas. Root PID/birth são atualizados no restart, sem duplicar supervisor. Contexto de conversa pode mudar por /clear legítimo; detach sozinho não o muda.
CLI: `pi-session start [-- args...]`, `list`, `attach <hex32>`. Após cliente sair: registro ended válido => devolver exitCode; registro running E pane/PID/socket vivos E cliente rc0 => detach0; cliente nãozero, registro inválido/ilegível ou liveness inválida sem ended => erro nãozero, sem relançar. Filho encerrado por sinal normaliza a 128+sinal. Mensagem curta sem payload. Não criar stop/kill público nesta unidade.
Comando: `/background [prompt]`; fora do transporte, erro explica opt-in. Registrar alias `/bg` se a matriz já o declara. Não sequestrar `/fork` nativo.

## Plano / grafo de unidades
Contrato e este record primeiro; revisão fresca antes de código dependente.
- U1, backend CLI: `claude-home/bin/pi-session`, novo `claude-home/bin/session-transport/` (máx7 arquivos diretos), testes Python em subdir. Inclui contrato JSON, bootstrap/tmux, estado/ownership, passthrough, attach/exit/cleanup. Não editar bin/pi nem supervisor existente.
- U2, adaptador Pi: novo `extensions/claude-compat/background/`, seus testes, `index.ts`, `matrix.ts`, assertions de registro em `test/clear.test.ts`. Somente U2 toca esses consumidores. Depende do contrato U1; sem alterar fixture/lib de aceite existentes.
- U3, aceite público isolado: novos `test/acceptance/background.sh` e subdiretório de fixtures próprio (sem tocar fixture.ts/lib.sh existentes). CLI real, ferramentas FIFO, argumentos privados, attach sob PTY externo, falhas/teclas/permissões; depende U1+U2 para execução, pode escrever testes primeiro. Máx7 arquivos diretos em acceptance.
- Integração serial pelo coordenador: publicação do helper/módulos no manifesto sem sobrescrever links estrangeiros, docs de uso/matriz/rollbacks, ripple estático; só após writers congelarem executar gate afetado uma vez. Sem Git init/commit/push.
- Revisão direta de segurança/lifecycle no coordenador; revisão final de execução por plan-reviewer, reparos direcionados e nova revisão se incompleta.

## Validação e risco
TDD obrigatório: escrever teste antes da lógica; na verificação observar RED sem a implementação (cópias temporárias, não reverter trabalho alheio), depois GREEN. Testar argv literal com canários, metadado corrompido/symlink/UID/versão/limites, root vs subagente, clientes0/1/2, falha tmux, startup/exit/attach, crash/stale e sem kill de outro servidor.
E2E: modelo local puro, FIFO bloqueia ferramenta -> background ocupado -> liberar FIFO desanexado -> comprovar conclusão -> attach mesmoPID/ID/arquivo e prefixo do JSONL. Bare detach gera zero inferências novas; prompt opcional exatamente uma. Persistir safe/plan/bypass sem escalada, preservar recusa de write em plan. Headless/rpc/--version sem tmux. Resize e teclas atravessam cliente real; nenhuma preferência/clipboard real.
Medir ≥80% por novo arquivo executável Python/TS e os gates existentes. Shell entrypoint deve ser só exec/delegação; qualquer lógica exige teste. Nenhum skip por falta de capacidade. SDK instalado não deve ser alterado nesta unidade. Todos os testes usam HOME/config/agentDir temporários, env whitelist, launcher fixture com supervisor real e NativeCLI absoluto (não wrapper global que lê local.env).
Rollback: iniciar `pi` normal, sem mudar perfil; manter helper attach enquanto existir sessão viva. Nunca matar sessões na reversão. Ausência de tmux é erro no opt-in, não instalação automática.

## Checkpoint e evidência
- Desenho A aprovado pelo usuário; implementação não iniciada nesta gravação.
- Primárias locais: tmux3.6 `/usr/share/man/man1/tmux.1.gz`, render `/tmp/pi-background-tmux-man.txt` (extended-keys linhas1853+, buffers3471+, wait-for3537+). Conferir semântica de handoff e limites antes de depender dela.
- Supervisor existente inspecionado integralmente: guarda TTY/headless, root PID, restart-v2, stdinfd9; reutilizar, não copiar.
- Gate V9 permanece evidência da fatia anterior. O novo background ainda não possui teste ou cobertura; não incluído nos66 medidos.
- Probe local isolado `/usr/bin/tmux -S /tmp/pi-tmux-handoff-probe-*/tmux.sock -f /dev/null`: stdin buffer preservou JSON literal; wait-for -S ANTES do waiter foi consumido; buffer removido. Nenhum Pi/modelo executado. Man confirma multi-argv de new-session executado diretamente (linhas470+), load-buffer sem-w não escreve clipboard.
- Revisão fresca `contract-migration-reviewer`: sem bloqueio arquitetural; lacunas médias de resolução wrapper/sinal/exit e menores de marker/dimensões/delivery/limites foram resolvidas acima antes de código. A observação de ADR obsoleto era de leitura anterior à atualização concorrente; ADR já aprovado e emendado.
- Riscos abertos para testes: encoding cliente aninhado, custo de processos, liveness/cleanup em crash. Nenhuma aprovação global antes da evidência.
