# Alias de comando × autocomplete do editor

Estado: implementado. Teste: `extensions/ui/test/alias/autocomplete.test.ts` (Editor e `CombinedAutocompleteProvider` reais do SDK 1.5.2).

## Defeito

Na TUI, `/config` + Enter executava a lista inline `claude-config` em vez de `/settings` (idem `/theme`, `/tui`).
Causa: com o menu de comandos aberto, o Enter do Editor nativo aplica a sugestão selecionada (índice 0 = melhor fuzzy,
`claude-config`) e só então chama `onSubmit`; `UiEditor.routeSubmit` já via `/claude-config`, comando real, e nada
mais resolvia. Só `claude-config` está registrado (não `config`), então `config` nunca era sugestão exata.

## Contrato

- `UiEditor.setAutocompleteProvider` embrulha o provedor: para `/<nome>` sem argumentos, se `resolveAlias` devolve
  `rewrite` (alias válido, sem comando registrado de mesmo nome) e o menu não tem o nome exato, o alias entra como
  PRIMEIRA sugestão (`alias de /<destino>`). O Enter o aceita (`/config `) e `routeSubmit` roteia a `/settings`.
- Comando registrado com o nome exato vence (`hasCommand`); nenhuma sugestão é injetada.
- Com argumentos (`/config x`) o menu de comandos já está fechado: segue `claude-config x`.
- Escolha deliberada (↓ até `claude-config`) é respeitada; completação comum e `force` (Tab) ficam nativos.
- O histórico mantém a grafia original do alias (sem mudança).

## Fronteiras cobertas (todos os aliases)

- `/exit` sem sugestão nativa correspondente: um Enter → `/quit`.
- `/status` com `statusline` registrado: → `/session` (o workflow não rouba o prefixo).
- `/continue <arg>`: recusa; nada é submetido, o rascunho exato volta ao editor e há aviso `warning`.
- `/copy` nu com `copy` e `claude-copy` registrados: segue nativo (`/copy`).
