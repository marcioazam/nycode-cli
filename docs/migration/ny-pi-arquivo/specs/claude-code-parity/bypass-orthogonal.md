# Bypass ortogonal aos modos (Ask, Auto, Plan) — dono, 2026-11-15

Estado: implementado e verificado localmente (2026-11-15), sem commit. Supera partes de `permission-modes.md` (§2 última linha, §3 linhas `plan`/`bypassPermissions`, §4 ciclo, largada,
wrapper e restauração do plano) e o "Bypass … ao executar um plan, volta a ON" de `guard.py`.

## Decisões do dono (2026-11-15, perguntas registradas na sessão)
1. Modos visíveis: **Ask** = `default`, **Auto** = `acceptEdits` (o auto oficial com classificador segue indisponível; `auto` vira alias de `acceptEdits`),
   **Plan** = `plan`. Os identificadores internos não mudam.
2. Bypass é um **interruptor de permissão independente do modo**: pode estar ligado em Ask, Auto ou Plan. Ligado = "permissão total ao LLM":
   todo ASK do guard vira allow em qualquer modo, inclusive Plan. Os DENY catastróficos continuam (guard e `rules/safety.md`, sempre-negar do dono).
   No Plan, a restrição de ferramentas só-leitura do pi-code continua (é o fluxo do plano, não uma confirmação do guard).
3. Shift+Tab cicla só `default → acceptEdits → plan → default`. Bypass liga e desliga por `/bypass`, Ctrl+Shift+B ou `/permissions bypass on|off`.

## Contrato
- Ambiente: `PI_PERMISSION_MODE ∈ {default, acceptEdits, plan}` e `PI_BYPASS_PERMISSIONS ∈ {0,1}` independentes.
  Valor legado `PI_PERMISSION_MODE=bypassPermissions` (filhos antigos, arquivo de restart v2, `--bypass` antigo) = `default` + bypass ligado (se disponível).
  Aliases aceitos (TS, Python, wrapper): `default|manual|ask` → default; `acceptedits|auto` → acceptEdits; `plan`; `bypasspermissions` → legado acima.
  Inválido continua falhando fechado em `default` (bypass não muda por causa disso).
- Guard (`hooks/permissions`): com modo definido, DENY legado primeiro; depois, se `PI_BYPASS_PERMISSIONS` verdadeiro → allow em **qualquer** modo; senão a tabela por modo
  de `permission-modes.md` §3 (default/acceptEdits/plan). Sem `PI_PERMISSION_MODE`, legado bit a bit (inalterado).
- Disponibilidade do bypass: `PI_BYPASS_ELIGIBLE` verdadeiro **ou** opt-in deliberado (`PI_BYPASS_OPTIN`), como antes. Indisponível → bypass desligado.
- Controlador (slot `pi-harness.permission-modes`): estado `{mode, bypass}`. `select(mode)` muda só o modo; `select('bypassPermissions', {explicit})` = liga o bypass
  (compatibilidade). Novo `setBypass(on: boolean, opts?: {explicit?: boolean}): ModeResult`. `status()` ganha `bypass: boolean`. Entrar/sair do plano guarda e restaura **só o modo**;
  o bypass não muda. `PI_BYPASS_PERMISSIONS = bypass ? '1' : '0'` sempre (inclusive no plano).
- Rótulos: `Ask`, `Auto`, `Plan`; bypass mostrado junto: status `⏵⏵ auto` em Auto, nada em Ask; `⚠ bypass ligado` (realce de perigo) acrescido quando ligado, em qualquer modo.
- Restart v2 (`lifecycle/restart.ts`, `supervisor.sh`): `mode ∈ {default, acceptEdits}` e `bypass ∈ {0,1}` independentes (bypass=1 exige eligible ou optin);
  `bypassPermissions:1` legado aceito na leitura.
- Wrapper `bin/pi`: `--bypass` → `ELIGIBLE=1 BYPASS=1 MODE=default OPTIN=1`; `--safe` inalterado; herdado: modo normalizado pelos aliases, bypass = herdado verdadeiro **e** disponível.

## Aceite observável
- Guard: com `PI_BYPASS_PERMISSIONS=1`, um ASK (ex.: `git push`, Write fora do escopo) é allow em `default`, `acceptEdits` e `plan`; DENY (`rm -rf /`, Read de `~/.ssh/id_rsa`) continua deny. Sem bypass, a tabela antiga vale.
- Controlador: bypass ligado + `select('plan')` → modo plan, bypass ligado, env `1`; sair do plano restaura o modo, bypass ligado. Ciclo nunca passa por bypass.
- `/bypass on` em Auto mantém Auto; `/bypass off` mantém o modo (não volta mais a Manual).

## Rollback
Reverter os arquivos deste registro; o ambiente legado (`bypassPermissions`) continua aceito, então sessões e arquivos de restart antigos não quebram.

## Evidência (2026-11-15, árvore de trabalho sobre HEAD 4e38f41)
- RED observado antes da implementação: Python 6/51, controller+slot 11/23, comando 1/14, restart/supervisor/wrapper com casos novos vermelhos.
- GREEN: `hooks/permissions/tests` 51 OK, `test_guard` 24 OK; TS (permissions, commands, lifecycle, clear, ui, ui-visual, apply) 285 de 289 antes das correções de
  integração; depois `restart.ts` (bug: legado `bypassPermissions` não era lido do novo `parseMode`) e o fake do slot em `editor.test.ts` corrigidos → todos verdes;
  `bypass-permissions` 18/18 (via `with-sdk.sh`); `wrapper.test.mjs` 8/8; `supervisor.test.sh` e `bin/test_pi_env.sh` sem FAIL.
- E2E: `modes.sh fixture` e `modes.sh real` OK (TUI real, Shift+Tab, /permissions, guard com ambiente vivo). Guard pela CLI do hook: com bypass=1, `git push` é allow em default, acceptEdits e plan;
  `rm -rf /` segue deny nos três; com bypass=0, ask.
- Cobertura por arquivo alterado (linhas): decide.py 93%, modes.py 100%; controller/modes/wiring/restart/bypass index 100%, slot 100%, settings/permissions.ts 85,7%.
- Estático nos arquivos desta mudança: ruff/format, shellcheck e shfmt iguais à base (dívida anterior); biome sem achado novo após ajustes. O `run-static.sh` completo falha por
  outros ~75 arquivos alterados na branch e por `coverage` ausente no ambiente (medido à parte com `uvx`).
- Testes superados (contrato antigo → novo) estão nas mensagens dos testes: plan ignorava bypass → allow; `auto` inválido → alias de acceptEdits; ciclo com bypass → 3 modos;
  `/bypass off` → Manual → mantém o modo; `--bypass` → `MODE=bypassPermissions` → `MODE=default BYPASS=1`.
