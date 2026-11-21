# Faixa extensoes-nao-visuais (relatório bruto do subagente, 2026-11-19)

**Status: complete (leitura estática, sem build nem suíte).** Não li todos os arquivos do escopo. Não revisei por inteiro: `claude-compat/vim/` (só `engine.ts` até a linha 260, mais `host.ts` e `ops.ts` em trechos), `shortcuts`, `matrix`, `aliases`, `directory/`, `interface/` (só `transcript.ts`), `comandos/{atalhos,catalog,painel}`, `diagnostico/painel.ts` e `avisos/{painel,causa,turno}`. O repositório não tem índice codegraph, então usei só `rg` e leitura direta.

Reproduzi com `node --experimental-strip-types` os achados 1 e 6, e também o `Number("")`/`Number("abc")` do achado 2. Os outros vêm de leitura de código.

Antes de listar achados, descartei dois suspeitos:
- **`pi.events.on` sem unsubscribe:** o pi 1.5.2 rastreia e remove essas assinaturas em `invalidate` (`loader.js:152`).
- **`onTerminalInput` e `addAutocompleteProvider`:** o pi limpa ambos no reset da UI (`interactive-mode.js:2027-2034`).

### Achados

MÉDIA | bug | auto-resume/index.ts:149 e :183 | O contador `prior` volta atrás até a última resposta do assistente sem erro e ignora mensagens do usuário. Depois de 5 retomadas esgotadas, um prompt novo do usuário que falhe com 503 já cai em `give_up`, sem nenhuma tentativa. Reproduzido: `old` → `give_up`, `old+user+err` → `give_up`. O mesmo vale para o limite de conta (`LIMIT_WAITS`). | Parar o laço também em `message` com `role==='user'`.

MÉDIA | robustez | compact-at-400k.ts:38, :51, :119 | `PI_COMPACT_AT=""` dá 0 e valor não numérico dá NaN. `tokens < LIMIT` é falso nos dois casos, então compacta a cada `agent_settled`. O `session_start` também grava NaN em `LIMIT`. `PI_COMPACT_SUMMARY_MAX` inválido faz `prev.length <= NaN` ser falso e condensa sempre. | Validar com `Number.isFinite(n) && n > 0`, senão usar o padrão.

BAIXA | robustez | compact-at-400k.ts:120-124 | `running = true` vem antes do `new Promise`. Se `ctx.compact` lançar de forma síncrona (`runner.assertActive` com ctx obsoleto), a promessa rejeita e `running` fica `true` para sempre. Nunca mais compacta nessa sessão. | Envolver em try/finally que zera `running`.

MÉDIA | vazamento | syntax-check/index.ts:52-54 | `new ts.Parser()` e a árvore de `parse()` nunca recebem `.delete()`. O `.d.ts` diz "Delete … freeing its resources" para os dois. Cada edição/escrita em arquivo suportado vaza memória do heap wasm, até duas vezes quando o arquivo já tinha erro. Não medi o crescimento. | `try { … } finally { tree?.delete(); parser.delete() }`.

MÉDIA | robustez | claude-compat/vim/engine.ts:51 e :199 | `num()` aceita qualquer quantidade de dígitos e `leaveInsert` faz `repeatIns × capture.length` chamadas a `host.send`, sem o `guard(MAX_OPS)` que o `host.ts` aplica aos movimentos. `99999999i abc<Esc>` trava a UI. O replay do `.` (linha ~496) tem o mesmo problema. | Limitar a contagem (por exemplo 9999) ou passar o total por `guard`.

BAIXA | bug | plan-gate.ts:129 | `review.at >= lastEdit` aceita `complete` quando o `edit` e a chamada ao `plan-reviewer` vêm na mesma mensagem do assistente (chamadas paralelas, mesmo índice). A edição rodou durante a revisão e deveria invalidá-la. Reproduzido: `allow review_complete`. | Trocar por `>` (revisão estritamente depois da última edição).

BAIXA | vazamento | bash-clamp/index.ts:22-36 | `MAX_LOGS=50` vale para o diretório compartilhado `/tmp/pi-bash-clamp`, somando todas as sessões e subagentes. `prune` apaga os logs mais antigos de outras sessões vivas, e o `read` do caminho citado no rodapé passa a dar ENOENT. | Prune por idade (por exemplo > 24 h) ou por diretório por pid.

BAIXA | perf | auto-resume/index.ts:294 | `hudCache()` faz `readFileSync` + `JSON.parse` do `usage-cache.json` em todo `agent_before_settle`, inclusive quando a decisão é `none`. | Calcular `resetAt` só depois que `decideResume` indicar `resume` do tipo limit.

BAIXA | perf | diagnostico/registro.ts:116 (`lerCaixa`), chamado de diagnostico/index.ts em `tool_execution_end`, `turn_end` e `agent_settled` | Cada chamada relê o arquivo inteiro da caixa (`readFileSync`) para usar só `subarray(offset)`. A caixa cresce sem limite durante a sessão (entradas dos filhos, `relatados` zera a cada 500) e só é podada por idade (7 dias). | Ler só do `offset` com `openSync`/`readSync`, ou comparar `statSync().size` e sair sem ler.

BAIXA | perf | cache-prefix-probe/index.ts:17-18 | Em toda requisição, para o histórico inteiro, faz `JSON.stringify` + `JSON.parse` + `JSON.stringify` + sha1 por mensagem, de forma síncrona. Com 250k tokens são ~1 MB × 3 passadas. O `.jsonl` diário cresce sem teto (3,7 MB em `~/.cache/pi-cache-probe`). A extensão se declara temporária. | Remover a sonda (passo 6 do plano) ou calcular o hash só das mensagens novas.

BAIXA | robustez [SEG] | diagnostico/registro.ts:50 | `appendFileSync(diag.jsonl)` sem `mode`. O arquivo real está `-rw-rw-r--` e `~/.pi/agent/diag` é `drwxrwxr-x`, enquanto `traces.jsonl` usa `0o600` (`exportar.ts:107`). O log guarda mensagens e detalhes de erro (já redigidos) legíveis pelo grupo. | Passar `{ mode: 0o600 }` e criar o diretório com `0o700`.

BAIXA | robustez | no-context-files-covers-claude-md.ts:48 | `fs.readFileSync` sem try dentro do laço de agentes. Um `.md` ilegível ou symlink quebrado em `~/.claude/agents` ou `~/.pi/agent/agents` (o layout instalado usa symlinks por arquivo) lança na fábrica da extensão, e o filho `omitClaudeMd` não omite o CLAUDE.md. | Envolver a leitura em try/continue.

BAIXA | robustez | comandos/paleta.ts:37 (e `lerEstado`:18) | Leitura-modifica-escreve não atômica de `ui-state.json`, arquivo que o `editor.ts` também escreve. Com duas sessões, ou com leitura durante um `writeFileSync` truncado, `lerEstado` devolve `{}` e o gravar apaga as outras chaves. | Gravar via tmp + `renameSync`, como `avisos/config.ts:gravar` faz.

BAIXA | perf | comandos/index.ts:20 | O provider de autocomplete chama `lerRecentes()` (`readFileSync` + `JSON.parse` síncronos) a cada pedido de sugestão, ou seja, a cada tecla digitada depois do `/`. | Memoizar por `mtime` ou ler uma vez por abertura do menu.

BAIXA | robustez | diagnostico/doctor.ts:93 | `json(d,f)` lança em `settings.json` inválido. O `try` de `verificar` envolve o check `hooks` inteiro, então o segundo arquivo de `fontes` não é verificado. Vira um único achado genérico "verificação hooks falhou". | `try/catch` por arquivo dentro do laço.

BAIXA | robustez | bash-timeout/index.ts:44 | Em sessão principal, `SLEEP` casa `sleep N` mesmo com `&` no fim ou dentro de `( … ) &`. `(sleep 90 && cmd) &` é bloqueado, apesar de não prender o turno. | Ignorar `sleep` seguido de `&` em segundo plano, ou documentar a limitação.

BAIXA | plataforma | claude-compat/background/record.ts:43 | `procStat` lê `/proc/<pid>/stat`, só Linux. No macOS `birth()` devolve `undefined` e `/background` e `updateIdentity` falham sempre com "birth da raiz ilegível". O erro aparece como falha de sessão sem dizer que a causa é a plataforma. | Detectar `process.platform !== 'linux'` e dar mensagem específica, ou usar `ps -o lstart=`.

GAP-DE-TESTE | compact-at-400k.ts | Nenhum teste referencia `compact-at-400k`, `parseTokens` ou `condensePrevious`. Os achados 2 e 3 vivem nessa lacuna. | Teste de `parseTokens` (limites, vírgula, `k`/`m`), de `condensePrevious` (borda `max`) e de env inválido.

GAP-DE-TESTE | cache-prefix-probe, footer-no-stats, no-web-search | Não achei testes; só `rg` por nome. As duas últimas são triviais. A `diff` da sonda é pura e testável. | Cobrir `diff()` e o filtro de `HIDDEN` do footer.

### Notas
- `travar-modelos/index.ts:171`: o guard só bloqueia `bash`/`run` cujo input contenha a string literal `PI_MODEL_LOCK`. Contorno trivial (`PI_MODEL_L""OCK`, `env -u`, escrever script). Se a trava é uma garantia, ela é só dissuasão.
- `bash-clamp/index.ts:119`: `join(logDir(), `${toolCallId}.log`)` usa um id vindo do provedor. Se um provedor devolver `/` ou `..` no id, há path traversal. Hipótese: não verifiquei como o pi-ai normaliza ids. Sanitizar com `basename` ou `[\w-]`.
- `/tmp/pi-bash-clamp` fica em `/tmp` compartilhado (`mkdir` recursivo, 0700 só se o diretório ainda não existir). Um diretório pré-criado por outro usuário local não é revalidado.
- `pi-docs/index.ts`: `mode`, `weSet` e `text` são estado de módulo. O memo `text ??=` nunca é invalidado se o caminho dos docs mudar na mesma sessão, e `wantFull` lê `package.json` a cada prompt. Efeito pequeno.
- Lógica de blocos de código duplicada em `dev-commands/copy-code.ts` e `claude-compat/commands/session/copy.ts` (a segunda já comenta isso). Risco de divergência.
- `diagnostico/exportar.ts:116`: se `filtro` lançar, o span vai para a rede sem filtro (fail-open). Hoje o filtro é um destructure que não lança.
- `puxar.ts:18`: `SCRIPT` usa `os.homedir()/.pi/agent`, não `getAgentDir()`. Com `PI_CODING_AGENT_DIR` diferente, o `puxar.py` não é achado (o erro é notificado).
- `claude-compat/commands/agents/loop.ts`: `notify` e `idle` guardam o ctx do último `agent_settled`. Hoje `session_shutdown` zera `st`, então não vi falha. Frágil se o shutdown mudar de ordem.
