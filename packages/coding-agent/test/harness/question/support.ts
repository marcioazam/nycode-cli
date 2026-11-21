// Shared fixtures of the question-extension tests: fake themes, a fake overlay host and a captured tool.
import type { Editor } from "@nycode/tui";
import type { ExtensionAPI, ExtensionContext } from "../../../src/core/extensions/types.ts";
import questionExtension from "../../../src/extensions/question/index.ts";
import type { DisplayOption, QuestionSpec } from "../../../src/extensions/question/types.ts";
import type { Theme } from "../../../src/modes/interactive/theme/theme.ts";

export const asTheme = (t: object): Theme => t as unknown as Theme;
/** Theme that wraps every token in `<name>` tags; strip() removes them. */
export const tagTheme = asTheme({
	fg: (c: string, s: string) => `<${c}>${s}</${c}>`,
	bold: (s: string) => `<b>${s}</b>`,
});
/** Theme with plain ANSI dim/bold, so `limpo` can drop the escapes. */
export const ansi = asTheme({
	fg: (_c: string, x: string) => `\x1b[2m${x}\x1b[22m`,
	bold: (x: string) => `\x1b[1m${x}\x1b[22m`,
});
export const fakeEditor = { render: () => ["[editor]"] } as unknown as Editor;

/** Removes theme tags until none are left; one pass could leave a new tag behind (CodeQL js/incomplete-multi-character-sanitization). */
export function stripTags(lines: string[]): string {
	let out = lines.join("\n");
	for (let prev = ""; prev !== out; ) {
		prev = out;
		out = out.replace(/<\/?[a-z]+>/gi, "");
	}
	return out;
}

/** Removes SGR escape sequences (`ESC [ ... m`) without a regex literal holding a control character. */
export function stripAnsi(text: string): string {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\x1b" && text[i + 1] === "[") {
			let j = i + 2;
			while (j < text.length && /[0-9;]/.test(text[j])) j++;
			if (text[j] === "m") {
				i = j;
				continue;
			}
		}
		out += text[i];
	}
	return out;
}
export const limpo = (lines: string[]): string[] => lines.map((x) => stripAnsi(x).trimEnd());

export const opts: DisplayOption[] = [{ label: "alpha", description: "primeira" }, { label: "beta" }];
export const other: DisplayOption = { label: "Type something.", isOther: true };

export interface Component {
	render(width: number): string[];
	handleInput(data: string): void;
}
export type Factory = (
	tui: { requestRender(): void; terminal: { rows: number; columns: number } },
	theme: Theme,
	kb: unknown,
	done: (value: unknown) => void,
) => Component;

/** A ctx whose `ui.custom` hands the component to `onOpen`; `ui` is the only part the tool reads besides mode/hasUI. */
export function fakeCtx(custom: (factory: Factory) => Promise<unknown>): ExtensionContext {
	return {
		hasUI: true,
		mode: "tui",
		sessionManager: { getSessionId: () => "s" },
		ui: { custom },
	} as unknown as ExtensionContext;
}

export interface Detail {
	question: string;
	options: string[];
	answer?: string | null;
	skipped?: boolean;
	delegated?: boolean;
	note?: string;
	pending?: boolean;
	questions: Detail[];
}
export interface Rendered {
	render(width: number): string[];
}
export interface CapturedTool {
	execute(
		id: string,
		params: Partial<QuestionSpec> & { questions?: Partial<QuestionSpec>[] },
		signal: undefined,
		onUpdate: undefined,
		ctx: ExtensionContext,
	): Promise<{ content: { type: string; text: string }[]; details: Detail }>;
	renderCall(args: unknown, theme: Theme, context: unknown): Rendered;
	renderResult(
		result: { content: { type: string; text: string }[]; details?: unknown },
		options: { expanded?: boolean; isPartial?: boolean },
		theme: Theme,
		context?: unknown,
	): Rendered;
}

export interface FakeEvents {
	on(channel: string, handler: unknown): void;
	emit(channel: string, payload: unknown): void;
}

/** Registers the extension on a stub API and returns the tool it registered. */
export function captureTool(events: FakeEvents | undefined = { on() {}, emit() {} }): CapturedTool {
	let tool: CapturedTool | undefined;
	questionExtension({
		registerTool: (t: unknown) => {
			tool = t as CapturedTool;
		},
		on() {},
		events,
	} as unknown as ExtensionAPI);
	if (!tool) throw new Error("question tool was not registered");
	return tool;
}

export const K = {
	up: "\x1b[A",
	down: "\x1b[B",
	right: "\x1b[C",
	left: "\x1b[D",
	shiftTab: "\x1b[Z",
	tab: "\t",
	esc: "\x1b",
	enter: "\r",
	home: "\x1b[H",
	end: "\x1b[F",
};
