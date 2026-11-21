import * as fs from "node:fs";
import * as path from "node:path";
import type { ThemeColor } from "../../modes/interactive/theme/theme-tokens.ts";

/** Session-start notice: `◆ memória  11 notas · 7 projeto · … · /memory`. Types come from each note's `type` frontmatter;
 * a note without one, with an unknown one, missing or outside the memory directory counts as "sem tipo". */
const NOTICE_TYPES: Array<[string, string]> = [
	["project", "projeto"],
	["feedback", "orientação"],
	["user", "usuário"],
	["reference", "referência"],
	["", "sem tipo"],
];
type NoticeTheme = { fg: (color: ThemeColor, text: string) => string; bold?: (text: string) => string };
/** Minimal brain glyph where a Nerd Font is known to render (kitty or NYCODE_NERD_FONT=1; ASCII request wins), else a diamond. */
const memoryGlyph = (env: Record<string, string | undefined>): string => {
	const ascii = Boolean(env.NYCODE_ASCII_ICONS) || env.TERM === "dumb" || env.TERM === "linux";
	return !ascii && (env.NYCODE_NERD_FONT === "1" || env.TERM === "xterm-kitty" || Boolean(env.KITTY_WINDOW_ID))
		? "\uee9c"
		: "◆";
};
/** Space after the glyph: kitty draws a Nerd Font icon over the following cell, so there it takes two to keep a gap. */
const glyphGap = (env: Record<string, string | undefined>): string => {
	const ascii = Boolean(env.NYCODE_ASCII_ICONS) || env.TERM === "dumb" || env.TERM === "linux";
	return !ascii && (env.TERM === "xterm-kitty" || Boolean(env.KITTY_WINDOW_ID)) ? "  " : " ";
};

export function memoryNotice(
	dir: string,
	index: string,
	theme?: NoticeTheme,
	env: Record<string, string | undefined> = process.env,
): string | undefined {
	const entries = index.split("\n").filter((l) => l.startsWith("- "));
	if (entries.length === 0) return undefined;
	const counts = new Map<string, number>();
	for (const line of entries) {
		let type = "";
		const file = /\]\(([^)]+)\)/.exec(line)?.[1];
		if (file && path.dirname(path.resolve(dir, file)) === path.resolve(dir)) {
			try {
				const head = fs.readFileSync(path.resolve(dir, file), "utf8").slice(0, 400);
				const found = /^---\n[\s\S]*?^type:[ \t]*(\w+)/m.exec(head)?.[1] ?? "";
				if (NOTICE_TYPES.some(([key]) => key === found)) type = found;
			} catch {
				// unreadable note: counted as "sem tipo"
			}
		}
		counts.set(type, (counts.get(type) ?? 0) + 1);
	}
	const byType = NOTICE_TYPES.filter(([key]) => counts.has(key))
		.sort((a, b) => counts.get(b[0])! - counts.get(a[0])!)
		.map(([key, label]) => `${counts.get(key)} ${label}`)
		.join(" · ");
	const fg = theme
		? (color: ThemeColor, text: string) => theme.fg(color, text)
		: (_color: ThemeColor, text: string) => text;
	const bold = theme?.bold ? (text: string) => theme.bold!(text) : (text: string) => text;
	const total = `${entries.length} ${entries.length === 1 ? "nota" : "notas"}`;
	return `${fg("accent", memoryGlyph(env))}${glyphGap(env)}${fg("text", bold("memória"))}  ${fg("muted", total)} ${fg("dim", "·")} ${fg("muted", byType)} ${fg("dim", "· /memory")}`;
}
