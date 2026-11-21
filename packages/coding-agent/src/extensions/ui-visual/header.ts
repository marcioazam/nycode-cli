/** Cabeçalho: logo + identidade (versão, modelo, raciocínio, contexto), lugar (pasta, branch) e atalhos; sem NO_COLOR. */

import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { sep } from "node:path";
import { truncateToWidth, visibleWidth } from "@nycode/tui";
import { VERSION } from "../../config.ts";
import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { nycodeLogoLines, nycodeWordmark, supportsNycodeLogo } from "../../modes/interactive/components/nycode-logo.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { noColor } from "../ui/a11y.ts";
import { icon } from "./icons.ts";

type Style = Pick<Theme, "fg" | "bold">;
export type HeaderParts = {
	version: string;
	model: string;
	cwd: string;
	branch: string;
	thinking?: string;
	context?: string;
};

export const HINTS: [string, string][] = [
	["?", "atalhos"],
	["/", "comandos"],
	["!", "shell"],
	["esc", "interrompe"],
];

// O logo é o do core (nycodeLogoLines): 4 colunas × 2 linhas; o Apple Terminal recebe o wordmark de texto.
export function logoLines(): [string, string] {
	return supportsNycodeLogo() ? nycodeLogoLines() : [`${nycodeWordmark()}  `, "    "];
}

/** Contexto em tokens legível: 200000 → 200k, 1000000 → 1M. */
export function formatTokens(n: number): string {
	if (!(n > 0)) return "";
	if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
	return `${Math.round(n / 1e3)}k`;
}

/** Caminho com ~ no lugar da home. */
export function tildePath(cwd: string, home = homedir()): string {
	return cwd === home ? "~" : cwd.startsWith(home + sep) ? `~${cwd.slice(home.length)}` : cwd;
}

/** Junta segmentos e descarta os de menor prioridade (os últimos) até caber; trunca só o que sobrar. */
function clip(prefix: string, segs: string[], gap: string, width: number): string {
	const s = [...segs];
	while (s.length > 1 && visibleWidth(prefix + s.join(gap)) > width) s.pop();
	return truncateToWidth(prefix + s.join(gap), Math.max(0, width));
}

/** Duas linhas: identidade (nycode, modelo, raciocínio, contexto) + lugar (pasta, branch), e atalhos. */
export function buildHeaderLines(p: HeaderParts, theme: Style, width: number): string[] {
	const dim = (s: string) => theme.fg("dim", s);
	const [top, bottom] = logoLines();
	const id = [`${theme.fg("accent", theme.bold("nycode"))} ${dim(p.version)}`];
	if (p.model) id.push(theme.bold(theme.fg("text", p.model)));
	if (p.thinking) id.push(`${theme.fg("muted", icon("think"))} ${theme.fg("muted", p.thinking)}`);
	if (p.context) id.push(`${theme.fg("muted", p.context)} ${dim("ctx")}`);
	const branch = p.branch ? `  ${dim(icon("branch"))} ${theme.fg("mdLink", p.branch)}` : "";
	id.push(theme.fg("muted", tildePath(p.cwd)) + branch);
	const hints = HINTS.map(([k, label]) => `${theme.fg("accent", k)} ${dim(label)}`);
	return [clip(` ${top}  `, id, dim("  ·  "), width), clip(` ${bottom}  `, hints, "   ", width)];
}

export function gitBranch(cwd: string): string {
	try {
		return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
			cwd,
			timeout: 500,
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
	} catch {
		return "";
	}
}

export default function (nycode: ExtensionAPI) {
	nycode.on("session_start", (_e, ctx) => {
		if (!ctx.hasUI || process.env.NYCODE_SUBAGENT === "1" || noColor()) return;
		const branch = gitBranch(ctx.cwd);
		ctx.ui.setHeader((_tui, theme) => ({
			render: (width: number) => {
				const thinking = ctx.model?.reasoning ? nycode.getThinkingLevel() : "";
				const context = formatTokens(ctx.model?.contextWindow ?? 0);
				return buildHeaderLines(
					{ version: VERSION, model: ctx.model?.id ?? "", cwd: ctx.cwd, branch, thinking, context },
					theme,
					width,
				);
			},
			invalidate() {},
		}));
	});
}
