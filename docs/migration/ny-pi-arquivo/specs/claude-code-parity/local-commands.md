# Comandos locais restantes — aceite (unidade `comandos-locais`)

Escopo: comandos da matriz que dependem só de dados/APIs locais. Código em `extensions/claude-compat/commands/**`. Testes sem rede, modelo, Git ou credenciais (transporte/agente injetado). Serviços de nuvem, artefatos, voz e cobrança ficam fora e não são simulados.

## Regras transversais
- C1: nenhum comando relaxa guardas, plan mode, `tool_call`, bypass ou isolamento; sob plan mode, comandos que iniciam trabalho de agente ou alteram ferramentas recusam.
- C2: configuração só em chaves de uma lista fechada e validada por chave, persistida pelo `SettingsManager` nativo do pi (lock de arquivo e merge só dos campos alterados; nenhum protocolo de escrita próprio). Chave fora da lista, valor inválido, `settings.json` corrompido (erro de carga em `drainErrors`) ou falha de escrita (`flush` + `drainErrors`) → erro explícito, nunca sucesso, arquivo intacto. Única chave sem setter nativo, `vimInsertModeRemaps`, grava dentro do mesmo `storage.withLock` nativo.
- C2b: aplicação ao vivo explícita: tema por `ui.setTheme`; `defaultThinkingLevel` também por `pi.setThinkingLevel`; demais chaves por `ctx.reload()` (que relê as settings) quando ocioso, ou aviso de `/reload` quando ocupado; `tuiMode` só vale no próximo início.
- C2c: contrato público `settings.json.vimInsertModeRemaps` (lido pelo Vim do editor): lista `["jj"]` ou objeto `{"jj":"<Esc>"}`; cada chave tem exatamente 2 caracteres imprimíveis sem espaço, destino só `<Esc>`, no máximo 8 pares, sem duplicata; gravado como objeto; `[]` remove a chave.
- C3: nada lê credenciais; saídas nunca imprimem valores de `auth.json`, `.env*`, tokens, `mcp-auth.json`.
- C4: comando registrado vence alias (`resolveAlias` inalterado em contrato `pass|rewrite|refuse`); aliases com argumentos reescrevem para comandos `claude-*` registrados.
- C5: skill-prompts são digitados só pelo usuário (comando de extensão → `sendUserMessage("/skill:<nome> <args>", {expandPromptTemplates:true})`), argumentos preservados, e só se a skill instalada existir; a mesma função nativa nunca é trocada por prompt.

## Comandos e aceite
| Comando | Comportamento real | Aceite principal |
|---|---|---|
| `/add-dir <dir>\|list\|remove <dir>` | lista persistida (`appendEntry`) e injetada no prompt (seção) | diretório inexistente/arquivo/segredo (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.pi/agent`) recusado; duplicata idempotente; restaura no `session_start` |
| `/advisor [provider/modelo\|off]` | ferramenta `advisor` (consulta outro modelo via `modelRegistry.complete`) ativada só com modelo definido | modelo desconhecido recusado; `off` desativa; `usage` da resposta vai no ToolResult, inclusive quando `stopReason` é `error`/`aborted`; pergunta > 20000 caracteres recusada sem envio; prazo de 120 s e cancelamento do chamador via `AbortSignal` |
| `/autocompact [on\|off]` | lê/grava `compaction.enabled` | argumento inválido recusado |
| `/stop [agents]` | `ctx.abort()` se ocupado; `agents` cancela subagentes via fleet | uso inválido recusado; fleet ausente informado |
| `/claude-branch <nome>` (de `/branch <nome>`) | `ctx.fork(folha,{position:'at'})` + nome na nova sessão | sem entradas → erro; ocupado → recusa; nome aplicado só em fork bem-sucedido |
| `/config chave=valor` (via `/claude-config`), `/theme nome`, `/tui regular\|fullscreen`, `/scroll-speed 1..100\|auto`, `/autocompact` | store com lista fechada | faixas e enum validados; tema inexistente recusado; `/tui` avisa que vale no próximo início |
| `/effort status\|auto\|low…max` | `setThinkingLevel`; `auto` = padrão configurado; inválido → erro com níveis | nível desconhecido recusado; clamp informado |
| `/permissions`, `/allowed-tools` | exibe modo (plan/bypass), ferramentas ativas; `tools on\|off <nome>` só entre ferramentas existentes e nunca sob plan mode | não há modo acceptEdits/auto/bypass; nome desconhecido recusado |
| `/claude-copy [N\|text\|blocks]` (de `/copy` com argumentos) | N-ésima resposta do assistente, texto, seletor de blocos | N fora da faixa recusado; sem UI com vários blocos → lista |
| `/doctor`, `/checkup` | verificações locais (node, settings/keybindings/mcp parse, skills, hooks) sem valores secretos | JSON inválido reportado; nenhum segredo na saída |
| `/skill-doctor` | lint das skills carregadas (frontmatter, nome, descrição, duplicadas) | skill sem descrição/nome divergente reportada |
| `/heapdump` | aviso de dados sensíveis + confirmação; `v8.writeHeapSnapshot` em diretório 0700, arquivo 0600 | sem UI/sem confirmação → nada gravado |
| `/insights`, `/recap` | estatísticas e resumo determinísticos da sessão (sem modelo) | sessão vazia tratada |
| `/list-agents`, `/peers` | agentes definidos + jobs/fleet existentes | fleet ausente informado |
| `/loop <intervalo> <prompt>`, `/loop stop` | timer limitado (mín. 60 s, máx. 20 iterações) que reenvia o prompt só quando ocioso | cancela em shutdown/`stop`; plan mode recusa |
| `/plugin [list\|remove <fonte>]`, `/plugins` | lista/remove `packages` de settings; `add` recusado com orientação (`pi install` + vetting) | nenhuma instalação |
| `/simplify`, `/security-review`, `/deep-research` | skills `code-simplification`, `security-audit`, `deep-search` | skill ausente → erro; argumentos preservados |

## Lacunas (API ou decisão ausente)
Registradas no handback: `/background`, `/bg`, `/subtask` (a única rota de fork existente é `context: fork` de SKILLS em `skills.ts`, via seam `runAgent`; comandos `.md` não têm fork e o seam chamado direto de um comando ignora `tool_call`/allowed-tools/plan mode: falta uma API de lançamento de fork para comandos de usuário que preserve essa política), `/focus` (removido: só existia alternância de saída de ferramentas; falta estado de viewer), `/cd` (sem API de troca de cwd da sessão), `/color` (sem API de cor do prompt fora do editor), `/restart` e `/update` (sem API de reinício/instalação sem rede), `/team-onboarding`, `/workflows`, `/workflow-authoring`, `/verify`, `/update-config`, `/run`, `/batch` (sem skill instalada de equivalência provada), `/statusline` (somente edição de `statusLine` em settings: decisão de contrato), `ctx.executeTool` ausente em `ExtensionCommandContext`, setter nativo para `vimInsertModeRemaps` (hoje `storage.withLock` nativo).
