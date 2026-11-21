# editor-actions: API semântica do Editor do pi 1.5.2 (patch gerenciado)

Unidade `vim` de `work.md` §7. Registro escrito ANTES do código; supera a decisão de simular Delete/setas/desfazer por
códigos de escape fixos.

## 1. Problema observado (Vim `host.ts`)
- Seta esquerda/direita, Delete e desfazer eram simulados enviando `\x1b[D`, `\x1b[C`, `\x1b[3~`, `\x1b[45;5u` ao
  `handleInput`. Um remap do usuário em `keybindings.json` (`tui.editor.cursorLeft`, `deleteCharForward`, `undo`)
  quebra o Vim: a sequência fixa deixa de casar.
- Edições Vim com marcadores de paste (`[paste #N …]`) fazem vários passos nativos (cada um empurra um snapshot):
  o `u` do Vim agrupa, mas o desfazer nativo (Ctrl+-) desfaz só um passo e deixa o texto intermediário.
- O Editor público não expõe ação semântica nem agrupamento; `state`, `pastes`, `undoStack` são `private`.

## 2. Alternativas
| Opção | Resultado |
|---|---|
| A. Códigos de escape fixos (atual) | depende do mapa de teclas; sem agrupamento. Rejeitada |
| B. Extensão lê/escreve campos privados (`as any`) | acopla ao layout interno e duplica a regra de colagem/undo. Rejeitada |
| C. Reimplementar texto/undo na extensão | segundo proprietário do estado. Rejeitada |
| **D. Dois métodos no próprio Editor, patch gerenciado e fixado** | o proprietário do texto, dos pastes e do undo continua sendo o Editor nativo. **Escolhida** |

## 3. Contrato (api-contract-design: aditivo, sem quebra)
```ts
runEditorAction(action: "left" | "right" | "deleteForward" | "undo"): void;
withUndoGroup<T>(edit: () => T): T;
```
### `runEditorAction`
- `left`→`moveCursor(0,-1)`, `right`→`moveCursor(0,1)`, `deleteForward`→`handleForwardDelete()`, `undo`→`undo()`:
  as mesmas funções nativas que o `handleInput` chama, **ignorando o mapa de teclas** (API semântica).
- Ação desconhecida (inclusive não string) lança `Error` antes de qualquer mutação. Não despacha ações de app/tool nem
  contorna guardas (autocomplete, `disableSubmit`, etc. não são tocados).
- `undo` dentro de `withUndoGroup` ativo lança `Error` sem mutar (desfazer destruiria o histórico anterior ao grupo).
  (O `undo` nativo por `handleInput` também é recusado: ver a guarda em `withUndoGroup`.)

### `withUndoGroup`
- Guarda de undo: no grupo mais externo, `undo` ganha um override próprio no instance (lança antes de mutar), restaurado no
  `finally` ao descritor exato anterior (ou `delete` se era herdado); cobre `handleInput` com tecla remapeada e
  `runEditorAction('undo')`. Sem segunda âncora nem mutação de protótipo. Substitui o "limite conhecido" acima.
- Síncrono. Antes do callback tira um snapshot completo (`state`, `pastes`, `pasteCounter`, via `structuredClone`).
- Aninhado: chamada interna só executa o callback; o agrupamento vale no mais externo.
- Ao terminar: remove com `UndoStack.pop()` os snapshots intermediários nativos (mantém todo o histórico anterior) e, se
  `lines`, `pastes` ou `pasteCounter` mudaram, empurra UM snapshot do estado pré-grupo (`UndoStack.push`, clone na
  entrada). Sem mudança líquida: nenhum passo novo. Depois zera `lastAction` (fronteira: a digitação seguinte não funde
  no grupo). Se o dono limpou o histórico no meio (`submit`), a pilha é deixada como está.
- Cursor e conteúdo dos pastes voltam no desfazer por serem parte do snapshot nativo, tanto no `u` do Vim quanto no
  desfazer nativo remapeado.
- Falha: o erro propaga; o conteúdo já modificado fica como UM grupo desfazível (é grupo de undo, **não** rollback).
- Callback `async` (construtor `AsyncFunction`) é rejeitado com `TypeError` antes de ser chamado; resultado thenable
  lança `TypeError` depois do agrupamento (também em grupo aninhado) (a edição síncrona já ocorreu e fica desfazível). Sem sucesso silencioso.
- Genérico só entre callback e retorno. Sem histórico novo além do `UndoStack` existente (um snapshot por grupo, pilha
  limitada como antes). Estado de profundidade: propriedade não declarada `__piUndoGroupDepth`, ausente do `.d.ts`.

## 4. Implementação
`claude-home/patches/pi-core/editor-actions/apply.mjs <dist do pi-coding-agent> [--revert]`, no padrão de
`scrollbar-imagem`/`send-now`:
- Alvos: `pi-tui/dist/components/editor.js`, **todo** `dist/bundle/chunks/*.js` com o Editor (`pushUndoSnapshot(`; o
  bundle da CLI carrega a própria classe, patch só no módulo seria falso) e `pi-tui/dist/components/editor.d.ts`.
- Âncora única por arquivo (método `pushUndoSnapshot` do Editor, tolerante a espaços; `insertTextAtCursor` no `.d.ts`);
  versão fixada 1.5.2; pré-voo de TODOS os alvos antes de gravar (zero ou duplicata → falha sem mutação);
  `node --check` do resultado; escrita via arquivo temporário + rename; idempotente por marcador.
- Bloco injetado entre `/*pi-editor-actions:begin*/` e `/*pi-editor-actions:end*/`. `--revert` remove SÓ esse bloco
  (byte a byte), sem restaurar bundles antigos nem desfazer outros patches. Saída 2 em falha.
- Instalação: o wrapper chama `node …/editor-actions/apply.mjs <core-dist>` (integração por `bin/pi`/manifest fica
  com o pai).

## 5. Rollback
`apply.mjs <dist> --revert` ou remover a chamada do wrapper e reinstalar o release limpo. O Vim volta a precisar de um
fallback (códigos fixos) se a API faltar; consumidores devem detectar `typeof editor.runEditorAction === "function"`.

## 6. Aceite e gate
Testes (`apply.test.mjs`, node:test, Editor real do pi-tui copiado, sem rede/modelo/Git): left/right/delete/undo
independentes de remap; um desfazer para exclusão+inserção com marcador de paste (restaura pastes e cursor); histórico
anterior preservado; aninhamento, sem mudança, falha; ação desconhecida sem mutação; callback async/thenable;
aplicar duas vezes e reverter preservando mudanças alheias; versão errada/âncora ausente/duplicada sem mutação.
TDD: testes escritos antes do código; vermelho esperado observado no gate final com o patch revertido. Gate:
`node --test claude-home/patches/pi-core/editor-actions/apply.test.mjs`, cobertura por arquivo ≥ 80% de `apply.mjs`
(`node --experimental-test-coverage`), estrutura (≤ 800 linhas, ≤ 7 arquivos por diretório).

### RED comportamental (seam `PI_EDITOR_ACTIONS_APPLY`)
O teste importa o applier de `PI_EDITOR_ACTIONS_APPLY` quando definido (cópia mutada em `mktemp -d`; ambos os métodos
continuam presentes, a falha é de comportamento). Em `claude-home/patches/pi-core/editor-actions/`:
- A, sem agrupamento (`withUndoGroup` só chama o callback):
  `sed "s#'const base=this.undoStack.length;#'return edit();const base=this.undoStack.length;#" apply.mjs > $T/a.mjs`
- B, guarda de undo desligada (observado: 1 falha, `Missing expected exception`; A: 8 falhas):
  `sed 's#value(){throw new Error("undo is unavailable inside withUndoGroup")}#value(){return Object.getPrototypeOf(this).undo.call(this)}#' apply.mjs > $T/b.mjs`
- Rodar: `PI_EDITOR_ACTIONS_APPLY=$T/a.mjs node --test apply.test.mjs`; o verde é a mesma linha sem a variável.
