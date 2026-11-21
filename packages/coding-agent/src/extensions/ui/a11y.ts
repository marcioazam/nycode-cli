/**
 * Acessibilidade: NO_COLOR (no-color.org) → tema mono; terminal.reducedMotion (NYCODE_REDUCED_MOTION) ou NO_PROGRESS
 * não vazio (no-progress.org) → indicador estático. O cabeçalho embutido sem cor e sem o clique do logo sob NO_COLOR
 * é do próprio core (K10, interactive-mode.ts), não desta extensão.
 */

import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { resolveNycodeSettings } from "../../core/settings-nycode.ts";

type Env = Record<string, string | undefined>;

export const noColor = (env: Env = process.env): boolean => (env.NO_COLOR ?? "") !== "";
export const reducedMotion = (nycode: ExtensionAPI, env: Env = process.env): boolean =>
	resolveNycodeSettings(nycode.getSettings(), env).terminal.reducedMotion || (env.NO_PROGRESS ?? "") !== "";

export default function (nycode: ExtensionAPI) {
	nycode.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		if (noColor()) {
			// Objeto, não nome: setTheme(nome) grava `theme` em settings.json e tira a cor de todas as sessões seguintes.
			const mono = ctx.ui.getTheme("mono");
			const r = mono ? ctx.ui.setTheme(mono) : { success: false, error: "tema não encontrado" };
			if (!r.success) ctx.ui.notify(`NO_COLOR: tema mono indisponível (${r.error ?? "erro"})`, "warning");
		}
		if (reducedMotion(nycode)) ctx.ui.setWorkingIndicator({ frames: ["●"] });
	});
}
