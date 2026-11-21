# Pi: sessão completa em segundo plano (`/background`)

Status: **APROVADO como opt-in; implementação pendente**. Usuário selecionou “Aprovar tmux privado”, sem alterar configurações pessoais nem o launcher padrão. Contrato executável em `docs/specs/claude-code-parity/background.md`.
Emenda: o opt-in é o helper separado `pi-session start`, preservando `bin/pi`; a proposta de chave `PI_SESSION_TRANSPORT=direct|tmux` no launcher padrão fica **superada**. Os comandos ainda não estão disponíveis.

## Problema e escopo

Hoje o processo raiz do Pi roda direto no TTY do terminal (sem `TMUX`/`STY`; pai `pi`). Observado: o
`claude-home/bin/lifecycle/supervisor.sh` reinicia/vigia na mesma sessão, mas não oferece terminal
destacável; `fleet.detachForeground` (pi-code) só destaca subagentes. Esta proposta resolve **somente** o
transporte da sessão inteira (detach/attach do mesmo processo). Fora de escopo, unidades separadas e não
prometidas pelo tmux: Ctrl+B movendo jobs Bash, `/subtask` com fork de contexto, workflows dinâmicos,
integrações Claude autenticadas.

## Opções

| | A. tmux instalado (recomendada) | B. PTY/daemon próprio |
|---|---|---|
| Base | `/usr/bin/tmux` 3.6 (versão observada, sem auditoria de atualidade) | novo daemon que possui o PTY |
| Detach real | sim (man tmux(1), DESCRIPTION l.8-20) | sim, após implementar |
| Código novo | helper fino | FDs, sinais, reconexão, estado de tela, resize: risco alto |
| Isolamento | `-L <socket>` privado (man l.67-78) e `-f /dev/null` (l.52-60); testes TUI nativos já usam `-L privado -f /dev/null` | total, mas tudo é nosso |

Rejeitada: **stop+fork** (parar e reiniciar/forkar o agente) não é detach genuíno: muda PID/estado e
interrompe trabalho em curso.

## Desenho (opção A)

```
terminal real -> cliente tmux -> servidor/PTY privado -> bootstrap fino -> launcher/supervisor existentes -> mesmo processo Pi
```

- Opt-in explícito `pi-session start [-- args...]`; `pi` normal e seu launcher não mudam. Só lançamento
  **a frio e interativo** entra em tmux. Não migra o processo atual em TTY direto.
- Servidor tmux privado: socket `-L` próprio, `-f /dev/null` (nunca `~/.tmux.conf` nem servidores
  existentes), prefixo desativado e status off para não roubar teclas; proposta de histórico de tela de 2.000 linhas, sem limitar o histórico persistido da conversa.
- O supervisor existente roda **dentro** do PTY gerenciado; não é duplicado.
- `/background` fecha só **este** cliente dono (alvo exato do cliente dedicado). Sem abort, newSession ou
  troca de provider. Prompt opcional entra na fila normal como entrada literal do usuário, nunca shell.
- Não usar `attach -d`, `-a`, `-P` nem detach amplo (man tmux: attach-session l.517+, detach-client l.569+;
  podem desanexar outros clientes ou enviar SIGHUP). Vários clientes/ambíguo: recusar. Nunca desanexar
  clientes alheios; sem matar sessões arbitrárias.
- Attach: `pi-session attach <id>` (nome livre no PATH observado), sem sombrear comandos nativos. PID do agente, ID e arquivo ficam iguais; entradas anteriores e permissões (safe/plan/bypass) são preservadas. Novos resultados podem ser anexados normalmente; nenhuma elevação.
- `-p`, RPC, subagentes e utilitários: exec/passthrough nativo, sem tmux.
- Falta de capacidade (tmux ausente, socket inválido) com opt-in: erro explícito, sem detach/fork falso.

## Metadados e segurança

- JSON versionado e limitado, 0600 em diretório 0700: apenas ID, socket, PID, caminho da sessão, estado.
  Sem prompts, transcrições, credenciais ou segredos de argv. Ambiente do filho herdado só em memória,
  nunca serializado; sem logs persistentes de terminal/debug por padrão.
- TTY não é sandbox: mesmo usuário do SO; o guard existente continua dono da autorização.
- Não adiciona serviço em nuvem, reuso de token Claude ou sessão externa. O modelo já configurado continua seu trabalho normalmente.

## Custos e riscos operacionais (não medidos)

- Processos locais extras (servidor + cliente tmux + bootstrap de espera); memória/latência **não medidas**. Tmux já fornece o PTY: não há daemon de PTY/RPC próprio.
- Teclado/resize/clipboard em tmux aninhado: validar legado + CSI-u, redimensionamento e OSC 52 antes de
  tornar padrão.
- Crash/metadado obsoleto: validar PID+socket vivos antes de confiar; limpar só recursos próprios.
- Terminal desconectado: sessão segue viva e reanexável (efeito desejado).
- Rollback: iniciar `pi` normal em lançamentos futuros; **não** mata sessões existentes; caminho de attach
  permanece até o usuário encerrá-las. `local.env` real (contém segredos) não é tocado por este desenho.

## Aceitação (antes de mudar o padrão)

1. CLI real com provider local puro + ferramenta deferida/fifo: detach com sessão BUSY, liberar a ferramenta
   desanexado, provar conclusão.
2. Attach: mesmo PID/ID/arquivo; prefixo anterior do histórico idêntico byte a byte, permitindo novas entradas legítimas; sem replay de prompt nem inferência extra
   em detach simples; prompt opcional exatamente uma vez.
3. safe/plan/bypass preservados; controlador ausente, cliente ambíguo, tmux ausente e erros: mensagens
   explícitas.
4. Resize, teclas legado+CSI-u, tmux aninhado; OSC 52 com sink fictício (sem clipboard pessoal); `-p`/RPC sem transporte; limpeza só dos próprios recursos.
5. Testes, cobertura, LSP, gates de shell e TUI real verdes antes de qualquer padrão novo.

## Decisão e verificações pendentes

Opção A aprovada, inicialmente opt-in; nenhum novo padrão foi autorizado. A proposta fixa os nomes acima e 2.000 linhas de tela; teclado, falhas, isolamento e recuperação exigem verificação antes de concluir a implementação.
