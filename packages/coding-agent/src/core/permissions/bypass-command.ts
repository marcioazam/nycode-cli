/**
 * Bypass Permissions (estilo Claude Code) para o motor de permissões do nycode.
 *
 * Padrão: DESLIGADO (modo seguro). Liga com `nycode --bypass`, NYCODE_BYPASS_PERMISSIONS=1 ou `permissions.bypass`;
 * `nycode --safe` (ou NYCODE_BYPASS_PERMISSIONS=0) mantém as confirmações.
 *
 * O guard (${NYCODE_RESOURCES}/hooks/guard.py, hook PreToolUse da extensão `hooks`) lê
 * NYCODE_BYPASS_PERMISSIONS do ambiente; os hooks herdam o process.env do nycode, então
 * alternar a variável aqui vale imediatamente para esta sessão (e subagents iniciados depois).
 *
 *   /bypass          alterna
 *   /bypass on|off   define      /bypass status   mostra
 *   Ctrl+Shift+B     alterna
 *
 * Plan mode (nycode): ao sair do plan mode para executar o plano, o bypass é
 * religado automaticamente (mesmo que você o tenha desligado antes). Enquanto o
 * plan mode está ativo, o próprio plan mode já restringe as ferramentas.
 *
 * Com bypass ON as confirmações ("ask") somem; os bloqueios catastróficos ("deny") continuam.
 */

import { Key } from "@nycode/tui";
import { PLAN_MODE_CHANNEL } from "../../extensions/_shared/events/plan-mode-state.ts";
import type { ExtensionAPI, ExtensionContext } from "../extensions/types.ts";
import { isBypassOn as isOn, setBypassState } from "./bypass-state.ts";

const STATUS_KEY = "bypass-permissions";

function render(ctx: ExtensionContext | undefined): void {
	if (!ctx?.hasUI) return;
	// NO_COLOR: o texto fica pronto antes de ui/a11y.ts trocar para o tema mono, então sem cor aqui mesmo.
	const warn = process.env.NO_COLOR ? "⚠ BYPASS PERMISSIONS ON" : ctx.ui.theme.fg("error", "⚠ BYPASS PERMISSIONS ON");
	ctx.ui.setStatus(STATUS_KEY, isOn() ? warn : "🔒 permissions: ask");
}

function set(ctx: ExtensionContext | undefined, on: boolean, why?: string): void {
	setBypassState(on);
	render(ctx);
	if (ctx?.hasUI) {
		const base = on
			? "Bypass Permissions ON: confirmações desligadas (bloqueios catastróficos continuam)"
			: "Bypass Permissions OFF: confirmações reativadas";
		ctx.ui.notify(why ? `${base} (${why})` : base, on ? "warning" : "info");
	}
}

export default function (nycode: ExtensionAPI) {
	let lastCtx: ExtensionContext | undefined;
	let planActive = false;

	nycode.on("session_start", async (_event, ctx) => {
		lastCtx = ctx;
		render(ctx);
	});

	// o plan-mode publica { active } no bus ao entrar/sair do plan mode.
	// Transição active -> inativo = plano sendo executado (ou plan mode encerrado): bypass ON.
	nycode.events.on(PLAN_MODE_CHANNEL, (data: unknown) => {
		const active = (data as { active?: unknown } | undefined)?.active;
		if (typeof active !== "boolean") return;
		const leaving = planActive && !active;
		planActive = active;
		if (leaving && !isOn()) set(lastCtx, true, "execução do plano");
	});

	nycode.registerCommand("bypass", {
		description: "Bypass Permissions: alterna (ou on/off/status) as confirmações do guard",
		handler: async (args, ctx) => {
			lastCtx = ctx;
			const arg = (args ?? "").trim().toLowerCase();
			if (arg === "on") set(ctx, true);
			else if (arg === "off") set(ctx, false);
			else if (arg === "status") ctx.ui.notify(`Bypass Permissions: ${isOn() ? "ON" : "OFF"}`, "info");
			else set(ctx, !isOn());
		},
	});

	nycode.registerShortcut(Key.ctrlShift("b"), {
		description: "Alternar Bypass Permissions",
		handler: async (ctx) => {
			lastCtx = ctx;
			set(ctx, !isOn());
		},
	});
}
