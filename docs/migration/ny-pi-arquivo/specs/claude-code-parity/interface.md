# interface: /focus, transcrição (Ctrl+O), /color e /cd (unidade `interface` de `work.md` §7)

Registro escrito ANTES do código. Escopo local: sem rede, modelo, credenciais ou Git. O editor (`ui/editor.ts`), índice,
aliases, matriz, atalhos, manifest, `bin/pi`, keybindings e arquivos de permissão ficam com o pai.

## 1. Arquitetura (menor desenho que satisfaz o contrato)
| Parte | Dono | Por quê |
|---|---|---|
| Filtro visual do foco e cor da barra do prompt | patch gerenciado `claude-home/patches/pi-core/ui-controls/` (pi 1.5.2) | só o core tem `chatContainer`, `editor` e `isBashMode`; extensões não têm getter/setter públicos |
| Comandos `/focus`, `/color`, transcrição | `extensions/claude-compat/interface/` | só usa a API pública (`registerCommand`, `registerShortcut`, `ctx.ui.custom`, `sessionManager`) |
| `viewMode` persistido | `commands/settings/store.ts` (`KEYS`) | mesmo lock de arquivo do `SettingsManager` nativo; sem escritor próprio |
| `/cd` | **não implementado** (§6) | lacuna de API do core |

Alternativas rejeitadas: alternar `toolOutputExpanded` (não é foco); modal que bloqueia o compositor (o usuário deve
continuar trabalhando/streaming na vista principal); apagar/substituir filhos de `chatContainer` ou mensagens (o filtro é
só VISUAL; contexto do provedor e dados da sessão nunca são tocados); expor o host a extensões.

## 2. Contrato do controlador global (estreito, validado)
`globalThis[Symbol.for('pi-harness.ui-controls')]` é definido pelo runtime do core (`ui-controls-runtime.mjs`) quando o
`InteractiveMode` chama `updateEditorBorderColor()` pela primeira vez. Objeto congelado, `apiVersion: 1`:
```
mode(): 'regular' | 'fullscreen'
setFocus(on: boolean): void          // lança TypeError se não for boolean
isFocus(): boolean
setPromptColor(name: string): void   // nome da lista fechada ou 'default'; outro valor lança TypeError
getPromptColor(): string             // nome atual ('default' sem override)
reset(): void                        // desliga foco, remove cor, restaura render/borderColor originais
```
Cores: `red blue green yellow purple orange pink cyan default`. Cada nome mapeia a uma constante SGR 256 fixa dentro do
runtime; nada vindo do usuário é interpolado em sequências de escape.

### Foco (`setFocus`)
- Embrulha, na instância, `chatContainer.render` (propriedade própria, restaurada ao descritor exato anterior ou
  removida). Os filhos reais, o pipeline de mensagens e `pendingMessagesContainer`/editor/diálogos não mudam.
- Classificação por estrutura (nomes de classe não sobrevivem ao bundle): usuário (`text` string + `markdownTransformers`),
  assistente (`lastMessage` + `hasToolCalls`), ferramenta (`toolName` + `toolCallId`), bash (`command` + `setComplete`),
  mensagem de extensão (`customRenderer` + `message`); entre elas, a notificação de subagente em segundo plano é a de
  `message.customType === 'subagent-background'`, formato real do pi-code (`Background subagent run <id> (<agente>) <estado>
  after <n> turns.`).
- Saída: o último prompt do usuário, UMA linha de resumo, a resposta final (último componente do assistente
  depois do prompt, também durante streaming) e, em ordem original, os componentes opacos do último turno (erros e avisos
  nativos; ver `focus-notices.md`). Resumo: `N ferramentas · edições +A −R · S subagentes · B notificações em
  segundo plano concluídas`, contado dos resultados reais (`result.details.diff`, `args.tasks/chain` de subagent).
  Só `estado = completed` conta como notificação concluída; `failed`/`cancelled`/formato desconhecido entram em
  `N erros`, junto com resultados de ferramenta com `isError`; qualquer outra mensagem de extensão (plan-gate, hooks,
  etc.) aparece como `N mensagens de extensão ocultas` (nada some em silêncio). Partes com zero somem; sem ferramentas nem notificações não há linha. Sem prompt do usuário: render nativo.
- Qualquer exceção no filtro restaura o render nativo, desliga o foco e mostra erro; o chat nunca fica quebrado.
- `setTuiMode('regular'|'fullscreen')` (validado) chama `host.switchTuiMode(mode)` do core (preserva árvore de componentes,
  editor e terminal); lança com o motivo se o core recusa (overlay aberto) ou não expõe o método. Ir a `regular` desliga o foco
  e o filtro só renderiza com `mode()==='fullscreen'`; voltar a fullscreen não religa o foco sozinho (sem estado oculto).
  `/claude-tui` grava `tuiMode` pelo `SettingsManager` e SÓ ENTÃO chama `setTuiMode`: sucesso = "aplicado agora"; recusa =
  aviso com o motivo real + "vale no próximo início"; sem controlador = só "próximo início". Nunca diz aplicado quando não foi.
- Só vale com `mode()==='fullscreen'`; em `regular`, `setFocus(true)` lança Error e `/focus` informa.

### Cor (`setPromptColor`)
- O `borderColor` do editor é o campo nativo da barra do prompt. O runtime troca a propriedade, na instância do editor
  atual e do `defaultEditor`, por accessor: leitura devolve a cor escolhida, exceto com `host.isBashMode` (efeito do bash
  preservado); escrita do core (`updateEditorBorderColor`, nível de raciocínio, troca de editor) continua guardada como
  valor nativo e volta com `default`/`reset`. A função da cor é marcada: o core copia `defaultEditor.borderColor` ao
  trocar de editor e essa cópia não vira valor nativo. O accessor é reaplicado a cada render do `editorContainer` (troca de
  editor por Vim/extensão, `/clear`, `/new`, reload). Não depende de uma instância fixa.

## 3. Comandos (extensão)
- `/focus` sem argumento: alterna e PERSISTE `viewMode` global (`focus`|`default`). `/focus on|off`: só sobrescreve a
  sessão atual (nada é gravado; caso do RemoteControl original); argumento fora disso é recusado com o uso. Não fullscreen →
  recusa explícita. Controlador ausente (core sem patch) → recusa explícita (`capacidade ausente`), sem simular.
- `session_start` (startup/reload/new/resume/fork): aplica `viewMode` das settings (inválido → default, sem erro fatal) e a
  última cor `claude-prompt-color` da sessão; sem entrada = `default`. `session_shutdown`: `reset()`.
- `/color [nome]`: sem argumento sorteia entre as cores (≠ atual quando possível); `default` restaura; nome inválido lista as
  válidas. Persiste na sessão por `pi.appendEntry('claude-prompt-color', { color })` (sobrevive a resume/fork, que copiam
  entradas); não toca settings.
- `viewMode`: chave de `KEYS` (enum `focus|default`), gravada no mesmo `storage.withLock('global')` do `SettingsManager`
  (padrão de `vimInsertModeRemaps`); valor inválido recusado sem gravar; `/claude-config viewMode=focus` recarrega e o
  `session_start` aplica.

## 4. Transcrição (`/transcript`, Ctrl+O)
- Visão rolável REAL em `ctx.ui.custom` (overlay), só leitura, sobre `sessionManager.getBranch()` da sessão ativa:
  prompts, texto, thinking, chamadas e resultados de ferramentas, bash, mensagens de extensão. O rascunho do editor não é
  tocado (o overlay não lê nem escreve o texto do editor).
- Modelo (`transcript-model.ts`): entradas → blocos `{kind, role, title, text}`; texto sem sequências de terminal
  (`stripTerminalSequences` + `replaceControlCharacters` do pi-tui), cada bloco limitado a 20 000 caracteres e a vista a
  5 000 blocos (truncamento anunciado); render com `wrapTextWithAnsi`, cache por largura, só as linhas visíveis.
- Teclas: ↑/↓/PgUp/PgDn/Home/End rolam; `?` ajuda; `{`/`}` prompt anterior/próximo; Ctrl+E alterna "mostrar tudo" (ferramentas
  e thinking em texto completo; padrão: resultados truncados em 12 linhas); `v` abre o texto completo no `$VISUAL`/`$EDITOR`
  por arquivo 0600 em diretório 0700, apagado depois, sem ler de volta e sem alterar a conversa (sem editor configurado:
  mensagem exata); `[` → capacidade ausente (o TUI não expõe despejo no scrollback nativo a extensões; nada simulado);
  `q`/Esc/Ctrl+C/Ctrl+O fecham.
- A vista é um INSTANTÂNEO de `getBranch()` no momento de abrir (não acompanha streaming); o topo traz o rótulo
  "instantâneo da conversa ao abrir…". Lacuna de paridade: sem atualização ao vivo (fechar e reabrir atualiza).
- Editor externo (`v`): como o nativo, `$VISUAL`/`$EDITOR` é dividido por espaços em branco, sem parser de aspas novo.
- Registro: `registerInterfaceCommands(pi)` registra `/transcript` e o atalho `ctrl+o` (sem alterar a configuração nativa
  de teclas); o pai libera `app.tools.expand`. Enquanto o nativo ocupar Ctrl+O o atalho de extensão pode ser
  sobreposto pelo core: o comando `/transcript` sempre funciona.

## 5. Instalação do patch
`node claude-home/patches/pi-core/ui-controls/apply.mjs <dist> [--revert]`: alvos `modes/interactive/interactive-mode.js` e
todo `bundle/chunks/*.js` com `updateEditorBorderColor() {`; versão 1.5.2; âncora única por arquivo (zero ou duplicata =
falha sem gravar nada, pré-voo de TODOS os alvos: versão 1.5.2, leitura, âncora, `node --check` do resultado e do runtime,
runtime destino regular; arquivo já "aplicado" só vale com exatamente 2 BEGIN/2 END, uma CHAMADA e um IMPORT exatos para
`ui-controls-runtime.mjs`, senão corrupção: recusa (apply e revert) sem gravar nem renovar o runtime); `node --check`; escrita atômica; idempotente. Blocos entre
`/*pi-ui-controls:begin*/`…`/*pi-ui-controls:end*/`; o import vai ao FIM do arquivo (não disputa o início com o import do
send-now); `--revert` remove só os blocos e `ui-controls-runtime.mjs`, preservando outros patches. Saída 2 em falha.
O wrapper `bin/pi` e o manifest ficam com o pai. Rollback: `--revert` ou reinstalar o release limpo; sem o patch, `/focus` e
`/color` recusam explicitamente e a transcrição continua funcionando.

## 6. `/cd`: lacuna de API (não registrado)
Observado no core 1.5.2: `AgentSessionRuntime.switchSession(path, {cwdOverride, projectTrustContextFactory})` aceita o
override, mas (1) `ctx.switchSession` das extensões não repassa `cwdOverride`; (2) `SessionManager.open(path, dir,
cwdOverride)` só muda o cwd em memória: o cabeçalho JSONL mantém o cwd antigo e não há entrada de sessão de cwd, logo
`/resume` volta ao diretório anterior (sem persistência); (3) `forkFrom(source, targetCwd)` muda o id. Persistir exigiria
reescrever o cabeçalho (proibido sem transação/recuperação) ou nova API do core (`SessionManager.setCwd` + entrada
persistida). `process.chdir` sozinho não atualiza ferramentas (cwd em cache) nem confiança. Nenhum `/cd` falso é
registrado.

## 7. Aceite e gate
Testes (node:test, adaptadores falsos + componentes reais do pi-tui; sem rede/modelo):
- `ui-controls/runtime.test.mjs`: filtro visual (prompt+resumo+resposta, contagens, streaming), filhos e contexto
  intactos, restauração, exceção, `regular`, validação, cor (bash, default, troca de editor, cópia do core, reset).
- `ui-controls/apply.test.mjs`: aplicar/duas vezes/reverter preservando outros patches, versão errada, âncora
  ausente/duplicada sem mutação, `node --check`.
- `interface/test/*.test.ts`: `/focus` (persistido × sessão, recusas), `/color` (sorteio, inválido, entrada, restauração),
  `viewMode` no store, modelo da transcrição (sanitização, limites), vista (teclas, rascunho, `v`, `[`).
Gate (pelo integrador, uma vez):
`node --experimental-strip-types --test extensions/claude-compat/interface/test/*.test.ts` e
`node --test claude-home/patches/pi-core/ui-controls/*.test.mjs`; estrutura (≤ 800 linhas, ≤ 7 arquivos de código por diretório).
E2E CLI isolado (sem LLM): depois do patch no release, TUI com fixture sem modelo: `/color red`, `/focus`, Ctrl+O.

## 8. Estado
Implementado e escrito (nenhum teste executado durante a autoria; só parse): runtime e applier `ui-controls`, módulo
`interface/` (`registerInterfaceCommands`, `/focus`, `/color`, `/transcript` + atalho `ctrl+o`), `viewMode` em `store.ts`,
testes dos três domínios. Os testes foram escritos depois do código (sem vermelho observado). Pendentes para o pai: aplicar
o patch no release pelo wrapper, importar `registerInterfaceCommands`, liberar `app.tools.expand` de Ctrl+O, TUI isolada,
gate. `/cd`: lacuna de API (§6), não registrado. Limites do foco: ~~componentes desconhecidos (erros, status) não aparecem na vista foco~~ (SUPERADO por `focus-notices.md`: opacos do último turno aparecem; contagem só de mensagens de extensão e erros de ferramenta/notificação); transcrição estática
(§4).
