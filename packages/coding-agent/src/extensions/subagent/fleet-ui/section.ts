/**
 * Shared mechanics of the two collapsible sections under the editor (Sub Agents, Status Line and Plan): viewport size,
 * offset clamp, focus ownership test and the bridge the status line and the fleet panel use to reach the Plan
 * section. Pure apart from the `bridge` singleton, which the Plan section fills in. Record:
 * docs/pi-interactive-display-2026-11-13.md ("Plan section").
 */

/** Plan body rows: at most 6, at least 3, fewer on short terminals. Never unbounded. */
export const MAX_VISIBLE = 6;
export const MIN_VISIBLE = 3;
export const viewportSize = (terminalRows: number): number =>
	Math.max(MIN_VISIBLE, Math.min(MAX_VISIBLE, terminalRows - 18));

/** Offset kept inside [0, total - visible]. */
export const clampOffset = (offset: number, total: number, visible: number): number =>
	Math.max(0, Math.min(offset, Math.max(0, total - visible)));

/** nycode's TUI keeps the focused component private: the editor (getText + setText) owns it; unknown counts as the editor. */
export function editorOwnsFocus(tui: unknown): boolean {
	const focused = (tui as { focusedComponent?: unknown } | undefined)?.focusedComponent;
	if (focused == null) return true;
	const c = focused as { getText?: unknown; setText?: unknown };
	return typeof c.getText === "function" && typeof c.setText === "function";
}

/** Links between the Plan section (plan-mode), the status line and the fleet panel; one process, one section each. */
export interface SectionBridge {
	/** A Plan section is showing (items exist). The status line then keeps its row in the widget, above Plan. */
	planActive(): boolean;
	/** Re-set the Plan widget so it renders after the status widget (nycode moves a re-set widget last). */
	reassertPlan(): void;
	/** Plan appeared, changed visibility or went away: the status line re-places its footer-only row. */
	onPlanChange?: () => void;
}
export const bridge: SectionBridge = {
	planActive: () => false,
	reassertPlan: () => {},
};
