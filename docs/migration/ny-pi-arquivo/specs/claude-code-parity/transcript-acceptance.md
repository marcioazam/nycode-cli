# Aceite da transcrição (Ctrl+O)

Cobertura real em `test/acceptance/commands.sh`: rascunho `rascunho-ctrlo` igual antes/depois de abrir e fechar (q e Ctrl+O), teclas do modal (Down/PageDown/j/k/zzz) não vazam para o editor, cabeçalho `Transcrição ? ajuda · q fecha` ausente antes e presente só com o modal.
Diagnóstico: a falha observada em V9B não vinha de `transcript.ts`/`transcript-view.ts`, e sim do atalho de despejo do fixture (ver `commands-acceptance.md`). Nenhuma mudança de produção.

## Tecla de rascunho da fixture e frescor do NORMAL

- A fixture despeja o rascunho com Ctrl+Shift+Y (CSI-u `ESC[121;6u`). Ctrl+Shift+D é o debug global do TUI nativo (`onDebug`), consumido antes do despacho às extensões: era a causa observada de o atalho antigo não chegar. Regressão: `fixture-tests/draft-shortcut.test.ts` (TuiMainScreen real do SDK 1.5.2, terminal falso sem TTY) lê a tecla do registro real da fixture e prova que ela chega ao input sem acionar `onDebug`.
- `to_normal` (`commands.sh`) exige NORMAL ausente antes do Esc (evita positivo obsoleto de uma volta normal→insert anterior) e NORMAL presente depois. Isso PREVINE a ambiguidade ESC+Alt; que o Alt+0 em nível de byte do VIM fosse a causa foi inferido, não rastreado.
