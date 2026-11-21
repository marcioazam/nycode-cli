/**
 * Live transcript viewer of one run (any depth) and the /tasks browser, both overlays.
 * Record: docs/pi-agent-fleet-2026-11-12.md (A3, A5, A8).
 */

import type { Component } from "@nycode/tui";
import {
	decodeKittyPrintable,
	isKeyRelease,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@nycode/tui";
import type { ExtensionContext } from "../../../core/extensions/types.ts";

import { formatDuration, formatTokens } from "../../_shared/goal/goal-evaluator.ts";
import type { FleetSource, RunRecord, SendOutcome, TranscriptItem } from "../fleet/types.ts";
import { conversationItems } from "../team/ui.ts";
import type { UiTheme } from "./panel.ts";
import { ARM_MS, formatCost, renderRow, stopMessage, superscript } from "./panel.ts";
import { hudTheme, motionEnabled, spinnerAt } from "./style/palette.ts";
import { runtimeSummary } from "./style/runtime-label.ts";
import { buildRows, chainOf, neighbours } from "./view-model.ts";

/** Count of our open overlays; the panel passes all input through while it is above 0. */
export const overlays = { open: 0 };

export const MAX_ITEMS = 2000;
export const POLL_MS = 500;
const RESULT_LINES = 3;
/** Rows of chrome around the body: rule, header (2), outcome, input, hints. */
const CHROME_ROWS = 6;

/** Top edge of both overlays: they draw over the chat, so they need a visible boundary. */
const rule = (theme: UiTheme, width: number): string => theme.fg("borderAccent", "─".repeat(Math.max(0, width)));

export const PLACEHOLDER = "Mensagem para este agente";
export const READ_ONLY_TEXT = "somente leitura: o agente já terminou";

// ---- pure formatters ---------------------------------------------------------------

export function sendOutcomeText(outcome: SendOutcome): string {
	switch (outcome) {
		case "queued":
			return "↪ enviada; o agente lê depois do passo atual";
		case "resumed":
			return "↪ retomado com a sua mensagem";
		case "not-running":
			return "o agente já terminou; mensagem não enviada";
		default:
			return "agente não encontrado";
	}
}

export function formatItem(item: TranscriptItem, theme: UiTheme, width: number): string[] {
	const fitLines = (lines: string[], color: string, indent = ""): string[] =>
		lines.map((l) => truncateToWidth(indent + theme.fg(color, l), width));
	const wrap = (text: string): string[] => {
		const lines = wrapTextWithAnsi(text, Math.max(1, width));
		return lines.length > 0 ? lines : [""];
	};
	switch (item.kind) {
		case "user":
			return fitLines(wrap(`› ${item.text}`), "accent");
		case "assistant":
			return fitLines(wrap(item.text), "text");
		case "tool_call":
			return fitLines([`⏺ ${item.text.replace(/\s+/g, " ")}`], "muted");
		case "tool_result": {
			const all = item.text.split("\n");
			const color = item.isError ? "error" : "dim";
			const shown = all.slice(0, RESULT_LINES);
			const out = shown.map((l, i) => truncateToWidth(theme.fg(color, (i === 0 ? "  ⎿ " : "    ") + l), width));
			if (all.length > RESULT_LINES)
				out.push(truncateToWidth(theme.fg("dim", `  … mais ${all.length - RESULT_LINES} linhas`), width));
			return out;
		}
		default:
			return fitLines(wrap(item.text), item.tool === "team" ? "warning" : "dim");
	}
}

export function stateLabel(state: RunRecord["state"]): string {
	return state === "running"
		? "● rodando"
		: state === "done"
			? "✓ concluído"
			: state === "failed"
				? "✗ falhou"
				: "■ parado";
}

const STATE_COLOR: Partial<Record<RunRecord["state"], string>> = {
	running: "accent",
	done: "success",
	failed: "error",
};

export function breadcrumb(records: readonly RunRecord[], id: string): string {
	const chain = chainOf(records, id);
	const parts = chain.map((r, i) => (i === 0 ? r.agent : `${r.agent}${superscript(i + 1)}`));
	return ["main", ...parts].join(" › ");
}

/** Two header rows: path left, state and numbers right (the left side is cut first, never the state); runtime and neighbours below. */
export function headerLines(
	records: readonly RunRecord[],
	id: string,
	nowMs: number,
	theme: UiTheme,
	width: number,
): [string, string] {
	const rec = records.find((r) => r.id === id);
	const crumb = rec ? breadcrumb(records, id) : "main › (agente não encontrado)";
	const right = rec
		? theme.fg(STATE_COLOR[rec.state] ?? "dim", stateLabel(rec.state)) +
			theme.fg(
				"dim",
				` · ${formatDuration((rec.endedAt ?? nowMs) - rec.startedAt)} · ${formatTokens(rec.tokens.context)} tok · ${formatCost(rec.cost)}`,
			)
		: "";
	const room = width - visibleWidth(right) - 1;
	const left = theme.bold(truncateToWidth(crumb, Math.max(0, room), "…"));
	const gap = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
	const first = !right ? left : room >= 1 ? `${left}${gap}${right}` : right;
	if (!rec) return [truncateToWidth(first, width), ""];
	const { siblings, children } = neighbours(records, id);
	const names = (list: RunRecord[]): string => list.map((r) => r.agent).join(", ");
	const others = siblings.filter((r) => r.id !== id);
	const second = [
		runtimeSummary(rec),
		...(others.length ? [`ao lado: ${names(others)}`] : []),
		...(children.length ? [`filhos: ${names(children)}`] : []),
	].join(" · ");
	return [truncateToWidth(first, width), truncateToWidth(theme.fg("dim", second), width)];
}

const isReadOnly = (rec: RunRecord): boolean => rec.state !== "running" && !(rec.depth === 1 && rec.background);

/** Hint row: only the actions the viewer can take now. Armed stop replaces it with the confirmation. */
export function hintLine(records: readonly RunRecord[], id: string, armed: boolean): { text: string; warn: boolean } {
	const rec = records.find((r) => r.id === id);
	if (armed && rec)
		return { text: `▲ x de novo para parar ${rec.agent} · o trabalho em andamento se perde · esc fecha`, warn: true };
	const nb = neighbours(records, id);
	const hints = [
		"↑↓ rolar",
		...(nb.siblings.length > 1 ? ["←→ outro agente"] : []),
		...(nb.children.length ? ["tab filho"] : []),
		...(nb.parent ? ["⇧tab pai"] : []),
		...(rec && !isReadOnly(rec) ? ["⏎ enviar"] : []),
		...(rec?.state === "running" ? ["x x parar"] : []),
		"esc fechar",
	];
	return { text: hints.join(" · "), warn: false };
}

function printable(data: string): string | undefined {
	const k = decodeKittyPrintable(data);
	if (k !== undefined) return k;
	return /^[^\x00-\x1f\x7f]+$/u.test(data) ? data : undefined;
}

// ---- viewer ------------------------------------------------------------------------

export interface ViewerDeps {
	source: FleetSource;
	theme: UiTheme;
	id: string;
	done: () => void;
	requestRender: () => void;
	/** Terminal rows, for the body height. */
	rows: () => number;
	now: () => number;
	/** false in tests: no timers. */
	poll?: boolean;
}

export class ViewerComponent implements Component {
	id: string;
	items: TranscriptItem[] = [];
	input = "";
	outcome = "";
	private fromBottom = 0;
	private offset = 0;
	private teamOffset = 0;
	private armedUntil = 0;
	private lines: string[] | undefined;
	private lastWidth = 0;
	private timer: ReturnType<typeof setInterval> | undefined;
	private unsubscribe: (() => void) | undefined;
	private readonly deps: ViewerDeps;

	constructor(deps: ViewerDeps) {
		this.deps = deps;
		this.id = deps.id;
		this.refresh();
		if (deps.poll !== false) {
			this.timer = setInterval(() => this.refresh(), POLL_MS);
			this.timer.unref?.();
			this.unsubscribe = deps.source.onChange(() => this.refresh());
		}
	}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
	}

	/** Reads the transcript increment and asks for a render when it changed anything. */
	refresh(): void {
		const { items, next } = this.deps.source.readTranscript(this.id, this.offset);
		this.offset = next;
		const talk = conversationItems(this.id, this.teamOffset);
		this.teamOffset = talk.next;
		if (items.length > 0 || talk.items.length > 0) {
			const merged = [...this.items, ...items, ...talk.items];
			this.items = (talk.items.length > 0 ? merged.sort((a, b) => a.t - b.t) : merged).slice(-MAX_ITEMS);
			this.lines = undefined;
		}
		this.deps.requestRender();
	}

	invalidate(): void {
		this.lines = undefined;
	}

	private switchTo(id: string | undefined): void {
		if (!id || id === this.id) return;
		this.id = id;
		this.items = [];
		this.offset = 0;
		this.teamOffset = 0;
		this.fromBottom = 0;
		this.input = "";
		this.outcome = "";
		this.armedUntil = 0;
		this.lines = undefined;
		this.refresh();
	}

	private bodyHeight(): number {
		return Math.max(3, Math.floor(this.deps.rows() * 0.85) - CHROME_ROWS);
	}

	private bodyLines(width: number): string[] {
		if (!this.lines || this.lastWidth !== width) {
			this.lines = this.items.flatMap((item) => formatItem(item, this.deps.theme, width));
			this.lastWidth = width;
		}
		return this.lines;
	}

	render(width: number): string[] {
		const { theme } = this.deps;
		const fitTruncated = (s: string): string => truncateToWidth(s, width);
		const records = this.deps.source.list();
		const rec = records.find((r) => r.id === this.id);
		const all = this.bodyLines(width);
		const h = this.bodyHeight();
		this.fromBottom = Math.max(0, Math.min(this.fromBottom, all.length - h));
		const end = all.length - this.fromBottom;
		const body = all.slice(Math.max(0, end - h), end);
		while (body.length < h) body.push("");
		const readOnly = rec !== undefined && isReadOnly(rec);
		const outcome = this.outcome || (readOnly ? READ_ONLY_TEXT : "");
		const hint = hintLine(records, this.id, this.deps.now() < this.armedUntil);
		return [
			rule(theme, width),
			...headerLines(records, this.id, this.deps.now(), theme, width),
			...body.map(fitTruncated),
			fitTruncated(theme.fg("dim", outcome)),
			fitTruncated(`${theme.fg("accent", "❯")} ${this.input || (readOnly ? "" : theme.fg("dim", PLACEHOLDER))}`),
			fitTruncated(theme.fg(hint.warn ? "warning" : "dim", hint.text)),
		];
	}

	private scroll(delta: number): void {
		this.fromBottom = Math.max(0, this.fromBottom - delta);
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		const { source } = this.deps;
		const empty = this.input === "";
		const records = source.list();
		const nb = neighbours(records, this.id);
		const body = this.bodyHeight();
		if (matchesKey(data, "escape")) {
			if (!empty) this.input = "";
			else this.deps.done();
		} else if (matchesKey(data, "up")) this.scroll(-1);
		else if (matchesKey(data, "down")) this.scroll(1);
		else if (matchesKey(data, "pageUp")) this.scroll(-body);
		else if (matchesKey(data, "pageDown")) this.scroll(body);
		else if (matchesKey(data, "home")) this.fromBottom = Number.MAX_SAFE_INTEGER;
		else if (matchesKey(data, "end")) this.fromBottom = 0;
		else if ((matchesKey(data, "left") || matchesKey(data, "right")) && empty) {
			const i = nb.siblings.findIndex((r) => r.id === this.id);
			this.switchTo(nb.siblings[i + (matchesKey(data, "left") ? -1 : 1)]?.id);
		} else if (matchesKey(data, "tab")) this.switchTo(nb.children[0]?.id);
		else if (matchesKey(data, "shift+tab")) {
			if (nb.parent) this.switchTo(nb.parent.id);
			else this.deps.done();
		} else if (matchesKey(data, "backspace")) this.input = Array.from(this.input).slice(0, -1).join("");
		else if (matchesKey(data, "enter")) {
			const text = this.input.trim();
			if (text) {
				this.outcome = sendOutcomeText(source.send(this.id, text));
				this.input = "";
				this.fromBottom = 0;
				this.refresh();
			}
		} else if (empty && matchesKey(data, "x")) this.pressStop(records);
		else {
			const ch = printable(data);
			if (ch) this.input += ch;
		}
		this.deps.requestRender();
	}

	private pressStop(records: RunRecord[]): void {
		const rec = records.find((r) => r.id === this.id);
		if (!rec || rec.state !== "running") {
			this.outcome = rec ? "o agente já terminou; nada a parar" : "agente não encontrado";
			return;
		}
		const now = this.deps.now();
		if (now < this.armedUntil) {
			this.armedUntil = 0;
			this.outcome = stopMessage(this.deps.source.stop(this.id), rec.agent).text;
		} else {
			this.armedUntil = now + ARM_MS;
			this.outcome = "";
		}
	}
}

// ---- /tasks browser ----------------------------------------------------------------

export interface TasksDeps {
	source: FleetSource;
	theme: UiTheme;
	done: (id: string | undefined) => void;
	requestRender: () => void;
	rows: () => number;
	now: () => number;
	selectedId?: string;
	poll?: boolean;
}

export class TasksComponent implements Component {
	selectedId: string | undefined;
	private timer: ReturnType<typeof setInterval> | undefined;
	private unsubscribe: (() => void) | undefined;
	private readonly deps: TasksDeps;

	constructor(deps: TasksDeps) {
		this.deps = deps;
		this.selectedId = deps.selectedId;
		if (deps.poll !== false) {
			this.timer = setInterval(() => deps.requestRender(), 1000);
			this.timer.unref?.();
			this.unsubscribe = deps.source.onChange(() => deps.requestRender());
		}
	}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
	}

	invalidate(): void {}

	private list() {
		return buildRows(this.deps.source.list(), { now: this.deps.now(), panel: false, newestRootFirst: true });
	}

	render(width: number): string[] {
		const { theme } = this.deps;
		const rows = this.list();
		const h = Math.max(3, Math.floor(this.deps.rows() * 0.85) - 5);
		const idx = Math.max(
			0,
			rows.findIndex((r) => r.id === this.selectedId),
		);
		const start = Math.max(0, Math.min(idx - Math.floor(h / 2), rows.length - h));
		const out = [
			rule(theme, width),
			truncateToWidth(theme.bold(theme.fg("accent", `Agentes (${rows.length})`)), width),
		];
		rows.slice(start, start + h).forEach((r, i) => {
			out.push(
				renderRow(r, start + i === idx, theme, width, motionEnabled() ? spinnerAt(this.deps.now()) : undefined),
			);
		});
		out.push(truncateToWidth(theme.fg("dim", "↑↓ escolher · ⏎ abrir · esc fechar"), width));
		return out;
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		const rows = this.list();
		const idx = Math.max(
			0,
			rows.findIndex((r) => r.id === this.selectedId),
		);
		if (matchesKey(data, "escape")) {
			this.deps.done(undefined);
			return;
		}
		if (matchesKey(data, "enter")) {
			this.deps.done(rows[idx]?.id);
			return;
		}
		const step = matchesKey(data, "up") ? -1 : matchesKey(data, "down") ? 1 : 0;
		if (step) this.selectedId = rows[Math.max(0, Math.min(rows.length - 1, idx + step))]?.id;
		this.deps.requestRender();
	}
}

// ---- entry points ------------------------------------------------------------------

/** Only what the overlays need from a nycode context (command and event contexts both fit). */
export type UiCtx = Pick<ExtensionContext, "ui" | "hasUI">;

// Anchored at the bottom, over the editor and the panel the user came from (centered, a short list floated mid-chat).
export const OVERLAY_OPTIONS = { anchor: "bottom-center", width: "100%", maxHeight: "85%", margin: 0 } as const;

function termRows(tui: { terminal?: { rows?: number } }): number {
	return tui.terminal?.rows ?? 40;
}

export async function openViewer(ctx: UiCtx, source: FleetSource, id: string): Promise<void> {
	overlays.open += 1;
	try {
		await ctx.ui.custom<void>(
			(tui, theme, _kb, done) =>
				new ViewerComponent({
					source,
					theme: hudTheme(theme),
					id,
					done: () => done(),
					requestRender: () => tui.requestRender(),
					rows: () => termRows(tui),
					now: Date.now,
				}),
			{ overlay: true, overlayOptions: { ...OVERLAY_OPTIONS } },
		);
	} finally {
		overlays.open -= 1;
	}
}

export async function openTasksBrowser(ctx: UiCtx, source: FleetSource): Promise<void> {
	if (source.list().length === 0) {
		ctx.ui.notify("Nenhum agente nesta sessão.", "info");
		return;
	}
	let selectedId: string | undefined;
	for (;;) {
		overlays.open += 1;
		let picked: string | undefined;
		try {
			picked = await ctx.ui.custom<string | undefined>(
				(tui, theme, _kb, done) =>
					new TasksComponent({
						source,
						theme: hudTheme(theme),
						done,
						requestRender: () => tui.requestRender(),
						rows: () => termRows(tui),
						now: Date.now,
						selectedId,
					}),
				{ overlay: true, overlayOptions: { ...OVERLAY_OPTIONS } },
			);
		} finally {
			overlays.open -= 1;
		}
		if (!picked) return;
		selectedId = picked;
		await openViewer(ctx, source, picked);
	}
}
