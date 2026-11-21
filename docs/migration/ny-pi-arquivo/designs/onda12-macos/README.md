# Onda 12 · redesenho do pi no estilo macOS, minimalista

Status: primeira rodada decidida. A execução parcial e os testes pendentes estão em [PLANO.md](PLANO.md).

## Pedido

Revisar toda a interface do pi no terminal, pesquisar referências e redesenhar cada componente em até três variantes, num HTML com caixa de seleção por variante, campo de observação e um botão que junta as escolhas.

## Como usar

Abra `proposta.html` no navegador. Marque as variantes, escreva observações e clique em "Pegar as escolhas"; o texto gerado é o que o pi precisa para a execução. As escolhas ficam guardadas no navegador (localStorage, chave `onda12-escolhas`).

## Arquivos

- `proposta.html`, `proposta.css`, `app.js`: página, estilo e lógica (desenho dos mocks, seleção, exportação).
- `dados-1-base.js` a `dados-4-folhas.js`: os 46 componentes, com o desenho de hoje e as variantes.

## Método

- Inventário por leitura do código e dos testes (sem índice codegraph): `extensions/`, `claude-home/bin/hud`, `claude-home/patches` e o pi-code instalado. Os mocks marcados como aproximados (menu do core, painel de agentes, seletores) não vieram de saída capturada.
- As letras seguem uma linha: A refina o que existe, B é a leitura macOS, C é a mais silenciosa.
- Variantes que contrariam decisão de outra onda levam o aviso "Muda decisão em vigor".

## Fontes lidas

- Apple HIG: [Color](https://developer.apple.com/design/human-interface-guidelines/color), [Typography](https://developer.apple.com/design/human-interface-guidelines/typography), [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts), [Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators), [Writing](https://developer.apple.com/design/human-interface-guidelines/writing).
- [Primer, acessibilidade de CLI](https://primer.style/accessibility/foundations/cli-accessibility/) e [NO_COLOR](https://no-color.org/).
- [Crush, releases](https://github.com/charmbracelet/crush/releases): tempo decorrido por chamada, permissão perigosa mais difícil de aprovar por reflexo.
- [Claude Code, changelog](https://code.claude.com/docs/en/changelog) e [status line](https://code.claude.com/docs/en/statusline).
- [Ghostty, sobre](https://ghostty.org/docs/about) e [Nerd Fonts, faixas de glifos](https://github.com/ryanoasis/nerd-fonts/wiki/Glyph-Sets-and-Code-Points).

## Limites da pesquisa

- Os dois agentes de pesquisa gastaram o orçamento antes do fim. Não foram lidas páginas de Warp, Zed, Raycast, lazygit, Helix, btop, fzf, atuin, yazi, Ratatui e Textual; as menções a elas nos textos das variantes ("bloco do Warp", "estilo Spotlight") são conhecimento geral, não citação.
- opencode ("uma linha de atividade recolhível"), Codex e Gemini CLI vieram só de trechos de busca.
- A HIG não publica valores hexadecimais; a paleta "macOS escuro" é o `pi-escuro` já instalado e a "Grafite" deriva dele.
- Não há fonte primária que descreva um TUI "no estilo Apple": a tradução para célula de caractere é inferência de desenho.

## Verificação

Chrome headless 1400×900: 46 componentes, 179 mocks, nenhuma linha estourando a largura, nenhum erro no console. Testados "marcar tudo", observação, geração do texto e persistência após recarregar. Não testado em tela estreita nem com leitor de tela.

## Segunda rodada

Abra [rodada-2/index.html](rodada-2/index.html) para ver 31 mocks em 10 grupos de escolha e exemplos. As decisões desta página usam uma chave separada da proposta original. A seleção, as observações, a exportação e a persistência foram verificadas no Chrome em 1400 e 390 px. Um mock de terminal pode rolar horizontalmente em tela estreita sem alargar a página.
