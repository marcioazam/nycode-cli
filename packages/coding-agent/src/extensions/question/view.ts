/** Rendering of the question overlay (options list, detail panel, editor) and of the result block in the chat. */

import { type Editor, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@nycode/tui";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import {
	batchHeader,
	type EditKind,
	isRecommended,
	navFooter,
	type Tab,
	tabsLine,
} from "../_shared/ui/question-nav.ts";
import type { DisplayOption } from "./types.ts";

function checkbox(checked: boolean | undefined): string {
	if (checked === undefined) return "";
	return checked ? "[x] " : "[ ] ";
}

/** Shown in the overlay in place of the free-text option's label; the label itself
 * stays the logic value (`isOther` is what the code keys on). */
const OTHER_LABEL = "Outra resposta…";

/** A trailing "(…)" in a label (e.g. "(Recomendado · ~80%)") is shown as a dim tag after it, not as part of the label. */
const LABEL_TAG = /^(.*\S)\s*\(([^()]*)\)\s*$/;
const tagOf = (text: string): string => text.toLowerCase().replaceAll("recomendado", "recomendada");

/** Question icon: two speech bubbles where a Nerd Font is known to render (kitty or NYCODE_NERD_FONT=1; ASCII request wins), else `?`. */
export const questionGlyph = (env: Record<string, string | undefined> = process.env): string => {
	const ascii = Boolean(env.NYCODE_ASCII_ICONS) || env.TERM === "dumb" || env.TERM === "linux";
	return !ascii && (env.NYCODE_NERD_FONT === "1" || env.TERM === "xterm-kitty" || Boolean(env.KITTY_WINDOW_ID))
		? "\ueac7"
		: "?";
};
/** Space after the glyph: kitty draws a Nerd Font icon over the following cell, so there it takes two to keep a gap. */
const glyphGap = (env: Record<string, string | undefined>): string => {
	const ascii = Boolean(env.NYCODE_ASCII_ICONS) || env.TERM === "dumb" || env.TERM === "linux";
	return !ascii && (env.TERM === "xterm-kitty" || Boolean(env.KITTY_WINDOW_ID)) ? "  " : " ";
};

export interface QuestionView {
	width: number;
	question: string;
	header?: string;
	options: DisplayOption[];
	optionIndex: number;
	editMode: boolean;
	multiSelect: boolean;
	checked: boolean[];
	editor: Editor;
	theme: Theme;
	/** Claude: "You see a countdown for the last 20 seconds." Undefined the rest of
	 * the idle window, and always when there is no configured timeout at all. */
	countdownSeconds?: number;
	/** Batch of questions: tabs in the header and the ←→ footer hint. */
	batch?: { tabs: Tab[]; current: number };
	/** `e` toggle: every option's description instead of the focused one's. */
	expanded?: boolean;
	/** What the editor is for; free text when unset. */
	editKind?: EditKind;
}

export function buildQuestionLines(view: QuestionView): string[] {
	const {
		width,
		question,
		header,
		options,
		optionIndex,
		editMode,
		multiSelect,
		checked,
		editor,
		theme,
		countdownSeconds,
		batch,
		expanded,
		editKind = "free",
	} = view;
	const lines: string[] = [];
	const add = (s: string) => lines.push(truncateToWidth(s, width));

	// Variant B: a short numbered list (title only, owner 2026-11-15), the recommended option marked with a star at the
	// right, and a detail panel with the full description of the focused option only. The panel keeps the height of
	// the tallest description so the dialog does not jump while moving. Nothing is cut with "...".
	const wrapped = (text: string, indent: string): string[] =>
		wrapTextWithAnsi(text, Math.max(1, width - indent.length)).map((row) => indent + row);
	const kind = theme.fg("dim", multiSelect ? "escolha um ou mais" : "escolha uma");
	const title = ` ${theme.fg("accent", questionGlyph())}${glyphGap(process.env)}${theme.bold("pergunta")}${header && !batch ? theme.fg("dim", ` · ${header}`) : ""}`;
	add(theme.fg("accent", "─".repeat(width)));
	if (batch)
		for (const row of batchHeader(
			title,
			tabsLine(batch.tabs, batch.current, theme),
			theme.fg(
				"dim",
				`${batch.current + 1}/${batch.tabs.length} · ${multiSelect ? "escolha um ou mais" : "escolha uma"}`,
			),
			width,
		))
			add(row);
	else add(`${title}${" ".repeat(Math.max(2, width - visibleWidth(title) - visibleWidth(kind) - 1))}${kind}`);
	for (const row of wrapped(question, " ")) lines.push(theme.fg("text", row));
	lines.push("");

	const parts = options.map((opt) => {
		const m = opt.isOther === true ? null : LABEL_TAG.exec(opt.label);
		return { label: opt.isOther === true ? OTHER_LABEL : m ? m[1] : opt.label, tag: m ? tagOf(m[2]) : "" };
	});
	const anyDescription = options.some((o) => o.description);
	for (let i = 0; i < options.length; i++) {
		const opt = options[i];
		const focus = i === optionIndex;
		const box = multiSelect && opt.isOther !== true ? checkbox(checked[i]) : "";
		const edit = opt.isOther === true && editMode && editKind === "free" ? " ✎" : "";
		const tag = parts[i].tag
			? parts[i].tag.startsWith("recomendada")
				? theme.fg("syntaxType", `★ ${parts[i].tag}`)
				: theme.fg("dim", parts[i].tag)
			: "";
		const label = `${box}${parts[i].label}${edit}`;
		const head = ` ${focus ? theme.fg("accent", theme.bold(`❯ ${i + 1}`)) : `  ${theme.fg("dim", String(i + 1))}`}  ${focus ? theme.fg("accent", theme.bold(label)) : theme.fg("text", label)}`;
		const left = head;
		const row = truncateToWidth(
			tag ? `${left}${" ".repeat(Math.max(2, width - visibleWidth(left) - visibleWidth(tag) - 1))}${tag}` : left,
			width,
		);
		// Recommended option: system-palette cyan (theme token syntaxType = vars.cyan, owner 2026-11-15) on the bluish toolPendingBg across the whole row, focused or not. A reset inside the
		// row (truncation closes colors) would drop it, so it is reopened.
		const paint =
			parts[i].tag.startsWith("recomendada") && typeof theme.bg === "function"
				? (x: string) => theme.bg("toolPendingBg", x)
				: undefined;
		if (!paint) lines.push(row);
		else {
			const open = paint("\u0000").split("\u0000")[0] ?? "";
			lines.push(
				paint(
					row.replace(/\x1b\[(?:0|49)?m/g, (m) => m + open) + " ".repeat(Math.max(0, width - visibleWidth(row))),
				),
			);
		}
	}

	if (anyDescription && expanded) {
		for (let i = 0; i < options.length; i++) {
			if (!options[i].description) continue;
			lines.push("");
			add(` ${theme.fg("accent", parts[i].label)}`);
			for (const row of wrapped(options[i].description as string, " ")) lines.push(theme.fg("text", row));
		}
	} else if (anyDescription) {
		const panels = options.map((o) => (o.description ? wrapped(o.description, " ") : []));
		const height = Math.max(...panels.map((p) => p.length));
		const name = parts[optionIndex]?.label ?? "";
		lines.push("");
		add(
			` ${theme.fg("dim", "─── ")}${theme.fg("accent", name)} ${theme.fg("dim", "─".repeat(Math.max(0, width - visibleWidth(name) - 7)))}`,
		);
		const rows = panels[optionIndex] ?? [];
		for (let r = 0; r < height; r++) lines.push(r < rows.length ? theme.fg("text", rows[r]) : "");
	}

	if (editMode) {
		lines.push("");
		add(
			theme.fg(
				"muted",
				editKind === "free" ? " Sua resposta:" : editKind === "note" ? " Nota (opcional):" : " Motivo (opcional):",
			),
		);
		for (const line of editor.render(width - 2)) {
			add(` ${line}`);
		}
	}

	lines.push("");
	add(
		theme.fg(
			"dim",
			editMode
				? " ⏎ envia · esc volta"
				: navFooter({
						multi: multiSelect,
						count: options.length,
						batch: batch !== undefined,
						rec: options.some(isRecommended),
						width,
					}),
		),
	);
	if (countdownSeconds !== undefined) {
		add(theme.fg("warning", ` Auto-continuing in ${countdownSeconds}s if idle · press any key to stay`));
	}
	add(theme.fg("accent", "─".repeat(width)));

	return lines;
}

/** One option row: a trailing "(…)" in the label moves after it, dim, lowercase, no parentheses. */
function optionRow(label: string, mark: "on" | "off" | "pending", theme: Theme): string {
	const m = LABEL_TAG.exec(label);
	const text = m ? m[1] : label;
	const suffix = m ? `  ${theme.fg("dim", tagOf(m[2]))}` : "";
	if (mark === "on") return `  ${theme.fg("success", "●")} ${theme.fg("text", text)}${suffix}`;
	const tone = mark === "pending" ? "muted" : "dim";
	return `  ${theme.fg(tone, "○")} ${theme.fg(tone, text)}${suffix}`;
}

export interface QuestionView1 {
	question: string;
	header?: string;
	labels: string[];
	multiSelect?: boolean;
	/** Undefined while awaiting the answer; null when cancelled. */
	answer?: string | null;
	wasCustom?: boolean;
	timedOut?: boolean;
	skipped?: boolean;
	delegated?: boolean;
	note?: string;
	pending?: boolean;
}

/** Result block of one question (variant A): state + icon + title + ANSWER on the header, the question below behind a
 * rail; the option list only when expanded. `hint` is the expand key text. */
function questionBlock(v: QuestionView1, theme: Theme, expanded: boolean, hint: string): string[] {
	// Fixed title; the model's short label (header) follows, dimmed: alone it reads as a stray word.
	const title =
		theme.fg("toolTitle", theme.bold("pergunta")) + (v.header ? ` ${theme.fg("dim", `· ${v.header}`)}` : "");
	const answer = v.answer ?? "";
	const cancelled = v.answer === null;
	const failed = cancelled || (v.timedOut === true && answer === "");
	const shown = v.wasCustom || v.multiSelect ? answer : (LABEL_TAG.exec(answer)?.[1] ?? answer);
	const outcome = v.skipped
		? `${theme.fg("dim", "↷ pulada")} ${theme.fg("dim", "· o agente decide")}`
		: v.delegated
			? `${theme.fg("accent", "decide você")}${v.note ? theme.fg("dim", ` · ${v.note}`) : ""}`
			: v.pending
				? `${theme.fg("dim", "não respondida")}`
				: cancelled
					? `${theme.fg("warning", "cancelada")} ${theme.fg("dim", "· sem resposta")}`
					: failed
						? `${theme.fg("warning", "tempo esgotado")} ${theme.fg("dim", "· seguiu sem resposta")}`
						: theme.fg("success", shown) + (v.note ? theme.fg("dim", ` · nota: ${v.note}`) : "");
	// Sem ícone de estado no chat (dono, 2026-11-15): a resposta já diz o estado na cor dele; os 2 espaços mantêm o ícone na coluna das tools.
	const state = v.answer === undefined ? "" : "  ";
	const rail = theme.fg("dim", "│");
	const asked = v.question.split("\n").map((row) => `${rail} ${theme.fg("muted", row)}`);
	asked[asked.length - 1] += theme.fg("dim", ` · ${hint} ${expanded ? "fecha" : "abre"}`);
	const lines = [
		`${state}${theme.fg("accent", questionGlyph())}${glyphGap(process.env)}${title}  ${outcome}`,
		...asked,
	];
	if (!expanded) return lines;
	for (const label of v.labels) {
		const hit =
			failed || v.wasCustom ? false : v.multiSelect ? `, ${answer}, `.includes(`, ${label}, `) : answer === label;
		lines.push(`${rail} ${optionRow(label, hit ? "on" : "off", theme).trimStart()}`);
	}
	if (v.wasCustom && !failed) lines.push(`${rail} ${theme.fg("success", "●")} ${theme.fg("text", answer)}`);
	return lines;
}

export const blocks = (views: QuestionView1[], theme: Theme, expanded: boolean, hint: string): Text =>
	new Text(views.map((v) => questionBlock(v, theme, expanded, hint).join("\n")).join("\n\n"), 0, 0);
