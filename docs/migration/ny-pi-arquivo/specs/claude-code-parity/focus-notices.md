# focus-notices: erros e avisos nativos visíveis no /focus

Status: implementado em `claude-home/patches/pi-core/ui-controls/runtime.mjs` (`focusLines`). Supera o limite antigo de
`interface.md` §Foco ("componentes desconhecidos não aparecem").

## Defeito (verificado)
`showError`/`showWarning` do core 1.5.2 fazem `chatContainer.addChild(new Spacer(1))` + `addChild(new ThemedText(...))`.
`classify(ThemedText)` = `other`, e `focusLines` mostrava só último usuário + resumo + último assistente: o erro/aviso nativo
ficava invisível com foco depois do prompt (violava "falhas explícitas").

## Contrato
- Depois do último prompt, todo componente `other` que não seja Spacer (forma do pi-tui: `lines` numérico + `setLines`)
  é renderizado, em ordem original, junto da resposta escolhida; Spacers são omitidos (sem vãos em branco).
- Detecção por estrutura, sem nome de classe e sem chamar `.render` na classificação; `render` só na saída final.
- Ferramentas, bash, notificações e mensagens de extensão (`custom`) continuam agregadas no resumo (contagem de
  "mensagens de extensão ocultas" mantida).
- Exceção em qualquer render: o `try/catch` existente desliga o foco, restaura o render nativo e mostra erro.
- Filhos reais intactos (só `render` do container é filtrado).

## Testes
`runtime.test.mjs`: ThemedText/Spacer reais do SDK 1.5.2 (só teste), componente opaco sintético, `custom` contado,
limite do último prompt, ordem cronológica, identidade de `children`, nenhum render fora do último turno.
