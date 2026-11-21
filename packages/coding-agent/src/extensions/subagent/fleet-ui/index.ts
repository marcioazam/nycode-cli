/**
 * Entry of the agent-fleet UI (local patch): the panel below the prompt, its key
 * handling, the live viewer and the /tasks browser. Wired by ../index.ts.
 * Record: docs/pi-agent-fleet-2026-11-12.md.
 */
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "../../../core/extensions/types.ts";

import type { FleetSource } from "../fleet/types.ts";
import { nav } from "../section-nav/nav.ts";
import type { MainStats, PanelView } from "./panel.ts";
import { executeAction, PanelController, renderPanel } from "./panel.ts";
import { frameSubAgents, summaryLine, tabbed } from "./style/chrome.ts";
import { hudTheme } from "./style/palette.ts";
import { openTasksBrowser, openViewer, overlays } from "./viewer.ts";

const WIDGET_KEY = "pi-code-fleet";
const TICK_MS = 250; // spinner pace; idle ticks render once per second (IDLE_EVERY)
const IDLE_EVERY = 4;
const CONTEXT_TTL_MS = 1000;

/** nycode's TUI keeps the focused component private: treat the editor (getText + setText) as the
 * owner; unknown focus counts as the editor so activation keeps working. */
function editorOwnsFocus(tui: unknown): boolean {
	const focused = (tui as { focusedComponent?: unknown } | undefined)?.focusedComponent;
	if (focused == null) return true;
	const c = focused as { getText?: unknown; setText?: unknown };
	return typeof c.getText === "function" && typeof c.setText === "function";
}

/** Custo da sessão: soma de usage.cost.total das mensagens do assistente no ramo atual; indisponível = undefined. */
function branchCost(ctx: ExtensionContext): number | undefined {
	try {
		let total = 0;
		for (const entry of ctx.sessionManager.getBranch() as Array<{
			type?: string;
			message?: { role?: string; usage?: { cost?: { total?: number } } };
		}>) {
			if (entry.type === "message" && entry.message?.role === "assistant")
				total += entry.message.usage?.cost?.total ?? 0;
		}
		return total;
	} catch {
		return undefined;
	}
}

export function registerFleetUi(
	nycode: ExtensionAPI,
	getSource: () => FleetSource | undefined,
): { openTasks(ctx: ExtensionCommandContext): Promise<void> } {
	// Estado do main só para desenhar a raiz do painel; nada aqui comanda o fluxo.
	const main: { state: MainStats["state"]; since?: number; cost?: number; ctx?: ExtensionContext } = { state: "idle" };
	// getContextUsage() walks the branch: 6.3% of the non-idle samples while animating. Kept for CONTEXT_TTL_MS by the `now` the
	// panel passes in, and dropped by the events that change the context (message, turn end, compaction, new session).
	let usage: { at: number; tokens: number | undefined } | undefined;
	const dropUsage = (): void => {
		usage = undefined;
	};
	const getMain = (now: number): MainStats | undefined => {
		if (!main.ctx) return undefined;
		if (!usage || now - usage.at >= CONTEXT_TTL_MS || now < usage.at) {
			let tokens: number | undefined;
			try {
				tokens = main.ctx.getContextUsage()?.tokens ?? undefined;
			} catch {
				tokens = undefined;
			}
			usage = { at: now, tokens };
		}
		const contextTokens = usage.tokens;
		return {
			state: main.state,
			elapsedMs: main.since === undefined ? undefined : Math.max(0, now - main.since),
			contextTokens,
			cost: main.cost,
		};
	};
	const controller = new PanelController({ getSource, now: Date.now, getMain });
	nycode.on("agent_start", () => {
		main.state = "thinking";
		main.since = Date.now();
	});
	nycode.on("turn_start", () => {
		if (main.state !== "idle") main.state = "thinking";
	});
	nycode.on("tool_execution_start", () => {
		if (main.state !== "idle") main.state = "working";
	});
	nycode.on("turn_end", (_event, ctx) => {
		dropUsage();
		main.cost = branchCost(ctx);
	});
	nycode.on("message_end", dropUsage);
	nycode.on("session_compact", dropUsage);
	nycode.on("agent_settled", (_event, ctx) => {
		dropUsage();
		main.state = "idle";
		main.since = undefined;
		main.cost = branchCost(ctx);
	});
	let cleanup: (() => void) | undefined;

	nycode.on("session_start", (_event, ctx) => {
		cleanup?.();
		cleanup = undefined;
		main.ctx = ctx;
		dropUsage();
		main.cost = branchCost(ctx);
		if (!ctx.hasUI || process.env.NYCODE_SUBAGENT) return;
		let tui: { requestRender(): void } | undefined;
		let lastView: PanelView | undefined;
		let ticks = 0;
		const render = (): void => tui?.requestRender();
		ctx.ui.setWidget(
			WIDGET_KEY,
			(t, theme) => {
				tui = t;
				const hud = hudTheme(theme);
				return {
					render: (width: number) => {
						nav.stamp("subagents");
						lastView = controller.view();
						const summary = summaryLine(lastView.counts, hud);
						return tabbed(
							"subagents",
							frameSubAgents(renderPanel(lastView, hud, width), lastView.rows.length > 0, hud, width, summary),
							summary,
							hud,
							width,
							render,
						);
					},
					// Fullscreen mode (default) routes the click here with local coordinates: when this group draws the tab bar, rows 0-2 are the bar.
					// Regular mode has no mouse; ↓ then ← / → / Enter / Space on the tab do the same.
					handleMouse: (event: { type?: string; x?: number; y?: number }) => {
						if (
							event.type !== "click" ||
							!lastView ||
							lastView.rows.length === 0 ||
							(event.y ?? -1) >= nav.barRows("subagents")
						)
							return undefined;
						return nav.clickBar(event.x, event.y) ? { handled: true, render: true } : undefined;
					},
					invalidate: () => {},
				};
			},
			{ placement: "belowEditor" },
		);
		nav.register({
			id: "subagents",
			active: () => controller.rows().length > 0,
			hasBody: true,
			label: () => {
				const rows = controller.rows();
				return `Agentes ${rows.filter((r) => r.state === "running").length || rows.length}`;
			},
			changed: () => {
				controller.tabChanged();
				render();
			},
			enter: () => controller.enterBody(),
		});
		const offInput = ctx.ui.onTerminalInput((data) => {
			const source = getSource();
			const env = {
				editorText: ctx.ui.getEditorText(),
				editorFocused: editorOwnsFocus(tui),
				overlayOpen: overlays.open > 0,
			};
			// Group titles (level 1 of section-nav) own ↑↓ Enter Esc while a title is focused; a Sub Agents body keeps its own keys.
			if (!controller.focused && nav.handleKey(data, env)) {
				render();
				return { consume: true };
			}
			const result = controller.handleKey(data, env);
			if (result.action && source) {
				executeAction(result.action, {
					source,
					notify: (m, type) => ctx.ui.notify(m, type),
					open: (id) => void openViewer(ctx, source, id),
				});
			}
			if (result.consume || result.action) render();
			return result.consume ? { consume: true } : undefined;
		});
		let offChange: (() => void) | undefined;
		let subscribedTo: FleetSource | undefined;
		const subscribe = (): void => {
			const source = getSource();
			if (!source || source === subscribedTo) return;
			offChange?.();
			subscribedTo = source;
			offChange = source.onChange(render);
		};
		subscribe();
		const timer = setInterval(() => {
			subscribe(); // getSource() may only start answering after session_start
			ticks += 1;
			// Animation frames re-render without reading the fleet again; idle ticks keep the old 1 s cadence.
			if (lastView?.frame !== undefined && lastView.running > 0) return render();
			if (ticks % IDLE_EVERY !== 0) return;
			const view = controller.view();
			if (view.rows.some((r) => r.state === "running") || view.rows.length > 0 || view.finished > 0) render();
		}, TICK_MS);
		timer.unref?.();
		cleanup = () => {
			offInput();
			offChange?.();
			clearInterval(timer);
			nav.unregister("subagents");
			ctx.ui.setWidget(WIDGET_KEY, undefined);
		};
	});

	nycode.on("session_shutdown", () => {
		cleanup?.();
		cleanup = undefined;
	});

	return {
		async openTasks(ctx) {
			if (!ctx.hasUI) return;
			const source = getSource();
			if (!source) {
				ctx.ui.notify("No subagent runs in this session.", "info");
				return;
			}
			await openTasksBrowser(ctx, source);
		},
	};
}
