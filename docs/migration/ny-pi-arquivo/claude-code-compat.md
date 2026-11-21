# Compatibilidade com comandos e atalhos do Claude Code

**Registro da primeira fatia, não conclusão da paridade integral.** O aceite limitado foi superado pelo pedido explícito de todos os comportamentos; contrato atual, fatias adicionais e bloqueios: [paridade integral](specs/claude-code-parity/work.md).

Registro de tarefa (SDD limitado). Fontes primárias: https://code.claude.com/docs/en/commands, `/interactive-mode`, `/keybindings`, acessadas em 2026-11-14 (relógio local). Proveniência: scouts (Perplexity + Keenable) leram as páginas; o lead verificou `commands` e `interactive-mode`; um segundo scout preencheu as seções puladas via HTML bruto; eu reli por `web_fetch` os trechos de vim, transcript, voz e contextos. A seção "teclas reservadas/sintaxe" do keybindings veio truncada em todas as leituras e os chords de painel `Ctrl+X Ctrl+=/-/_` e `Ctrl+X =/-` não têm fonte primária: **não verificados, não implementados**. Inventário de atalhos completo (vim, contextos, transcript): `docs/claude-code-keybindings.md`. Docs locais do pi 1.5.2: `slash-commands.md`, `keybindings.md`, `extensions.md`.

## Objetivo
Replicar no pi os comandos nativos e atalhos do Claude Code que têm equivalente local honesto (ex.: `/clear` e `/reset` = `/new`), documentar o resto como parcial/não suportado. Nada de comando falso, nenhum texto de slash enviado ao LLM.

## Aceite
1. `/clear [nome]` e `/reset [nome]` iniciam sessão nova via `ctx.newSession()` (sem turno de modelo; respeita hooks `session_before_switch`; cancelamento preserva a sessão e o nome anterior). Com `nome`, a sessão **anterior** é rotulada antes; se o switch for cancelado, o nome anterior é restaurado.
2. Comandos nativos do pi continuam; `/fork` do pi não muda (o `/fork` do Claude é cópia em background, outra semântica), `/share`, `/bug`, `/import`, `/export`, `/copy` mantêm a semântica do pi.
3. Aliases de comandos nativos/pi-code (`/config` `/theme` `/tui`→`/settings`, `/continue`→`/resume`, `/exit`→`/quit`, `/branch`→`/clone`, `/checkpoint` `/undo`→`/rewind`, `/bashes`→`/tasks`, `/cost` `/usage` `/stats` `/status`→`/session`, `/release-notes`→`/changelog`, `/reload-skills` `/reload-plugins`→`/reload` com aviso de que recarrega tudo, `/effort`→`/thinking`) são reescritos no submit do `UiEditor` só quando o primeiro token é exatamente o alias, nenhum comando registrado tem esse nome, e os argumentos são aceitos; argumentos sem equivalente recusam o comando com aviso (texto devolvido ao editor), sem rodar nada.
4. Atalhos: `keybindings.json` (Alt+P seletor de modelo, ciclo de modelo em `ctrl+shift+.`, Ctrl+_ desfazer, Alt+Enter nova linha, Alt+T) e `UiEditor` (Ctrl+P/N = ↑/↓ nativos: cursor e, no limite, histórico; Ctrl+L redesenha; Ctrl+T alterna a lista de tarefas; Ctrl+C ocupado interrompe). Nada remapeia Shift+Tab para bypass de permissões.
5. `/help` (ajuda de compatibilidade + comandos carregados + apontadores para `/` e `/hotkeys`), `/skills` (lista via `getCommands`, sem prompt ao LLM) e `/claude-help` são comandos reais; o `/hotkeys` nativo segue o painel de teclas (não lista os aliases do editor; `/claude-help` os lista).
6. Sem UI (RPC/print), `/clear` e `/reset` funcionam via `ctx.newSession` (sem rewrite); aliases por reescrita só existem no editor TUI e a matriz marca isso.

## Plano
- `extensions/claude-compat/`: `matrix.ts` (fonte da matriz de comandos), `aliases.ts` (mapeamento puro), `shortcuts.ts` (teclas), `index.ts` (/clear, /reset, /help, /skills, /claude-help), `test/`. Inventário de teclas exaustivo só em docs (`claude-code-keybindings.md`).
- `extensions/ui/editor.ts`: envolve `onSubmit` via propriedade acessora na instância, trata Ctrl+L e Ctrl+T.
- `~/.pi/agent/keybindings.json`: merge com backup (`keybindings.json.bak-claude-compat`).
- `publish.list`: entradas novas; symlinks em `~/.pi/agent/extensions/claude-compat/`.

## Decisões
- Não há API pública de dispatch de comando nativo; builtins rodam antes de `input`, então a única rota sem patch é o `onSubmit` do editor (verificado: `Editor` chama `this.onSubmit(result)`; o modo interativo atribui `onSubmit` depois do factory e o copia ao trocar de editor, logo o acessor na instância captura a atribuição).
- Ctrl+P deixa de ciclar modelo: o ciclo para frente vai para `ctrl+shift+.`, simétrico ao `ctrl+shift+,` já configurado; o UiEditor traduz Ctrl+P/N para ↑/↓ nativos (cursor e, no limite, histórico, como no Claude), sem usar `tui.editor.historyPrevious/Next`, que ignorariam o cursor. Ctrl+L deixa de abrir o seletor de modelo (agora Alt+P).
- Já existiam no pi instalado: envio imediato (`Ctrl+X Ctrl+S`, `Ctrl+Enter`, patch `pi-core/send-now`) e `Ctrl+B` para desanexar subagente em primeiro plano (fleet-ui); a matriz os marca exact/partial, não unsupported.
- Ctrl+T: `app.thinking.toggle` migra para `alt+t` (diferença: pi recolhe blocos de raciocínio; Claude liga/desliga o raciocínio); Ctrl+T no editor aciona o atalho do pi-code `ctrl+shift+t` (lista de tarefas).
- Shift+Tab fica como ciclo de raciocínio do pi. Modo de permissão do Claude não é replicado; plan mode do pi-code: `/plan` e `ctrl+shift+p`.

## Checkpoint
Concluído no escopo local; resultados finais e limitações globais em **Resultado final observado**. Os relatos de rodadas abaixo são históricos, não pendências atuais.
Rodadas 1 e 2 implementadas. Gate da rodada 2 (runner): 103/103 testes unitários, 2 typechecks, escopos de estrutura e 42 testes do send-now verdes; a TUI falhou: Ctrl+P esperava `/config` e veio `/skills`. **Causa raiz** (`interactive-mode.js`): os comandos nativos (`/settings`…) retornam antes de `editor.addToHistory` (≈ linha 2842); o alias reescrito `/config`→`/settings` nunca entrava no histórico, enquanto `/skills` (comando registrado) entrava. Os passos de sessão do script nunca rodaram. **Rodada 3 (TDD)**: regressão em `ui/test/editor.test.ts` (vermelha sem a correção: `actual: ''`, `expected: '/config'` e `'/exit'`), correção em `UiEditor.routeSubmit` (alias bem-sucedido é lembrado pela grafia original, depois do handler, e só se ele não rejeitar; recusas não entram), `status_after` no script TUI (prova que o gancho de alias segue ligado após `/clear` e `/reset`), `ui/test/index.test.ts` (montagem de `ui/index.ts`) e symlinks de teste em `~/.pi/agent/extensions/claude-compat/test/`. Gate final: runner.

### Diagnóstico do segundo aceite TUI
A regressão de histórico passou. O runner observou três IDs distintos e os rótulos corretos, mas o teste falhou porque `linha1` foi enviada antes de `/mark A`: a checagem visual antiga confundia transcript com editor. A entrada sintética `tmux M-Enter` não prova um evento Alt+Enter indivisível. Diagnóstico direto de `pi-tui/dist/keys.js`: `ESC CR` é Alt+Enter só no modo legado (Shift+Enter no modo Kitty); `CSI 13;3u` é Alt+Enter nos dois modos. O teste agora injeta CSI-u em uma chamada e exige **zero arquivos de sessão antes de `/mark`**, além de duas linhas visíveis. Não se relaxou a asserção dos três IDs/rótulos, nem se alterou código de produção para encobrir a falha. A divisão temporal dos bytes de `M-Enter` é hipótese, não fato confirmado. Uma reprodução com CSI-u ainda enviou `linha1` e recebeu erro 402 do provedor: `--offline` não bloqueia inferência. A causa determinística confirmada foi outra: o perfil isolado mantinha `app.message.followUp = alt+enter`, que precede a nova linha. A configuração pessoal já tinha Ctrl+Q e mascarava essa dependência. Regressão persistente `perfil é independente...`: RED com a colisão `alt+enter: tui.input.newLine × app.message.followUp`; correção inclui explicitamente Ctrl+Q no perfil. O fixture agora intercepta todo `input` não tratado, registra tentativa e retorna `handled`, impedindo chamadas ao modelo mesmo diante de regressões. O aceite exige ausência desse marcador. A validação final passou, conforme o resultado abaixo.

### Triagem do analisador "doces-ou-travessuras" (EXIT 1 mantido)
Primeiro scan: 94 achados; scan final: 123 (o trabalho concorrente continua alterando arquivos alheios). Em ambos, 8 no escopo desta tarefa, todos falsos positivos de "caso especial", confirmados por revisão manual do lead; nenhum teste foi pulado, enfraquecido ou apagado e nenhum limite de gate foi alterado:
- `extensions/claude-compat/aliases.ts:47,50,52` (`resolveAlias`): ramos `pass`/`refuse`/`rewrite` da união discriminada (protocolo público); nenhum depende de valor de teste.
- `extensions/claude-compat/index.ts:30,69` (`clearSession` e `skillsText`): estados reais do /clear (cancelado, falha) e lista de skills vazia.
- `extensions/ui/editor.ts:135,138,139` (`handleInput`, linhas no scan final): as teclas reais Ctrl+L/Ctrl+P/Ctrl+N e sua tradução para redraw/↑/↓. Não há detecção do ambiente de testes.
Os outros 115 achados do scan final estão fora do escopo (arquivos não tocados aqui) e ficam apenas relatados; não foram corrigidos nem usados para declarar o repositório inteiro verde.

## Evidência / verificação a rodar
```
node --experimental-strip-types --test extensions/claude-compat/test/*.test.ts extensions/ui/test/editor.test.ts extensions/ui/test/index.test.ts
bash claude-home/bin/doctor/pi-typecheck extensions/claude-compat     # e: ... extensions/ui
python3 claude-home/bin/structure/structure.py --project-root . --json
bash extensions/claude-compat/test/tui-acceptance.sh                  # tmux isolado, sem rede/LLM/git
# gate integrado com cobertura, sem excluir módulos: node --experimental-strip-types --experimental-test-coverage --test extensions/claude-compat/test/*.test.ts extensions/ui/test/*.test.ts
```
Cobertura de `editor.ts`: o teste copia o módulo para um diretório temporário (o Node não tira tipos dentro de `node_modules`), então o relatório de cobertura aponta para a cópia em `/tmp`, não para `extensions/ui/editor.ts`; para medir esse arquivo é preciso rodar o teste sobre o original ou mapear o caminho da cópia.

## Resultado final observado (2026-11-14)
Logs: `/tmp/pi-claude-compat-gate/verified-*`.
- TUI real: EXIT 0. `/help`, `/skills`, `/status`, `/effort`, `/config` (recusa de argumento e abertura), Ctrl+P/N, Alt+Enter sem submissão, Ctrl+L. Sessões distintas: A `01a1d8c4-02f2-75cb-8e11-566fdf840c63` (`s1`), B `01a1d8c4-3187-75cb-8e11-567091f6b237` (`prev-label`), C `01a1d8c4-3d68-75cb-8e11-5673585f8820` (sem nome). `/status` funciona após os dois resets. Nenhum marcador de submissão inesperada no fixture protegido.
- Suíte integrada com cobertura: **108/108**, EXIT 0, zero falhas/skips. Send-now: **42/42**, EXIT 0. Duas regressões de histórico RED→GREEN e regressão de colisão Alt+Enter RED→GREEN preservadas.
- Typechecks `claude-compat` e `ui`: EXIT 0. Estrutura dos dois escopos: EXIT 0, zero achados. `git diff --check`: EXIT 0.
- Cobertura por fonte: quatro módulos novos `claude-compat/*.ts` com 100% de linhas; cópia idêntica de `ui/editor.ts` 100%, montagem de `ui/index.ts` 100%. O bruto agregado Node é **72,86%**, contaminado por cópias adicionais idênticas em fixtures diferentes (ex.: segunda cópia de editor 35,25%); não foi apresentado como agregado aprovado nem excluído para forçar verde. `history.ts` tem 99,22% na suíte própria. Nenhum módulo de produção do escopo ficou sem medição.
- Perfil ativo: dez chaves originais preservadas; Ctrl+Q continua follow-up, Alt+Enter é nova linha. 120 entradas normalizadas de comandos, 17 aliases do editor, inventário contextual/Vim separado.
- Limitações dos gates globais: scanner raw EXIT 1 (8 falsos positivos locais triados acima; 115 fora do escopo); estrutura global EXIT 1 por `over-7-code-files:claude-home/patches/pi-code:8`, caminho não alterado nesta tarefa e surgido durante trabalho concorrente. Não há conformidade global declarada.
- Revisão manual realizada pelo lead. Revisores/runner adicionais ficaram indisponíveis por HTTP 429 da conta Anthropic; as verificações finais foram executadas diretamente, sem omiti-las. Nenhum eval pago, deploy, commit ou merge nesta tarefa. CI remoto não executado.
- Para aplicar à sessão já aberta: `/reload`; próximas sessões já descobrem os symlinks instalados. Sem nova aprendizagem para o vault além do que este registro e os testes já preservam.

## Custo e rollback
Custo: ~1 chamada de wrapper por submit (regex); a rodada 3 acrescenta uma entrada de histórico por alias bem-sucedido. Trabalho: 3 rodadas de worker; 103 testes unitários e 42 do send-now no gate; leituras web do doc custaram ~10 `web_fetch`. Rollback: remover `extensions/claude-compat/` (e os symlinks), reverter o bloco `claude-compat` do `editor.ts`, restaurar `~/.pi/agent/keybindings.json.bak-claude-compat`.

## Atualização de inventário (2026-11-14, SUPERA decisões antigas abaixo; NÃO VERIFICADA pelo gate integrado)
Estado por implementação, separado de verificação (o gate final está pendente; os números 120/44 acima valem só para a primeira fatia):
- Comandos: os 7 novos `claude-home/commands` (`run`, `verify`, `run-skill-generator`, `update-config`, `batch`, `team-onboarding`, `statusline`) são workflows de prompt só do usuário (kind S, partial), não comandos nativos nem sem-modelo. Comandos locais registrados por `commands/` (add-dir, advisor, heapdump, insights, recap, list-agents/peers, stop, loop, plugin…), interface (`focus`, `color`, `transcript`) e públicos (`mobile`/`ios`/`android`, `stickers`, `upgrade`) constam como partial: nenhum é `exact` sem prova de semântica. `/permissions` segue `unsupported` na matriz até o dono do comando decidir.
- Vim: seis módulos implementados, **não** verificados pelo gate. Modos de permissão `default`/`acceptEdits`/`plan`/`bypassPermissions` implementados, não verificados; AUTO indisponível (sem API). Shift+Tab delega ao controlador real; Meta+M (contexto de plataforma) segue lacuna.
- Ctrl+O agora abre o transcript; `app.tools.expand` foi realocado para Alt+O em `CLAUDE_KEYBINDINGS` e em `~/.pi/agent/keybindings.json`; `mergeKeybindings` mantém um valor personalizado do usuário. Alt+Enter segue nova linha e follow-up em Ctrl+Q.
- Instalação: `publish.list` inclui subdomínios commands/vim/services/permissions/interface/runbooks e testes, `hooks/permissions`, patches editor-actions/ui-controls/permission-control e os 7 `.md`; a lista de arquivos do ciclo de vida (restart/update/terminal-setup) será atualizada pelo lead.

## Matriz completa
(gerada de `extensions/claude-compat/matrix.ts`)

Inventário exaustivo de teclas (vim, contextos, transcript): [claude-code-keybindings.md](claude-code-keybindings.md). A tabela de atalhos abaixo é o resumo em runtime.

### Comandos

| Claude | Aliases | Tipo | Status | pi |
|---|---|---|---|---|
| /add-dir | – | B | partial | /add-dir registrado (commands/session/adddir.ts). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /advisor | – | B | partial | /advisor registrado (commands/agents/advisor.ts). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /agents | – | B | partial | /agents do pi-code (outro formato de agentes) |
| /artifact-capabilities | – | S | unsupported | sem artefatos |
| /artifact-diagramming | – | S | unsupported | sem artefatos; skill diagram-design cobre diagramas |
| /artifacts | – | B | unsupported | sem artefatos |
| /auto-mode-setup | – | B | unsupported | sem auto mode do Claude |
| /autocompact | – | B | partial | compact-at-400k.ts automático; /compact manual |
| /autofix-pr | – | B | unsupported | nuvem do Claude |
| /background | /bg | B | partial | /background e /bg (background/): condicional, só em sessão iniciada por `pi-session start` (tmux privado opt-in): desanexa o único cliente sem abortar; [prompt] é enfileirado uma vez como followUp literal. Fora do transporte, subagente ou sem UI recusa com instrução. Não cria sessão em background separada nem fork |
| /batch | – | S | partial | workflow de prompt do usuário (claude-home/commands/batch.md, só pelo usuário; não é função nativa nem usa modelo automaticamente). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /branch | – | B | partial | /branch → /clone (sem nome; com argumento recusa). NÃO é o /fork do Claude |
| /btw | – | B | exact | /btw (extensions/ui/btw.ts) |
| /bug | /share | B | unsupported | O /bug e /share do Claude enviam feedback/bug report; NÃO são o /bug (relatório aos devs do pi) nem o /share (upload da sessão) do pi, que mantêm a semântica do pi |
| /cd | – | B | partial | extensions/claude-compat/directory + patch pi-core session-cwd: muda o cwd da mesma sessão/arquivo; sem o patch recusa explicitamente; verificação integrada pendente (gate) |
| /chrome | – | B | unsupported | sem integração Claude in Chrome |
| /claude-api | – | S | unsupported | sem skill empacotada |
| /claude-in-chrome | – | S | unsupported | sem skill empacotada |
| /clear | /reset /new | B | exact | /clear e /reset: sessão nova como /new, sem turno de modelo (extensions/claude-compat); /clear <nome> rotula a sessão anterior; /new é nativo |
| /code-review | /review | S | partial | comando de usuário existente com prompt próprio, não a skill do Claude |
| /color | – | B | partial | /color registrado (interface/color.ts). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /compact | – | B | exact | /compact [instruções] nativo |
| /config | /settings | B | alias | /config e /settings → /settings (editor TUI). /config chave=valor recusado |
| /context | – | B | exact | /context do pi-code |
| /copy | – | B | partial | /copy nativo copia a última resposta; /copy N do Claude não existe (veja /copy-code) |
| /cost | /usage | B | alias | /cost → /session (tokens e custo da sessão) |
| /dataviz | – | S | unsupported | sem skill empacotada |
| /debug | – | S | partial | /debug nativo grava pi-debug.log (outra função) |
| /deep-research | – | W | unsupported | skill deep-search (pedido por /skill:deep-search) |
| /design | – | S | unsupported | sem skill empacotada; skills de design locais |
| /design consent | – | B | unsupported | subcomando de /design; sem design cloud |
| /design revoke | – | B | unsupported | subcomando de /design; sem design cloud |
| /design-login | – | B | unsupported | sem design cloud |
| /design-sync | – | S | unsupported | sem design cloud |
| /desktop | /app | B | unsupported | sem app desktop |
| /diff | – | B | exact | /diff (extensions/ui/diff.ts) |
| /doctor | /checkup | S | unsupported | sem /doctor; checks locais em claude-home/bin/checks |
| /effort | – | B | alias | /effort <nível> → /thinking <nível> (níveis do pi; níveis do Claude como auto/max são recusados pelo pi) |
| /exit | /quit | B | alias | /quit nativo; /exit → /quit |
| /export | – | B | partial | /export do pi gera HTML/JSONL da sessão; o do Claude grava texto simples |
| /fast | – | B | unsupported | sem modo rápido |
| /feedback | – | B | unsupported | sem canal de feedback; /bug do pi é relatório aos devs do pi |
| /fewer-permission-prompts | – | S | unsupported | sem skill; sem alteração de permissões |
| /focus | – | B | partial | /focus registrado (interface/focus.ts). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /fork | – | B | partial | O /fork do Claude cria cópia em BACKGROUND; o /fork do pi cria sessão a partir de mensagem anterior. Nenhum alias: use /fork do pi ou /branch |
| /goal | – | B | exact | /goal do pi-code |
| /heapdump | – | B | partial | /heapdump grava snapshot local com confirmação (commands/session/heapdump.ts). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /help | – | B | partial | /help (extensions/claude-compat): ajuda de compatibilidade, comandos carregados e /hotkeys; o painel nativo é /hotkeys |
| /hooks | – | B | exact | /hooks do pi-code |
| /ide | – | B | unsupported | sem integração de IDE |
| /import | – | B | partial | /import do pi lê sessão JSONL do pi, não de outros agentes; semântica mantida |
| /init | – | B | exact | /init do pi-code |
| /insights | – | B | partial | /insights: estatísticas locais da sessão atual, não o relatório do Claude. Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /install-github-app | – | B | unsupported | serviço do Claude |
| /install-slack-app | – | B | unsupported | serviço do Claude |
| /keybindings | – | B | exact | /keybindings (dev-commands) edita ~/.pi/agent/keybindings.json |
| /list-agents | /peers | B | partial | /list-agents e /peers listam agentes definidos e subagentes em execução. Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /login | – | B | partial | /login do pi (provedores do pi) |
| /logout | – | B | partial | /logout do pi |
| /loop | /proactive | S | partial | /loop registrado (commands/agents/loop.ts). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /mcp | – | B | exact | /mcp nativo |
| /memory | – | B | exact | /memory do pi-code |
| /mobile | /ios /android | B | partial | /mobile, /ios e /android mostram o QR/URL público do app (services/public.ts). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /model | – | B | exact | /model nativo; Alt+P abre o seletor |
| /output-style | – | B | exact | /output-style do pi-code |
| /passes | – | B | unsupported | serviço do Claude |
| /permissions | /allowed-tools | B | partial | modos locais Ask/Auto(acceptEdits)/Plan e bypass independente (bypass on/off) pelo controlador e guard.py; nenhum atalho desliga salvaguardas; verificação integrada pendente (gate) |
| /plan | – | B | exact | /plan do pi-code (ctrl+shift+p) |
| /plugin | – | B | partial | /plugin e /plugins listam/removem pacotes do pi (settings.packages), não plugins do Claude. Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /plugin-authoring | – | S | unsupported | sem skill empacotada |
| /powerup | – | B | unsupported | sem lições interativas |
| /pr-comments | – | R | removed | removido no Claude |
| /privacy-settings | – | B | unsupported | serviço do Claude |
| /radio | – | B | unsupported | sem rádio |
| /rate-limit-options | – | B | unsupported | sem limites de plano |
| /recap | – | B | partial | /recap: resumo determinístico dos últimos pedidos, sem modelo. Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /release-notes | – | B | alias | /release-notes → /changelog (changelog do pi, não do Claude Code) |
| /reload-plugins | – | B | alias | /reload-plugins → /reload (recarrega TODOS os recursos, não só plugins) |
| /reload-skills | – | B | alias | /reload-skills → /reload (recarrega TODOS os recursos, não só skills) |
| /remote-control | /rc | B | unsupported | sem controle remoto |
| /remote-env | – | B | unsupported | nuvem do Claude |
| /rename | – | B | exact | /rename (alias de /name) |
| /restart | /update | B | partial | /restart sob supervisor (claude-home/bin/lifecycle/supervisor.sh), mesma sessão; /update sem auto-update; verificação integrada pendente (gate) |
| /resume | /continue | B | exact | /resume nativo; /continue → /resume (sem argumentos) |
| /rewind | /checkpoint /undo | B | exact | /rewind do pi-code (checkpoints de código e conversa); /checkpoint e /undo → /rewind |
| /run | – | S | partial | workflow de prompt do usuário (claude-home/commands/run.md, só pelo usuário; não é função nativa nem usa modelo automaticamente). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /run-skill-generator | – | S | partial | workflow de prompt do usuário (claude-home/commands/run-skill-generator.md, só pelo usuário; não é função nativa nem usa modelo automaticamente). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /sandbox | – | B | unsupported | sem sandbox do Claude |
| /schedule | /routines | B | unsupported | nuvem do Claude |
| /scroll-speed | – | B | partial | /scroll-speed registrado (commands/settings/config.ts). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /security-review | – | B | partial | skill security-audit (pedido explícito) |
| /setup-bedrock | – | B | unsupported | provedores via /login e models.json |
| /setup-vertex | – | B | unsupported | provedores via /login e models.json |
| /simplify | – | S | partial | skill code-simplification (/skill:code-simplification) |
| /skill-doctor | – | S | unsupported | sem skill empacotada |
| /skills | – | B | partial | /skills (extensions/claude-compat) lista as skills carregadas; sem painel interativo |
| /slides | – | S | unsupported | sem skill empacotada |
| /stats | – | B | alias | /stats → /session (só a sessão atual) |
| /status | – | B | alias | /status → /session (sem conta/conectividade) |
| /statusline | – | S | partial | workflow de prompt do usuário (claude-home/commands/statusline.md, só pelo usuário; não é função nativa nem usa modelo automaticamente). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /stickers | – | B | partial | /stickers público (services/public.ts). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /stop | – | B | partial | /stop registrado (commands/agents/listing.ts). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /subtask | – | B | unsupported | sem subtask |
| /tasks | /bashes | B | exact | /tasks do pi-code; /bashes → /tasks |
| /team-onboarding | – | S | partial | workflow de prompt do usuário (claude-home/commands/team-onboarding.md, só pelo usuário; não é função nativa nem usa modelo automaticamente). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /teleport | /tp | B | unsupported | nuvem do Claude |
| /terminal-setup | – | B | partial | lifecycle/terminal-setup.ts grava configuração do terminal com backup .bak; verificação integrada pendente (gate) |
| /theme | – | B | alias | /theme → /settings (sem argumentos; sem seletor próprio) |
| /tui | – | B | alias | /tui → /settings (modo de tela; também --tui-mode) |
| /ultraplan | – | R | removed | removido no Claude |
| /ultrareview | – | B | unsupported | nuvem do Claude |
| /update-config | – | S | partial | workflow de prompt do usuário (claude-home/commands/update-config.md, só pelo usuário; não é função nativa nem usa modelo automaticamente). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /upgrade | – | B | partial | /upgrade abre a URL pública do plano (services/public.ts). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /usage-credits | – | B | unsupported | plano do Claude |
| /verify | – | S | partial | workflow de prompt do usuário (claude-home/commands/verify.md, só pelo usuário; não é função nativa nem usa modelo automaticamente). Implementado localmente; verificação integrada pendente (gate); semântica pode diferir do Claude. |
| /vim | – | R | removed | removido no Claude (virou configuração); /vim local: seis módulos implementados (extensions/claude-compat/vim), verificação integrada pendente; sem alegar paridade exata |
| /voice | – | B | unsupported | sem voz |
| /web-setup | – | B | unsupported | nuvem do Claude |
| /workflow-authoring | – | S | unsupported | sem skill empacotada |
| /workflows | – | B | unsupported | sem workflows do Claude |

### Atalhos

| Tecla | Claude | Status | pi |
|---|---|---|---|
| Ctrl+C | interrompe; sem tarefa, 1º limpa o prompt, 2º sai | partial | UiEditor: ocupado → interrompe; ocioso → nativo (limpa; 2º toque em <500 ms sai); seleção/cópia não testada com agente ocupado; o texto limpo volta pelo histórico ↑ |
| Ctrl+D | sai (2 toques em 800 ms; com texto apaga o caractere) | partial | sai de uma vez com o editor vazio; com texto apaga o caractere (nativo) |
| Ctrl+Z | suspende para o shell | exact | app.suspend (sem padrão no Windows nativo) |
| Ctrl+G / Ctrl+X Ctrl+E | editor externo | exact | Ctrl+G e Ctrl+X Ctrl+E acionam o editor externo nativo |
| Ctrl+L | redesenha a tela | exact | UiEditor força redesenho; o seletor de modelo saiu de Ctrl+L |
| Ctrl+O | transcrição detalhada | partial | abre o viewer de transcript do pi (interface/transcript.ts); sem verificação TUI integral e com semântica própria de rolagem/filtro; a expansão de ferramentas (app.tools.expand) foi para Alt+O |
| Ctrl+R | busca no histórico | exact | UiEditor: histórico de prompts |
| Ctrl+V | cola imagem (Alt+V no Windows/WSL) | exact | app.clipboard.pasteImage; Alt+V só existe como padrão no Windows/WSL |
| Ctrl+B | manda tarefas para background | partial | pi-code fleet-ui/panel.ts: desanexa subagente em primeiro plano; chamada Bash em primeiro plano não vai para background |
| Ctrl+T | alterna a lista de tarefas | alias | UiEditor reencaminha para ctrl+shift+t (pi-code todo); app.thinking.toggle foi para Alt+T |
| Ctrl+X Ctrl+K | para todos os subagentes em background (2 toques) | alias | duas vezes em até 3 s: cancela runs ativos pelo fleet da sessão, sem sinalizar PIDs diretamente |
| Ctrl+X Ctrl+S / Ctrl+Enter | envia agora | exact | send-now-runtime.mjs (patch pi-core/send-now): interrompe e envia o rascunho |
| Ctrl+X Enter | enfileira o prompt | alias | encaminha para o follow-up nativo Ctrl+Q |
| Ctrl+X B, Ctrl+X Ctrl+A, Ctrl+X Tab | base de diff, painel acima do prompt | unsupported | chords e painéis inexistentes |
| Ctrl+X =/-/_ (painéis) | não confirmado nas docs lidas | unsupported | não implementado |
| Ctrl+A / Ctrl+E / Ctrl+K / Ctrl+U / Ctrl+Y / Alt+Y / Alt+B / Alt+F / Alt+D | edição readline | exact | nativos do editor |
| Ctrl+W | apaga até o espaço anterior (um caminho inteiro) | partial | apaga a palavra anterior (tui.editor.deleteWordBackward) |
| Ctrl+_ / Ctrl+Shift+- | desfaz a última edição | exact | tui.editor.undo = ctrl+- e ctrl+_ (mesmo byte 0x1f em terminais legados) |
| Ctrl+P / Ctrl+N | cursor/histórico anterior e próximo | alias | UiEditor traduz para ↑/↓ nativos (cursor e, no limite, histórico); ciclo de modelo foi para ctrl+shift+. e ctrl+shift+, |
| Up / Down | histórico | exact | nativo |
| Alt+P | seletor de modelo | alias | app.model.select = alt+p (Ctrl+L deixou de abri-lo) |
| Alt+T | liga/desliga o raciocínio | partial | app.thinking.toggle recolhe/expande blocos de raciocínio; o nível muda com Alt+Shift+T ou /thinking |
| Alt+O | modo rápido | unsupported | sem modo rápido; no pi a tecla expande/recolhe saída de ferramentas (app.tools.expand, realocada de Ctrl+O) |
| Shift+Tab / Meta+M | alterna modo de permissão | partial | Shift+Tab delega ao controlador de permissões real (default/acceptEdits/plan/bypass; AUTO indisponível: sem API); implementado, ainda não verificado pelo gate integrado; Meta+M é fallback exclusivo do Windows sem entrada VT (não verificado nessa plataforma), não requisito deste host Linux; raciocínio: Alt+Shift+T |
| Esc | cancela | exact | app.interrupt |
| Esc Esc | rewind/resumo | partial | ação do duplo Esc do pi (settings); checkpoints de código: /rewind |
| Alt+Enter / Option+Enter / Shift+Enter / Ctrl+J | nova linha | exact | tui.input.newLine inclui alt+enter (o pi enfileirava follow-up; segue em ctrl+q) |
| \ + Enter | nova linha em qualquer terminal | alias | remove a barra final e insere nova linha no editor, sem submeter |
| Ctrl+S | guarda o rascunho | exact | UiEditor |
| ? (vazio) | painel de atalhos | alias | painel de atalhos da extensão comandos (teclas efetivas); sem ela cai no /hotkeys. Todos os atalhos e como mudar: /atalhos |
| / ! @ | comando, shell, arquivo | exact | nativos do pi (!cmd, !!cmd, @arquivo) |
| : (emoji) | atalho de emoji | unsupported | não existe |
| Cmd+K | limpa a tela | unsupported | depende do terminal; /clear inicia sessão nova |
| Space (voz) | push-to-talk | unsupported | sem voz |
| Modo vim (normal/insert, motions, text objects) | edição modal completa | partial | /vim: seis módulos em extensions/claude-compat/vim (modos, movimentos, operadores, visual, objetos, repetição) implementados; verificação pelo gate integrado pendente, sem alegar paridade exata |
| Teclas contextuais (Autocomplete, Confirm, Tabs, Transcript, Diff, ModelPicker, Footer…) | contextos do keybindings do Claude | partial | cada seletor do pi tem suas teclas (tui.select.*, app.tree.*); personalizar: /keybindings |
| keybindings.json do Claude (command:<nome>, chords) | arquivo próprio | unsupported | formato do pi: ids app.* / tui.*; sem chords |
