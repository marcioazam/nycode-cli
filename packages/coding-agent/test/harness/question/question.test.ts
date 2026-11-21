// Ported from zzzzzzzzzzzzzz-onda5/question.test.ts. The case "patch applies over the current stack and reverts" belongs to the
// patch mechanism and has no counterpart in the embedded extension. The three buildQuestionLines cases (title with ❯, [x] boxes,
// "Sua resposta:") described the onda5 layout, which later patches replaced; their final-state equivalents are in
// question-dialog.test.ts (header, variant B list, footers) and question-nav.test.ts (footers). The overlay value contract and
// the free-text logic label are kept.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { askViaOverlay } from "../../../src/extensions/question/overlay.ts";
import type { DisplayOption } from "../../../src/extensions/question/types.ts";
import { type Factory, fakeCtx, opts, other, tagTheme } from "./support.ts";

/** Opens the overlay, sends the keys and returns the value the tool receives. */
function drive(options: DisplayOption[], multiSelect: boolean, keys: string[]) {
	let handler: { handleInput(d: string): void } | undefined;
	const ctx = fakeCtx(
		(f: Factory) =>
			new Promise((resolve) => {
				handler = f({ requestRender() {}, terminal: { rows: 24, columns: 80 } }, tagTheme, null, resolve);
			}),
	);
	const p = askViaOverlay({ question: "Qual?", options: opts, multiSelect }, ctx, options, multiSelect);
	for (const k of keys) handler?.handleInput(k);
	return p;
}

describe("question overlay contract", () => {
	it("the value returned to the model did not change", async () => {
		expect(await drive([...opts, other], false, ["\x1b[B", "\r"])).toEqual({
			answer: "beta",
			wasCustom: false,
			index: 2,
		});
		expect(await drive(opts, true, [" ", "\x1b[B", " ", "\r"])).toEqual({ answer: "alpha, beta", wasCustom: false });
		expect(await drive([...opts, other], false, ["\x1b[B", "\x1b[B", "\r", "o", "i", "\r"])).toEqual({
			answer: "oi",
			wasCustom: true,
		});
		expect(await drive([...opts, other], false, ["\x1b"])).toBeNull();
	});

	it("the free-text logic label stays 'Type something.' in the tool", () => {
		const src = readFileSync(new URL("../../../src/extensions/question/ask.ts", import.meta.url), "utf8");
		expect(src).toMatch(/\{ label: ["']Type something\.["'], isOther: true \}/);
	});
});
