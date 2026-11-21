# Interactive display polish (2026-11-13)

Minimalist terminal polish of the agent panel and the status line widget, Tokyo Night kept. Patch:
`patches/pi-code/zzzzzzzzz-interactive-display.patch` (applies after `zzzzzzzz-statusline-provider`).
Tests: `bin/tests/interactive-display/display.test.ts`.

## Acceptance

1. **Model prominence**: in a subagent row `[provider/model · effort]` paints the model bold in the `accent` role (HUD `git`, lavender `#bb9af7`); brackets, provider and effort stay `dim` (`#565f89`). A finished row keeps the accent without bold. The visible text is unchanged, so widths, candidates and truncation behave as before; the full `provider/model` stays in the wide row and in the viewer (`Model: … (observed|configured)`).
2. **Clock**: the HUD's `⏱️  1h 10m` becomes `◷ 1h10m` (U+25F7, one cell, no emoji/VS16, one space, tight units). Only a duration right after the stopwatch is rewritten; ANSI around it survives.
3. **Status Line** title (bold dim) is the first line of the status widget (2+ rows). Footer-only paths (one HUD row, or the built-in segment) lead inline instead: `Status Line · <value>`, same roles, clock tidied; with the widget up the footer segment stays unlabelled, so the title never appears twice. `statusRows`/`renderStatusRows` are unchanged; `show()` in `status-line.ts` applies `labelFooter`.
4. **Sub Agents** title (bold dim) and a thin `─` rule appear only when child rows are visible; the rule replaces the panel's trailing blank line and sits between the panel and the Status Line widget. No rows → no title, no rule (the `✓ N finished · /tasks` hint is unchanged).
5. Controller keys, actions, tree, main row stats and width truncation are untouched.

## Design

- `fleet-ui/chrome.ts` (new, pure): `heading`, `rule`, `frameSubAgents`, `frameStatusLine`, `styleModelMeta`, `tidyClock`.
- `panel.ts`: model heads use `styleModelMeta`. `index.ts`: widget wraps `renderPanel` with `frameSubAgents`. `status-line.ts`: widget rows go through `tidyClock`, and `frameStatusLine` adds the title. `renderPanel` and `renderStatusRows` keep their contracts, so the existing exact snapshots are unchanged (no assertion edited).
- Colors come only from the existing roles (`hudTheme`); NO_COLOR emits no codes. No motion, assets or dependencies.

## Sources and gaps

- Tokyo Night: folke/tokyonight.nvim README (styles storm/moon/night/day). Palette hex lookup failed, so no literal is hardcoded: the installed HUD config colors are the authority.
- Unicode UTS #51 §1.4.3: VS15 requests text, VS16 emoji presentation; hence a non-emoji glyph with a cell-width test instead of assuming emoji width 2.
- Kitty text-sizing protocol: client and terminal must agree on cell widths; not adopted (no new protocol).
- Gaps: the concise family label (e.g. `haiku 5.5`) was not added to the row candidates: `listMeta` order and the full id are pinned by existing tests; narrow rows keep the existing shortened forms. The HUD's own first line (`[model]`) is third-party output and untouched.

## Widget order (verified from source, round 1)

pi's `setExtensionWidget` deletes the key from both maps and then `Map.set`s it, and `renderWidgetContainer` iterates insertion order with no sort (`interactive-mode.js` 1970-2059). The fleet widget is set synchronously at `session_start`; the status widget only after the script finishes (>=300 ms) and again on every row change, so a re-set always moves it last: the panel is above the status line, and the rule closes the panel right above the `Status Line` title. Production order is not changed.

## Verification map (final gate)

- `display.test.ts`: pure helpers, snapshots 80/120/200 (earlier round).
- `assembled.test.ts`: REAL `registerFleetUi` + `status-line` extensions on a fake widget host that copies the two native functions above (a model of them, NOT the native TUI). Covers no agents / one agent / only finished at 80/120/200 (title, row order, a single rule adjacent to `Status Line`, no orphan title/rule, widths), plus the single-row footer and built-in paths (red before the `show()` fix: 5 failures; green after: 20/20 with `display.test.ts`).
- `native-frame.test.ts`: real pi CLI in tmux, isolated agent dir/HOME/CLAUDE_CONFIG_DIR, fake provider and `printf` statusLine, no-agent state at 80/120/200. Run at the final gate only: `PI_DISPLAY_FRAME_OUT=/tmp/display-frame.txt node --experimental-strip-types --test ~/.pi/agent/claude-home/bin/tests/interactive-display/native-frame.test.ts` (saves the 120-col pane as the visual frame). Not run yet. Sub-agent rows are not driven natively (needs a model that calls the subagent tool): unverified natively, covered by `assembled.test.ts` only.

## Expected static view (assembled test, width 120, ANSI stripped)

```text
Sub Agents
● main idle · 1 running · ↓ to manage
└─ ⠧ gate-runner [anthropic/claude-haiku-5-5 · medium] run the gate · Reading files   1m 2s | 114.4k tok |   $1.20
────────────────────────────────────────────────────────────────────────────────────────
Status Line
[opus] ◷ 1h10m
Context 10%
```

Footer-only: `Status Line · [opus] ◷ 1h10m`. Rule and titles are cut to the width; the clock is one cell by `visibleWidth`.

## Plan section (unit 2)

Patch `zzzzzzzzzz-plan-section.patch` (10 z's, after the display patch; snapshot taken before it).
**Owner (proven):** the screenshot checklist is `plan-mode/index.ts` `ctx.ui.setWidget('plan-todos', string[])` (above the editor, cut by pi's `MAX_WIDGET_LINES = 10`). `todo.ts` keeps its own independent widget and contract, untouched. The string[] widget is replaced by one persistent component, `plan-mode/section.ts` (`PlanSection`); shared mechanics in `fleet-ui/section.ts` (viewport, clamp, focus ownership, bridge).

**Acceptance / behaviour**
- Order: Sub Agents → rule → Status Line → Plan → rule. Plan has title `Plan done/total` (+ `· 1–6` when the list is longer than the viewport), a body of at most 6 rows (3 on short terminals: `terminal.rows - 18`, clamped 3..6; never unbounded) and a thin rule below; no items → no title, no rule, no widget.
- Fullscreen (default `tuiMode`): `handleMouse` gets local coordinates. Click on the title (row 0) folds/unfolds; click on the body returns `focus:true` (pi focuses Plan, blurs the editor; Plan remembers the editor from `tui.focusedComponent`); the wheel scrolls Plan (handled, so the chat does not move) only while Plan is focused and unfolded, otherwise it is not handled and scrolls the chat. A click elsewhere makes the editor take focus natively, which releases Plan. Regular mode has no mouse (pi docs): the keyboard path is the same behaviour, no mouse is claimed there.
- Keyboard (regular mode's only path): ↓ on an empty editor enters the agents when there are any (the fleet owns it), ↓ at the last agent hands over to Plan, ↑ at the top of Plan returns to the last agent, Esc returns to the editor. With a non-empty draft ↓/↑ stay the editor's (history, cursor). No slash command or new shortcut.
- Native focus (both entries): Plan takes REAL pi focus, from a body click or from ↓ (`tui.setFocus`, remembering the editor), and exposes `capturesViewportInput` = true while focused. Reason (verified in pi-tui source): the fullscreen viewport input listener runs first and gives PageUp/PageDown/Home/End to the transcript unless the focused component captures them; the editor does so only with autocomplete, so a virtual focus would lose those keys. Keys then reach `handleInput`: ↑↓ PgUp PgDn Home End scroll, Space/Enter fold, Esc releases and is consumed; any other key (typing, Ctrl+U, Ctrl+Shift+U, Alt+Up, Ctrl+Enter) refocuses the editor and is forwarded once, so the first letter and the draft survive. Ctrl+Enter (send now) is a core shortcut that fires only while the editor holds focus: from a focused Plan, Esc first, then the chord (documented, not swallowed). `bridge.planFocused` (= native focus) keeps the fleet panel from taking ↓ meanwhile. The assembled fake host models the viewport deferral, but the real routing is for the native test to prove.
- Sub Agents folds too: click the title, or ↓ then ←/Space on the title row (main); `→`/Space unfolds. Folded shows `Sub Agents ▸ 2 running · 1 failed` and the rule; agents keep running. Folded, no row is selectable: x/Enter act on nothing, ↓ lands on the title, one Esc returns to the editor; Ctrl+B is unchanged.
- Footer ordering: pi draws the footer below every widget. While Plan shows and the status line is footer-only (one row or built-in), that row is promoted into the Status Line widget so Plan stays below it, and the footer segment is cleared (no duplicate); when Plan goes away the inline `Status Line · value` returns. `statusRows`/`renderStatusRows` unchanged. After each status widget re-set, `bridge.reassertPlan()` re-sets Plan so it renders last (pi moves a re-set widget to the end).
- State: the offset is kept through checkbox/text updates and clamped on shrink and resize; the section object, listener and bridge links are released at `session_shutdown`.
- Main model brackets (user request): the HUD prints the model segment as `[Model ◐ effort]` (hardcoded in the cached claude-hud `render/parts`, no option). The consumer drops only those outer brackets, on the first row, anchored after any SGR codes and only when the text starts with the live `ctx.model` name/id; a folder first (model hidden), later brackets and child-row metadata are untouched. Old → new: `[opus] ◷ 1h10m` → `m ◐ medium ◷ 1h10m` in the display/assembled tests (user image: `[GPT-6.1 Sol ◐ medium]`). If the HUD ever renames the model so the prefix differs, the brackets stay (safe failure).

**Tests (before the code):** `bin/tests/interactive-display/plan-section.test.ts` (23 tests: SGR→event geometry, wheel only when focused, outside click, Esc/typing/chords, keyboard path, collapse of both, heights 24/40, ordering for multi-row/single-row/built-in, offset/resize, cleanup). `display.test.ts` gained the bracket test.
**Observed during the unit:** one manual tmux launch of the real pi with an isolated agent dir (no `--model fake/m1`) reached the user's configured provider and received an HTTP 402 "Insufficient credits" from OpenRouter; whether it was billed is not measured.
**Native (final gate):** `native-frame.test.ts` and `native-panels.test.ts` (shared `native-harness.ts`; isolated `env -i`, direct CLI, fake 127.0.0.1 provider, 0 requests asserted) cover title/order/bracket/clock, SGR click + wheel on Plan, collapse of both sections, keyboard entry and Esc, in the real CLI. (Older text follows, superseded:) NOT yet covered natively: SGR click + wheel on a Plan. That needs a plan in execution state: proposal for the gate owner is to seed a session entry with plan state (`restored.executing`) or a tiny isolated extension, then `tmux send-keys -l` the sequences `ESC[<0;x;yM` (click) and `ESC[<65;x;yM` (wheel). The earlier note that the wrapper needs the real HOME also means the isolated fixture shows the user's real HUD row; the test asserts on that row, not on a printf.

## Rollback

Reverse the patch (`patch -p1 -R` in the pi-code `extensions` dir); pre-edit backup a local tarball in the agent checkpoints directory (not published).

## Section titles: glyph + role color (user spec, supersedes "bold dim" in acceptance 3, 4 and Plan)

- Old: `Sub Agents`, `Status Line`, `Plan n/m` were bold `dim` text, indistinguishable. New: one-cell glyph + space + name, bold, in a per-section theme role (no hex; Tokyo Night via the theme): `◆ Sub Agents` (`accent`), `● Status Line` (`success`), `■ Plan` (`warning`). All three roles already exist in the theme/palette; no substitute. Detail after the name (`3/20`, `▸ 2 running`, `· 1–6`) stays `dim`. Plan focused keeps the bold `accent` focus style, with the `■` glyph in front.
- Footer-only: `● Status Line · <value>`. The thin rule below Sub Agents and Plan stays; Status Line gets none.
- Code: `heading(title, theme, width, kind)` and `HEADING_KINDS` (kind → glyph, role, name) in `subagent/fleet-ui/chrome.ts`; `plan-mode/section.ts` uses the same table. Patches 9z and 10z rebuilt from the same baselines (9z over `/tmp/pi-display-orig/ext`, 10z over the 9z stack).
- Tests: title regexes now accept the glyph (`^● Status Line$`, `^■ Plan \d+/20`, `^◆ Sub Agents`) in display, assembled, plan-section and native-frame/harness/panels; `display.test.ts` asserts the three glyphs and color SGRs differ and the detail is dim. Other assertions unchanged.

## Section titles: inverted chip, rule below, blank between groups (user spec 2026-11-13, variant D of `~/pi-ui-variants/variante-4.png`; supersedes the glyph section above)

- Old: `◆ Sub Agents` / `● Status Line` / `■ Plan n/m` (glyph + bold role color); closing rule below Sub Agents and Plan, none for Status Line; `Status Line · value` in the footer; no blank line between groups.
- New: the title is a chip, ` SUB AGENTS ` / ` STATUS LINE ` / ` PLAN ` (upper case, one space of padding each side): `ESC[7m` + `theme.fg(role, chip)` + `ESC[27m`, bold, so the role color becomes the background (no hex). Roles: `accent`, `success`, `warning`; the glyphs are gone. The detail after the chip stays dim (`· 1 running`, `3/20 · 1–6`, `▸ 2 running`). Plan focused: chip in `accent` plus the `· space fold · esc back` hint.
- Each group is chip, thin dim rule right below it, body; the closing rules are gone and Status Line gets the rule too. Folded: `chip ▸ summary` + rule. Footer-only: `<chip> value`, no rule.
- Spacing: Sub Agents ends with one blank line (the original trailing blank), Plan starts with one blank line; with no agents or no plan there is no title, rule or blank for that group.
- Plan mouse rows (local): 0 blank, 1 chip (toggle), 2 rule, 3+ body.
- Code: `HEADING_KINDS` (name, role), `chip(kind, theme, role?)`, `heading(title, theme, width, kind, role?)` in `subagent/fleet-ui/chrome.ts`; `plan-mode/section.ts` uses the same. Patches 9z and 10z rebuilt over the same baselines.
- Tests: display, assembled, plan-section, native-frame/harness/panels and `fleet-ui.test.ts` follow the new contract (chip regexes `^ SUB AGENTS`, `^ STATUS LINE`, `^ PLAN\s+\d+/20`; rule below each chip, blank lines between groups, rule counts); display still asserts that the three chips differ by color SGR.

## Running mark: pulsing green dot (user request)

- Old: braille spinner on running rows. New: `SPINNER = ['·','•','●','●','•','·']` (200 ms/frame, role `success`), patch `zzzzzzzzzz-pulse-dot.patch` (sorted before `zzzzzzzzzzz-subagent-routing`, whose replay test requires it last). Static glyph under NO_COLOR/reduced motion; finished rows never animate. Test: `subagent-panel/fleet-ui-layout.test.ts`.

## Spacing below the editor (user request 2026-11-13; patches 9z `zzzzzzzzz-interactive-display` and 10z `zzzzzzzzzz-plan-section` rebuilt)

- Old: Sub Agents ended with a blank line, Status Line had none (it hugged the editor), Plan opened with one.
- New: every group below the editor opens with exactly one blank line and none ends with one: `frameSubAgents` -> `['', chip, rule, ...body]` (collapsed `['', chip ▸ summary, rule]`; finished-hint-only lines become `['', hint]`), `frameStatusLine` -> `['', chip, rule, ...rows]`, Plan unchanged. The footer-only inline label is unchanged; the one-row status promoted into the widget while Plan shows goes through `frameStatusLine`, so it gets the single leading blank (no footer text then, no duplicate). No group, no blank line.
- Mouse: the Sub Agents title is now widget row 1 (`event.y !== 1`; row 0 is the spacing); Plan unchanged.
- Tests: display, assembled, plan-section, native-frame and subagent-panel/fleet-ui assert first line blank, last line not blank and the click row.

## Final gate evidence (2026-11-13, `env -u PI_CODE_SUBAGENT -u PI_CODE_SUBAGENT_DEPTH`, logs in /tmp/gate)

- patches/pi-code suites 386/386 (after fixing 5 stale-contract/regression failures: title+rule layout in fleet-ui tests, `PlanSection` guard for a `ui` without `onTerminalInput`, theme mock `bold`, replay revert order); interactive-display 55/55 (unit + native); interactive-input 86/86 (incl. native e2e); cache-warm-identity 3/3; wrapper/install/guard exit 0; check-leaks clean; structure clean.
- Found by the gate: `send-now/apply.mjs` CLI was a no-op when invoked through a symlink (run guard compared realpath with argv[1]); fixed with `realpathSync`.
- Not measured: node coverage after the last edits, native replay after the pulse-dot patch, real-terminal visuals. Open outside this record: `check-refs.py` flags `swarm-orchestration/SKILL.md:21` (other lane); routing patches live only under `~/.pi/agent/claude-home`.

## Fold symbol in the chips + collapsible Status Line (user request 2026-11-13; patch 10z `zzzzzzzzzz-plan-section` rebuilt over the 9z result, 9z unchanged)

- Old: Sub Agents and Plan folded (click, or ↓ then ←/Space) and showed a loose `▸ summary` after the chip when folded; the Status Line could not fold; no symbol said a section was foldable.
- New: the chip carries the state, one cell before the name: ` ▾ SUB AGENTS ` / ` ▾ STATUS LINE ` / ` ▾ PLAN ` expanded, ` ▸ … ` folded (role colors unchanged). The detail after the chip stays dim: Sub Agents folded `2 running · 1 failed`, Plan `3/20`; the loose `▸` is gone. The footer-only inline status (no widget, nothing to fold) keeps the symbol-less chip.
- Status Line folds: a click on the chip row (fullscreen, widget row 1; row 0 is the spacing; plain `click` like the other two) toggles. Folded: chip, rule and ONE dim line = the first HUD row (already `tidyRow`, ANSI stripped, cut to the width); the other rows are hidden. State lives in memory for the session (`StatusFold`, closure of the extension), survives widget re-sets, is not written to disk and resets at `session_start`/`session_shutdown`.
- Keyboard (regular mode has no mouse), uniform: from an empty editor ↓ → Sub Agents (if it has rows) → Status Line → Plan (if it has items); ↑ walks back (Plan top → Status Line → last agent → editor); Esc returns to the editor. On a focused chip Space or ← folds, → or Space unfolds (Plan gained ←/→; Space/Enter unchanged). Focused Status Line: accent chip plus `· space fold · esc back`, same as Plan. A non-empty draft keeps ↓/↑; Plan keeps native focus and `capturesViewportInput`; Sub Agents keeps its own selection. Without Sub Agents/Plan the chain skips them (no holes); a one-row status is promoted into the widget while Plan shows, so it is part of the chain then.
- Bridge (`fleet-ui/section.ts`) extended with four members: `statusActive()`, `statusFocused()`, `focusStatus()` (set by status-line) and `fleetActive()` (set by fleet-ui). Entry rules are order-independent: the empty-editor ↓ goes to Sub Agents when `fleetActive`, else Status Line when `statusActive`, else Plan; the fleet panel no longer takes ↓ while `statusFocused`; its last-row/folded ↓ calls `focusStatus() || focusPlan()`; Plan ↑ at the top calls `focusStatus() || focusFleetLast()`. The Status Line focus is virtual (the editor keeps native focus; `StatusFold.handleKey` on `onTerminalInput`), like Sub Agents.
- Code: `chip/heading(…, collapsed?)`, `frameStatusLine(rows, theme, width, {collapsed, focused})`, `StatusFold` and the bridge in `subagent/fleet-ui/{chrome,section}.ts`; `status-line.ts` widget (`handleMouse`, listener); `plan-mode/section.ts` and `fleet-ui/{index,panel}.ts` follow. `fleet-ui` already held 8 files before this change (none added).
- Tests: display (symbols, folded summary, focus hint, no duplicate `▸`), assembled and plan-section (fold/click/state across a re-set widget; keyboard chain for Status only, Status+Plan and all three; Plan ←/→), fleet-ui, native-frame/harness/panels (`^ [▾▸] NAME` regexes, new `status-fold` scenario: click folds/unfolds, symbols, Space/→/Esc, 0 provider requests). The Status Line tests live in `plan-section.test.ts` (it owns the shared host; a new file would need the host duplicated or a seventh file).

## Footer folds with the Status Line (2026-11-13)

- Old: folding the Status Line hid only the widget body; footer statuses (the `⚠ BYPASS PERMISSIONS ON` warning) stayed below it.
- New: the footer bridge payload carries `folded`; `hudFooterBridge().fold()` sets it while the widget is folded and `claim(false)` clears it. `footer-no-stats.ts` renders nothing while `folded`. Test: `statusline-multiline.test.ts`.
- Folded Status Line (supersedes the one-summary-line rule above): chip and rule only, no HUD row. Also `tidyClock` now accepts `<1m`.

## Status Line layout: identity left, transient right (2026-11-13)

- Old: HUD rows shown as printed (`model │ cwd │ ◷ t │ Cost $x`, `Context … │ Usage … │ Weekly …`, tools row, bypass in the footer, all left-aligned).
- New (variant 1 of `~/pi-ui-variants/status`, chosen by the user): `chrome.layoutStatus` puts `model · cwd` left and `◷ t · $cost` right; the meters row reads `ctx … · 5h … · wk …` with the tools row at its right; further rows are right-aligned; `footer-no-stats.ts` right-aligns the footer statuses (bypass warning). Falls back to the untouched rows when a line would not fit (narrow terminal) or the first row is not the HUD's `│` model row. Colors stay the HUD's and the theme's. Test: `display.test.ts` (`layoutStatus`).
- Follow-up: the HUD todo line (`All todos complete (7/7)`) is dropped from the Status Line (`dropTodoRows`; the Plan section owns task progress), and a row whose two sides do not fit splits into two lines instead of falling back to the old layout.

## Plan table (2026-11-13)

- Old: Plan body was `☑/☐ text` lines; no time, no agent, only done/open.
- New (UI only): `# · estado · tarefa · tempo · agente` table (`plan-mode/table.ts`, tests `plan-table.test.ts`). States: feito `✓`, fazendo `▸` (first open step, bold, running counter), a fazer `○`, plus bloqueado `‖`, falhou `✕`, pulado `⊘` when `TodoItem.status` is set. The chip carries the elapsed plan time. Time cell: `finalizado mm:ss`, a running `mm:ss ▮` (1 s timer only while a step runs, the section is expanded and shown; the mark does not blink under reduced motion/NO_COLOR), `—` otherwise. Narrow widths drop agente, then tempo.
- Data that does NOT exist yet (the UI reads it when a producer sets it): `TodoItem.status` and `TodoItem.agent` (no code sets them), per-step timestamps (the UI observes transitions in this session only; a step already done at first sight shows `--:--`), and any link between a plan step and a sub agent run or an agent team. Plan steps are still closed only by the `[DONE:n]` tag.

## Responsive Status Line (2026-11-13, supersedes the "stack below 60 columns" and "split in two lines" rules)

- Wide (every row fits): identity left, transient right, as before.
- Otherwise the compact flow in `layoutStatus` (`chrome.ts`): ONE identity line (`model effort · cwd · ◷ t · $cost`; two lines only when it does not fit), ONE meters line (`ctx … · 5h … · wk …`), then tools, then the extra rows (bypass). No blank lines, no rules.
- Meters degrade in order: parenthetical details (`(98k/1.0M)`, `(resets in …)`) drop, the bars shrink (`fitBar`: 8, 5, 3 cells, same filled proportion and colors), the bars drop, and only then each meter takes its own line.
- Rows are laid out BEFORE they are truncated (the widget passes unbounded rows): truncating first cut the clock/cost off and the layout could not recognize the model row.

## Default layout at every width (2026-11-13, supersedes the wide "identity left, transient right" layout)

The user chose the compact flow as the standard: `layoutStatus` always returns it (merged identity line, one meters line, tools, extras), with the same degradation ladder when narrow. No right-aligned wide variant remains.

## Responsive Plan table and left-aligned footer (2026-11-13)

- Plan table ladder (`columns()` in `plan-mode/table.ts`): full (`# estado tarefa tempo agente`) → no agente → short time (`02:14`, the state already says feito) → state as a symbol only → symbol + task, without number, time or header. The task keeps ≥24 cells (≥12 once compact) and is cut with `…`.
- Footer statuses (bypass warning) are left-aligned like the Status Line rows; the old right alignment is superseded.

## Fechamento da sessão (2026-11-14)

- **Edição da fila**: `app.message.dequeue` = `ctrl+shift+up` (substitui `ctrl+shift+u` e `alt+up`). Causa do E2E vermelho: `ctrl+shift+up` já era `tui.altScreen.previousPrompt` no pi (consome antes do editor), então `keybindings.json` também fixa `tui.altScreen.previousPrompt: ctrl+up`. Kitty: `map ctrl+shift+up` sem ação (o padrão rola uma linha). A extensão `up-dequeue` reescreve ↑ como `ctrl+shift+up`.
- **Todos nunca no chat**: o widget do `todo.ts` renderiza vazio; a lista vai à seção Plan pelo evento `pi-code:todos` (`plan-mode/index.ts` escuta; plano em execução tem prioridade). Supera "todo some quando concluído".
- **Relógio do Plan para** quando todos os passos estão feitos e volta se um passo novo abre (`PlanTimes.doneAt`).
- **Sub Agents**: resumo no título (`N running · ◌ N quiet · ✕ N failed · ✓ N done`, running azul, done verde); linha `quiet` após 2 min sem registro (`updatedAt`; sem heartbeat, então "quiet", nunca "stalled"); pai recolhido mostra `(+N · ● r · ✕ f)`; modelo/effort neutros (só `max`/`xhigh` ao vivo em warning); dica de teclas só com o que vale para a linha; `x` de novo cita descendentes.
- **Gestão do Plan (estudo, nada aplicado)**: `~/pi-ui-variants/plan-agents/gestao-{1,2,3}.png` (Ledger vivo, Gate de aprovação, Ondas e dependências). Fontes: docs Kiro, Devin, VS Code Copilot, Warp, Vorflux, Qoder, Deventry, Scrim UI, thClaws (Perplexity + Exa + Parallel, 2026-11-13).

## Plan: gestão variante 1 "Ledger vivo" (2026-11-14, só interface)

- Título: `PLAN done/total · mm:ss · <tokens> tok · $<custo>` (gasto da sessão principal desde que o plano apareceu, somando as mensagens do assistente do ramo; subagentes não entram) seguido de `N bloqueados · N falhou · N pulados` e `✓ concluído`.
- Linha de detalhe `↳ nota` sob o passo que tem `TodoItem.note` (motivo, pergunta ou erro), alinhada à coluna da tarefa e pintada com a cor do estado.
- Recolhido: o título leva `fazendo: <passo atual>`. Pulado conta como encerrado (relógio para, `✓ concluído`).
- Sem produtor ainda para `note`/`status`/`agent`, e as teclas r (repetir), s (pular), b (responder) não existem: dependem de o plano ter um produtor desses campos.

## Plan: gestão interativa (2026-11-14, etapa 1)

- Com o Plan focado (↓ com o editor vazio, ou clique): ↑↓/PageUp/PageDown/Home/End movem a seleção `❯` (a janela segue nas bordas; a roda continua só rolando); Espaço e ←/→ recolhem; Enter abre/fecha a gaveta do passo (estado, agente, duração, tokens e $ do passo, nota, tarefa, arquivo do plano).
- `s` pula o passo selecionado (pergunta o motivo; Esc cancela), `r` reabre um pulado, `p` pausa/retoma, `o` abre o plano no aplicativo padrão (`xdg-open`; sem arquivo de plan-mode gera um checklist `.md` em tmp). Passos concluídos nunca mudam.
- Pausar: aborta a execução em curso, congela relógio e passo (o intervalo some da contagem) e avisa o agente; retomar inicia um turno. Pular/reabrir avisam o agente (steer se rodando, próximo turno se ocioso).
- As teclas válidas ficam no título (nunca uma linha nova ao focar, para não mover o chat); `esc back` nunca é cortado.
- Supersede: Enter dobrava o Plan (agora Espaço); ↑↓ rolavam a janela (agora movem a seleção). O título já mostrava `x/y na tela` (pedido de 2026-11-13); os testes nativos foram atualizados a isso.
- Código: `plan-mode/manage.ts` (marcas, teclas, gaveta, abrir arquivo). Marcas do usuário vivem só na sessão (memória). Fora da etapa 1: seleção por mouse, repetir com tentativas, responder bloqueio, edição/reordenação e versões do plano.

## Sub Agents: resumo `x/y` e sem rodapé "finished" (2026-11-14)

- O título (aberto ou recolhido) mostra só `x/y`: x = execuções encerradas (done ou failed), y = todas as contadas. Ciano (papel `text` do HUD) enquanto algo roda, vermelho se alguma falhou, verde quando todas terminaram sem erro. Sem ícone `✓`.
- Removida a linha `✓ N finished · /tasks` sob o painel. Supersede o resumo `N running · ◌ quiet · ✕ failed · ✓ done` (o `quiet` continua na linha do agente).
