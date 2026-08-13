# ADR-0008: A TUI mantém o renderizador próprio sobre o scrollback, sem alt-screen

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-1, NFR-1, NFR-3

## Contexto

O crate `nycode-tui` existe, tem 594 linhas em `diff`, `terminal` e `width`, 28
testes e cobertura entre 99,3% e 100%. E não é referenciado por nenhum arquivo
`.rs` do workspace: FR-1 está pendente e o crate é uma dependência morta em
`crates/nycode-cli/Cargo.toml`. Ligá-lo ao binário exige decidir, antes, se ele
é a base certa.

Há duas famílias de TUI. Uma toma posse do viewport e o trata como buffer de
células, redesenhando tudo a cada quadro — é o que `ratatui` oferece e o que
Amp e opencode fazem. A outra escreve no scrollback como qualquer programa de
linha de comando, subindo o cursor apenas o necessário para redesenhar o que
mudou — é o que Claude Code, Codex e o `pi` fazem.

A escolha não é estética. Um agente de código é uma conversa linear, e o
scrollback nativo entrega rolagem, busca e cópia que o terminal já implementa e
que uma alt-screen precisa reimplementar pior. O autor do `pi` registra
exatamente esse raciocínio, e acrescenta o detalhe que evita flicker: envolver
cada atualização nas sequências de saída sincronizada `CSI ?2026h` e
`CSI ?2026l`, para que o terminal componha o quadro de uma vez.

A spec já corrige a premissa de que a TUI do `pi` teria ~600 linhas: são 16.716
no pacote, dos quais 586 são o renderizador diferencial. O renderizador é a
parte pequena e é justamente a que já existe aqui.

## Decisão

`nycode-tui` continua sendo a base, com o modelo de scrollback e redesenho
diferencial. `ratatui` não entra.

Três restrições:

- **Sem alt-screen.** A sessão termina e a conversa continua no scrollback, como
  a de qualquer programa de terminal.
- **Saída sincronizada obrigatória.** Toda atualização é envolvida em
  `CSI ?2026h`/`CSI ?2026l`. Sem isso o redesenho diferencial troca flicker de
  quadro inteiro por flicker de linha.
- **Os componentes novos — editor, cabeçalho, rodapé — seguem o contrato que
  `diff::Renderer` já impõe:** renderizar para `Vec<String>` a partir de uma
  largura. É o que mantém o piso de cobertura alcançável, porque testar vira
  comparar strings e não dirigir um terminal.

## Consequências

Positivas: rolagem, busca e cópia são do emulador de terminal e não custam
código; o trabalho já feito e coberto é aproveitado em vez de descartado; o
binário não ganha o peso de um framework de layout; e o alinhamento com a
referência reduz divergência que o NFR-6 teria de registrar.

Negativas: o modelo limita o que a interface pode ser — não há painéis lado a
lado nem layout absoluto, e nunca haverá enquanto esta decisão valer. Tudo o que
`ratatui` daria pronto passa a ser escrito aqui: editor multilinha, autocomplete
de caminho, rodapé. É a maior fatia de trabalho da Onda A, e a estimativa
honesta vem do tamanho do pacote equivalente no `pi`, não das 586 linhas do
renderizador. Terminais sem suporte a saída sincronizada vão apresentar flicker,
e a degradação precisa ser testada, não presumida.

Descartadas: **`ratatui`**, que é maduro e teria resolvido editor e layout,
rejeitado porque o modelo de alt-screen troca o scrollback nativo por uma
reimplementação inferior, e porque descartaria um crate pronto e coberto.
**Alt-screen com `nycode-tui` próprio**, rejeitado pelo mesmo motivo, sem sequer
o ganho de maturidade. **Manter a TUI fora de escopo e viver de `-p`**,
rejeitado porque o primeiro critério de aceite da spec exige rodar `nycode` num
repositório e completar uma tarefa real.

## Revisão

Reabrir se surgir requisito de interface que o modelo linear não comporte — uma
visualização de diff lado a lado seria o caso típico. A ação padrão nesse cenário
não é migrar tudo para `ratatui`, e sim abrir alt-screen apenas para a superfície
que precisa dela, voltando ao scrollback ao sair.
