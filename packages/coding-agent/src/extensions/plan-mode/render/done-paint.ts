/** Colours of the plan done-tags (`[DONE:n]` rendering): theme RGB mixing, pill boxes and the live progress comet. */

import type { ExtensionContext } from "../../../core/extensions/types.ts";
import { type DonePaint, plainPaint } from "./done-view.ts";

const parseRgb = (ansi: string | undefined): [number, number, number] | undefined => {
	const m = /[34]8;2;(\d+);(\d+);(\d+)/.exec(ansi ?? "");
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
};
const relLum = (c: readonly number[]): number =>
	0.2126 * (c[0]! / 255) ** 2.2 + 0.7152 * (c[1]! / 255) ** 2.2 + 0.0722 * (c[2]! / 255) ** 2.2;
const tintBox = (base: readonly number[], fg: readonly number[], ratio: number): [number, number, number] => {
	const mix = base.map((b, k) => b * (1 - ratio) + fg[k]! * ratio);
	const f = (relLum(base) / Math.max(relLum(mix), 1e-6)) ** (1 / 2.2);
	return mix.map((v) => Math.max(0, Math.min(255, Math.round(v * f)))) as [number, number, number];
};
const pillFrom = (s: string, boxRgb: readonly number[] | undefined): string => {
	if (!boxRgb) return s;
	const dark = relLum(boxRgb) < 0.25;
	const c = boxRgb.map((v, i) => Math.round(v * (dark ? 0.64 : 0.92) + (dark ? [10, 11, 18][i]! * 0.36 : 0)));
	const open = `\x1b[48;2;${c.join(";")}m`;
	return `${open} ${s.replace(/\x1b\[(?:0|49)?m/g, (m) => m + open)} \x1b[49m`;
};
export const fmtSent = (ms: number): string => {
	const d = new Date(ms);
	const pad2 = (n: number) => String(n).padStart(2, "0");
	return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
/** The done-tag paint for the session theme (plain when there is no theme or the context is stale); `isStreaming` animates the progress bar. */
export function donePaint(ctx: ExtensionContext | undefined, isStreaming: boolean | undefined): DonePaint {
	let paint: DonePaint = plainPaint;
	try {
		const theme = ctx?.ui.theme as unknown as
			| {
					fg: (c: string, s: string) => string;
					bg: (c: string, s: string) => string;
					bold: (s: string) => string;
					getFgAnsi?: (c: string) => string;
					getBgAnsi?: (c: string) => string;
			  }
			| undefined;
		if (theme) {
			const baseRgb = parseRgb(theme.getBgAnsi?.("customMessageBg"));
			const waitRgb = parseRgb(theme.getFgAnsi?.("mdCode"));
			const warnRgb = parseRgb(theme.getFgAnsi?.("warning"));
			const dimRgb = parseRgb(theme.getFgAnsi?.("dim"));
			const cyanRgb = parseRgb(theme.getFgAnsi?.("syntaxType"));
			const waitBgRgb = baseRgb && waitRgb ? tintBox(baseRgb, waitRgb, 0.16) : undefined;
			const warnBgRgb = baseRgb && warnRgb ? tintBox(baseRgb, warnRgb, 0.2) : undefined;
			const liveComet = Boolean(
				isStreaming &&
					dimRgb &&
					(cyanRgb ?? waitRgb) &&
					!process.env.NYCODE_REDUCED_MOTION &&
					process.env.NO_COLOR === undefined,
			);
			paint = {
				ok: (s) => theme.fg("success", s),
				muted: (s) => theme.fg("muted", s),
				dim: (s) => theme.fg("dim", s),
				text: (s) => theme.fg("text", s),
				run: (s) => theme.fg("syntaxType", s),
				wait: (s) => theme.fg("mdCode", s),
				warn: (s) => theme.fg("warning", s),
				accent: (s) => theme.fg("accent", s),
				bold: (s) => theme.bold(s),
				box: (s) => theme.bg("customMessageBg", s),
				waitBox: waitBgRgb ? (s) => `\x1b[48;2;${waitBgRgb.join(";")}m${s}\x1b[49m` : undefined,
				warnBox: warnBgRgb ? (s) => `\x1b[48;2;${warnBgRgb.join(";")}m${s}\x1b[49m` : undefined,
				pill: (s, kind) =>
					pillFrom(
						s,
						kind === "wait" ? (waitBgRgb ?? baseRgb) : kind === "warn" ? (warnBgRgb ?? baseRgb) : baseRgb,
					),
				bar: liveComet
					? (filled, cells) => {
							const donePart = filled > 0 ? theme.fg("success", "━".repeat(filled)) : "";
							const rem = Math.max(0, cells - filled);
							if (rem === 0) return donePart;
							const target = (cyanRgb ?? waitRgb)!;
							const pos = rem === 1 ? 0 : ((Math.sin(performance.now() * 0.0048) + 1) / 2) * (rem - 1);
							let tail = "";
							for (let i = 0; i < rem; i++) {
								const g = Math.exp(-((i - pos) ** 2) / 1.15);
								const c = dimRgb!.map((v, idx) => Math.round(v + (target[idx]! - v) * g));
								tail += `\x1b[38;2;${c.join(";")}m${g > 0.62 ? "━" : "╌"}`;
							}
							return `${donePart}${tail}\x1b[39m`;
						}
					: undefined,
			};
		}
	} catch {
		// contexto de sessão antiga: sem cor
	}
	return paint;
}
