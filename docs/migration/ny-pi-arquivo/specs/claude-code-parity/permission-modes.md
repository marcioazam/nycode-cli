# Modos locais de permissão (default, acceptEdits, plan, bypassPermissions)

> **Superado em parte (dono, 2026-11-15):** `bypass-orthogonal.md` torna o bypass um interruptor independente do modo (Ask=default, Auto=acceptEdits, Plan) e `auto` alias de `acceptEdits`. Valem lá: §2 (última linha), §3 linhas `plan`/`bypassPermissions`, §4 ciclo, largada, contrato do wrapper, `/bypass off` e restauração do plano.

Estado: implementado, **gate completo ainda não executado** (ver §9). Fonte oficial lida: `https://code.claude.com/docs/en/permission-modes.md`
(cópia `/tmp/pi-claude-parity-assets/permission-modes.md`). Decisão do usuário (2026-11-14): implementar **todos** os modos locais.

## 1. Superação
O contrato anterior "Shift+Tab só manual/plan" (`work.md`, fatia de teclado) está **SUPERADO** por este. `auto` **não** é
implementado: a doc oficial exige o classificador do provedor (modelo e serviço próprios), indisponível neste transporte; nenhum modelo de risco
local é inventado e nenhum shell desconhecido é aprovado automaticamente. `/permissions auto` e `select('auto')` falham com essa explicação.
`dontAsk` também não existe aqui (valor desconhecido).

## 2. Contrato (aceite observável)
- **Autorização só no hook** `claude-home/hooks/guard.py` (PreToolUse). Não existe novo `tool_call` checker. O controlador só escolhe o modo.
- `PI_PERMISSION_MODE` ausente/vazio → resultados **idênticos ao guard anterior, bit a bit** (inclui `PI_BYPASS_PERMISSIONS`).
- Definido: `default|manual`, `acceptEdits`, `plan`, `bypassPermissions`. Qualquer outro valor (inclui `auto`) → `default` (falha fechado).
- Todo **DENY legado vem antes de qualquer aprovação**, em todos os modos (rm recursivo+force, `curl|sh`, `rm -r ~`, leitura de segredos…).
- Erro interno do código de modos (import, bug) → `ask`, nunca allow; o ramo sem modo não executa esse código.
- `bypassPermissions` só libera ASKs quando `PI_BYPASS_PERMISSIONS` é verdadeiro (sinal do controlador); sem ele o guard age como `default`.
  Com um modo definido, `PI_BYPASS_PERMISSIONS=1` sozinho **não** libera `default`/`acceptEdits`/`plan` (o modo vence).

## 3. Efeito por modo no guard
| Modo | Read | Write/Edit/MultiEdit | Bash |
|---|---|---|---|
| (sem modo) | legado | legado | legado |
| `default` | legado (deny de segredos) | **ask** sempre | permite só leitura comprovada; resto **ask** |
| `acceptEdits` | legado | allow se o caminho (léxico **e** realpath) está em cwd/projeto, não é protegido e o legado não pediu ask; senão ask (inclui `/tmp`) | leitura comprovada, ou **um** comando de filesystem comprovado em escopo; resto ask |
| `plan` | legado | legado **sem bypass** (restrição de escrita/plan file é do pi-code; sem deny em bloco) | legado sem bypass (isSafeCommand do pi-code) |
| `bypassPermissions` | legado | ASKs viram allow (deny continua) | idem |

Leitura comprovada (`permissions/shell.py`): só `ls cat head tail wc pwd echo date whoami uname id stat file du df which true false basename dirname
realpath readlink sort uniq cut tr diff cmp grep egrep fgrep rg tree nl find` (**`git` não consta: todo git é ask**, porque a config do repositório — `core.fsmonitor`, `textconv`, hooks — executa comandos)
(sem opções globais), com cadeias `; && || |` entre eles; opções que executam/gravam (`find -exec/-delete/-fprint*`, `sort -o`, `rg --pre/-z`,
`sort/wc/du --files0-from`, `file -f`, `tree -o/-R`, `uniq in out`…; opções GNU abreviadas (`sort --out=`, `--comp`, `date --se`), grupos curtos (`sort -ro f`, `-ofile`, `-T/tmp`) e valores colados a opção curta (`grep -f.env`) também contam) e qualquer argumento (inclusive `--opt=valor` e globs expandidos, limite 200) que seja um caminho de leitura
negada (`.env`, `~/.ssh`…) tornam o comando não comprovado → **ask**.

Filesystem em `acceptEdits` (um único comando, sem `; && | &`): `mkdir -p -v`, `touch` (só caminhos simples), `rmdir -v`, `rm -r -R -v -f`, `mv`, `cp` (só dois operandos arquivo regular, ver abaixo), e `sed`
com `-n -E -r -i[SUFIXO] -e` e script único `s<delim>…<delim>…<delim>[gIip0-9]` (sem `\`, sem flags `e`/`w`). Todos os operandos: sem glob, em escopo,
não protegidos (`.git`, `.claude`, `.pi`, `.vscode`, `.npmrc`, rc de shell…; lista da doc oficial), `rm/rmdir/mv` também não críticos (raiz, filhos da raiz,
home, escopo e ancestrais), `cp` sem fonte de leitura negada. `cp`/`mv`: exatamente dois operandos, origem arquivo regular não-symlink, destino inexistente ou arquivo regular não-symlink (**nunca diretório**: o destino final `dir/base` poderia ser symlink para fora; `cp` com destino `nlink>1` → ask), pai existente, sem `-r/-R/-a/-t/-T/-l/-s/--backup`; diretórios, vários operandos e flags complexas → ask. `rm -r` só se o operando não passa por symlink (léxico = real), existe, e a árvore sob ele (sem seguir symlinks, até 5000 entradas) não contém caminho protegido; erro de leitura em qualquer subdiretório (`os.walk` com `onerror`), raiz inexistente ou árvore grande → ask. `rm -rf` continua **deny**; o ask legado `rm -r` só é dispensado quando o comando inteiro foi verificado.
Qualquer `$ \` < > ( ) { } ! \\`, quebra de linha, aspas desbalanceadas, prefixo `VAR=`/`env`/`timeout`/`sudo`, caminho com `~usuario`, `-t`, globs em mutação, pipelines
com mutação ou `sed` complicado → **ask**. Symlinks: `link/../x` é resolvido como o kernel (realpath antes de `..`); fuga de escopo por symlink → ask.

## 4. Controlador (UI/TS) — `extensions/claude-compat/permissions/`
- Slot global `Symbol.for('pi-harness.permission-modes')`, validado em tempo de execução. API: `current(): PermissionMode`, `cycle(): ModeResult`,
  `select(mode: string, opts?: {explicit?: boolean}): ModeResult`, `status()`. `ModeResult = {ok:true,mode} | {ok:false,error}`. O controlador notifica sucesso e erro pela UI
  (status `permission-mode`: `⏵⏵ accept edits on`, `⚠ bypass ligado`; Manual limpa). Helper: `cyclePermissionMode()` (`permissions/slot.ts`) nunca lança e devolve `undefined` sem controlador.
  O UiEditor chama `cyclePermissionMode()`; só quando devolve `undefined` usa o fallback manual/plan atual.
- Ciclo: `default → acceptEdits → plan → bypassPermissions (só se disponível) → default`. Disponível = `PI_BYPASS_ELIGIBLE` verdadeiro **ou** opt-in deliberado (`explicit`).
- Estado dono de `PI_PERMISSION_MODE` e `PI_BYPASS_PERMISSIONS` (bypass `1` somente no modo bypass; `0` nos demais, inclusive durante o plano). Filhos herdam o ambiente.
- Largada: modo vem de `PI_PERMISSION_MODE` válido; **ausente, vazio ou só espaços** = legado (bypass só se `PI_BYPASS_PERMISSIONS=1` **e** disponível; `PI_BYPASS_PERMISSIONS=1` sozinho conta como elegível quando `PI_BYPASS_ELIGIBLE` não existe, `ELIGIBLE=0` vence); valor **não vazio inválido** (`auto`, lixo) → `default` falhando fechado, qualquer que seja o bypass; `plan` nunca vem do ambiente; bypass sem disponibilidade → `default`
  (`--safe` vence sessão antiga). `PI_BYPASS_ELIGIBLE` é imutável para o controlador. Opt-in deliberado grava `PI_BYPASS_OPTIN=1` para os filhos (subagentes sem UI).
- **Contrato do wrapper (`bin/pi`, do lead)**: `--safe` → `PI_BYPASS_ELIGIBLE=0 PI_BYPASS_PERMISSIONS=0 PI_PERMISSION_MODE=default`; `--bypass` → `PI_BYPASS_ELIGIBLE=1 PI_BYPASS_PERMISSIONS=1 PI_PERMISSION_MODE=bypassPermissions`;
  padrões de partida honram a elegibilidade herdada para filhos. O controlador não lê `local.env`.
- Plan: o estado real é do pi-code. `plan` exige o controle semântico `Symbol.for('pi-code.plan-controller')` (patch §5); ausente ou recusado → erro explícito, **nada muda**.
  Entrar no plano guarda o modo anterior; sair (por `select`, por aprovação do plano ou pelo toggle nativo, via evento `pi-code:plan-mode`/consulta) **restaura** o anterior, nunca liga bypass. Troca interna não é reprocessada (reentrância).
- `/permissions default|manual|acceptEdits|plan|bypassPermissions|status|auto` (e `/allowed-tools`); `tools on|off` continua só restringindo. `/bypass on` (opt-in deliberado, vale também em `--safe`) e `/bypass off` (→ Manual) passam pelo controlador;
  sem controlador a extensão mantém o comportamento antigo, **sem** religar bypass ao sair do plano (só restaura se já estava ligado).
- Troca de sessão/reload: `session_shutdown` solta listener e remove **só** o slot próprio; um controlador novo que já assumiu o slot não é afetado; contexto antigo não lança.

## 5. Patch do pi-code (plan controller)
`claude-home/patches/pi-code/permission-control/apply.mjs`: pacote fixado em `pi-code 1.7.0`; âncora única `pi.on('session_shutdown', … planSection.shutdown(ctx))` em
`extensions/plan-mode/index.ts`; insere um bloco marcado (`// pi-harness permission-control BEGIN/END`) que registra `{active(), set(enabled)}` em `session_start`
(depois do carregamento do estado) usando o `togglePlanMode` protegido só quando o estado difere, e remove só o próprio slot no shutdown. Preflight antes de gravar, idempotente,
reversão remove apenas o bloco próprio, escrita atômica; não altera lista de ferramentas nem gate de aprovação; não é cópia do pacote.
```
node claude-home/patches/pi-code/permission-control/apply.mjs ~/.pi/agent/npm/node_modules/pi-code --check
node claude-home/patches/pi-code/permission-control/apply.mjs ~/.pi/agent/npm/node_modules/pi-code            # aplicar (após revisão do lead)
node claude-home/patches/pi-code/permission-control/apply.mjs ~/.pi/agent/npm/node_modules/pi-code --revert   # desfazer
```
Saída 0 = ok; 2 = versão/âncora inesperada (nada gravado). Outros patches do pi-code não são tocados; reaplicar após reinstalar o pacote.

## 6. Testes
- Python (guard por modo, unidades, endurecimento): `python3 -m unittest discover -s claude-home/hooks/permissions/tests -t claude-home/hooks` (há `tests/__init__.py`; sem ele o `-t` falha com ImportError); legado: `python3 -m unittest -v test_guard` em `claude-home/hooks`. Endurecimento: `tests/test_hardening.py`.
- TS: `node --experimental-strip-types --test extensions/claude-compat/permissions/test/*.test.ts claude-home/patches/pi-code/permission-control/apply.test.ts`.
- Falha fechada de modo inválido: `controller.test.ts` ('modo explícito inválido…'; RED observado com `bypassPermissions` no lugar de `default`) e `test_units.ModesTest`. Opções ocultas: `test_option_forms_*`, `test_attached_short_*`, `test_recursive_rm_*`.
- Matriz abuso coberta: deny/segredo/symlink (`link/../x`, dangling, githook)/prefixos (`timeout`, `LANG=`, `env`, `sudo`)/`touch` com opções/glob/redirect/substituição/`sed e|w|;|-f|--in-place`/multi-comando/caminhos críticos/`~usuario`/modo inválido/`auto`/erro interno.
- RED esperado (para o gate): desabilitar o ramo de modo em `guard.decide` (`PI_PERMISSION_MODE`) faz `DefaultMode`/`AcceptEditsMode` falharem (writes viram allow, `npm test` allow).

## 7. Lacunas e riscos declarados
- `auto` indisponível por falta do classificador oficial; `dontAsk` fora de escopo. Sem modelo, rede ou classificador.
- Lista de leitura comprovada é um subconjunto conservador; ganhar um comando é ask, não um risco. `sed` sem `\` e com um único `s` apenas; cadeias mutantes sempre ask.
- TOCTOU entre o check e a execução permanece (symlink trocado depois); o guard não é sandbox. `bypassPermissions` não adiciona o ask de remoção crítica da doc oficial (os denies legados cobrem raiz/home/sistema).
- **Corrigido (rodada final):** `git` saiu da leitura comprovada; o risco de `core.fsmonitor`/`textconv` deixou de existir no auto-approve (o modo legado sem `PI_PERMISSION_MODE` não mudou).
- **Corrigido:** busca de conteúdo que recursa ou consome diretório/cwd implícito é ask: `grep/egrep/fgrep` com `-r/-R/--recursive/-d recurse` (inclusive abreviados e agrupados); `rg` só com padrão + operandos que são arquivos regulares existentes (não symlink, sem glob, sem leitura negada) e flags da lista curta, senão ask; `diff` só com exatamente dois arquivos regulares e flags da lista curta (`-r`, diretórios, `-` → ask). `sed` com operando de leitura negada → ask. `find`/`ls`/`tree` só enumeram nomes (metadados), sem ler conteúdo.
- Leitura de segredo via Bash não é negada pelo legado; nos modos novos ela só deixa de ser "leitura comprovada" (ask).
- Aceite TUI real de Shift+Tab, `bin/pi`, UiEditor e matriz pertencem ao lead; o patch do pi-code **não foi aplicado ao pacote instalado** por este worker.

## 8. Rollback
Remover `PI_PERMISSION_MODE` do ambiente restaura o guard anterior. `apply.mjs --revert` remove o plan controller. Reverter `guard.decide_with_mode` + a chamada em `decide`, o diretório `hooks/permissions/`,
`extensions/claude-compat/permissions/` e o uso em `commands/settings/permissions.ts`; `bypass-permissions/index.ts` volta ao diff anterior.

## 9. Evidência
Autoria sem suítes (regra de verificar uma vez): apenas parse (`py_compile`/`ast`, carga dos módulos TS) e uma repro mínima do guard (8 casos). O gate completo (Python, TS, cobertura ≥80% por arquivo,
estrutura, scanners) fica para o lead/`gate-runner` na cabeça exata.
