import { truncateToWidth } from "@nycode/tui";

/** stdout split into non-empty trimmed rows: one row goes to the footer segment, 2+ to the
 * widget (left-padded). Nothing lands in both. */
export function statusRows(stdout: string, padding: number): { footer: string | undefined; rows: string[] } {
	const rows = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const pad = " ".repeat(padding);
	if (rows.length === 0) return { footer: undefined, rows: [] };
	if (rows.length === 1) return { footer: `${pad}${rows[0]}${pad}`, rows: [] };
	return { footer: undefined, rows: rows.map((row) => pad + row) };
}

/** Each row cut to the render width (ANSI-aware); a string[] widget would wrap instead. Absorbed
 * extension statuses (the plan's 📋 n/m) close the last row, the tools one, with the HUD's separator. */
export function renderStatusRows(rows: string[], width: number, trailers: Array<string | undefined> = []): string[] {
	const tail = trailers.filter((t): t is string => !!t).join(" | ");
	const all = tail && rows.length > 0 ? [...rows.slice(0, -1), `${rows.at(-1)} | ${tail}`] : rows;
	return all.map((row) => truncateToWidth(row, width));
}

/** Extension statuses the HUD shows on its tools row instead of the footer (user request 2026-11-13). */
const ABSORBED = ["plan-mode"];
/** The footer-no-stats extension publishes its provider here once. */
export const FOOTER_BRIDGE_CHANNEL = "pi-code:footer-bridge";
interface FooterBridge {
	footerData: { getExtensionStatuses(): ReadonlyMap<string, string> };
	absorbed: Set<string>;
	/** Set while the widget is folded: the footer then drops every extension status (bypass warning included). */
	folded?: boolean;
}

/** Live view of the footer's statuses: read at render time, and the keys it shows are claimed so the
 * footer drops them while the widget is up (and shows them again when it goes). */
export function hudFooterBridge() {
	let bridge: FooterBridge | undefined;
	let claimed = false;
	const apply = (): void => {
		for (const k of ABSORBED) claimed ? bridge?.absorbed.add(k) : bridge?.absorbed.delete(k);
	};
	return {
		/** A footer built after the widget gets the current claim too. */
		attach(data: unknown): void {
			const b = data as FooterBridge | null;
			if (typeof b?.footerData?.getExtensionStatuses !== "function" || !(b.absorbed instanceof Set)) return;
			bridge = b;
			apply();
		},
		trailers: (): Array<string | undefined> =>
			bridge ? ABSORBED.map((k) => bridge!.footerData.getExtensionStatuses().get(k)) : [],
		claim(shown: boolean): void {
			claimed = shown;
			if (!shown) this.fold(false);
			apply();
		},
		fold(folded: boolean): void {
			if (bridge) bridge.folded = folded;
		},
	};
}
