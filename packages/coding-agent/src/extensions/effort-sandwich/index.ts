/**
 * Esforço no plano: na sessão headless de topo (`nycode -p`), raciocínio `high` só nos primeiros N turnos (ler a
 * tarefa e planejar) e o nível da sessão depois. Opt-in: harness.effortSandwich.enabled (NYCODE_EFFORT_SANDWICH=1)
 * liga; harness.effortSandwich.turns (NYCODE_EFFORT_SANDWICH_TURNS=N, padrão 1). Nível inicial >= high: nada muda.
 * Medição e contrato: docs/specs/0009-effort-sandwich.md.
 * Reverter: apagar este diretório (e as linhas dele em docs/specs/0005-core-scope.md).
 */
import { getAgentDir } from "../../config.ts";
import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { SettingsManager } from "../../core/settings-manager.ts";
import { isTopLevelHeadless } from "../headless-lean/index.ts";

const ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Nível desejado no turno `turn` (0-based). */
export function levelFor(turn: number, initial: string, turns: number): string {
	if (ORDER.indexOf(initial) >= ORDER.indexOf("high")) return initial;
	return turn < turns ? "high" : initial;
}

export default function effortSandwichExtension(nycode: ExtensionAPI) {
	const { enabled, turns } = SettingsManager.create(process.cwd(), getAgentDir(), {
		projectTrusted: false,
	}).getNycodeSettings().harness.effortSandwich;
	if (!enabled) return;
	let initial: string | undefined;
	nycode.on("turn_start", (event, ctx) => {
		if (!isTopLevelHeadless(ctx.hasUI, process.env.NYCODE_SUBAGENT_DEPTH)) return;
		initial ??= nycode.getThinkingLevel();
		const want = levelFor(event.turnIndex, initial, turns);
		if (want !== nycode.getThinkingLevel())
			nycode.setThinkingLevel(want as ReturnType<typeof nycode.getThinkingLevel>);
	});
}
