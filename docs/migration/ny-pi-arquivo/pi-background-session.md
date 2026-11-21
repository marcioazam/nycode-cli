# Sessão em segundo plano do Pi (`pi-session`)

Estado: **implementação e verificação PENDENTES** até a main atualizar este registro; nada aqui é prova de execução. Spec: `docs/specs/claude-code-parity/background.md` e `background-acceptance.md`.

## Uso (opt-in privado)
- Início opcional: `pi-session start -- [args do pi]`. Sem ele, o `pi` normal não muda.
- Dentro da sessão: `/background [prompt literal opcional]` desanexa o cliente e deixa o Pi vivo.
- `pi-session list` mostra as sessões; `pi-session attach <id>` reanexa ao mesmo Pi.
- Largada a frio obrigatória: só uma sessão iniciada por `pi-session start` entra no transporte; um Pi já em execução não é promovido.
- Memória e sessão preservadas: mesmo PID, sessionId e arquivo de sessão em detach/attach. Sem argumento, o controle não cria inferência; o prompt opcional é enfileirado uma única vez, literalmente.
- `/restart` na raiz muda o PID legitimamente (o supervisor relança o Pi e o registro acompanha a nova raiz, mesmo ID/sessão/arquivo); detach/attach nunca mudam o PID.

## Limites
- Sem ponte de autenticação com Claude. O Pi recebe seu ambiente normal; o transporte não grava esse ambiente no registro.
- Capacidades privadas: tmux próprio por sessão (diretório 0700, registro 0600), sem opções globais. `set-clipboard on` vale só nele, para o OSC52 atravessar o cliente.
- Recusa direta: subagentes e ambientes sem o marker do transporte recusam `/background` antes de qualquer controle.
- Bypass: elegível-desligado não escala; bypass ativo (via `/permissions`) sobrevive a detach/attach.

## Reversão
Voltar ao `pi` normal nos próximos inícios. Mantenha o helper disponível enquanto houver sessões vivas, para reanexar com `pi-session attach <id>`; depois, o link `~/.local/bin/pi-session` pode ser removido. A reversão não mata sessões.

## Disponibilidade
O link `$HOME/.local/bin/pi-session` consta em `publish.list`, mas ainda NÃO foi criado; sem verificação, não há afirmação de disponibilidade global no PATH.
