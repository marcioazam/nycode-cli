# pi: clicar na imagem do chat abre a imagem (2026-11-13)

Pedido do usuário. Extensão `extensions/image-open/index.ts` (linkada em `~/.pi/agent/extensions/image-open/`).

- Define `Image.prototype.handleMouse` do pi-tui 1.5.2 (fullscreen: `dispatchMouseToLayout` chama `handleMouse`). Verificado nativamente que o `Image` importado pela extensão é o do bundle (teste em tmux: clique SGR na imagem do transcript chama o abridor; sem a extensão não chama).
- Só `click` esquerdo sem modificadores age (retorna `{handled:true}`); press, release, hover, arrasto, outros botões e wheel retornam `undefined` (seleção e rolagem intactas).
- Grava em `os.tmpdir()/pi-images-<uid>` (0700), arquivo 0600, nome = hash do conteúdo + extensão da mime (png/jpg/gif/webp); limite 50 MB; base64 inválido/vazio ou mime desconhecida não abre; diretório apagado no exit.
- Abre com `xdg-open` (`open` no darwin) via spawn detached, stdio ignore, unref; `PI_IMAGE_OPENER` troca o abridor. Falha vira `ctx.ui.notify` (warning), nunca derruba o TUI.
- Sem a imagem na tela (terminal sem protocolo de imagem) o `Image` renderiza a linha `[Image: ...]` e o clique nela também abre.
- Não coberto: imagem colada no editor (anexo do usuário) não foi investigada; não é este `Image` do chat a menos que o transcript a renderize como `Image`.
- Testes: `node --test extensions/image-open/image-open.test.ts` (3 unit + 1 nativo tmux, 0 requests).
- Reverter: apagar o diretório e o link.

## Fundo da tool atrás da imagem (2026-11-14)
- Pedido: a imagem do resultado não deve "flutuar" no fundo do terminal. O pi põe Spacer e Image fora do Box com fundo da tool.
- `extensions/image-open/fundo.ts` envolve `ToolExecutionComponent.prototype.render`: spacer, linhas da imagem e uma margem inferior recebem o fundo da tool (pendente/erro/sucesso) e o recuo do Box. Linha kitty (C=1): recuo, sequência, espaços; iTerm2 fica intacta. Sem tema ou com erro, devolve o render nativo.
- O tema vem de `globalThis[Symbol.for('@earendil-works/pi-coding-agent:theme')]` (o pi não exporta `theme`).
- Testes: `node --experimental-strip-types --test extensions/image-open/fundo.test.ts` (4) e smoke com o `ToolExecutionComponent` real do pi 1.5.2 (render 40 colunas). Ver no kitty real: não executado por mim.
