// Ported from import/ny-pi/extensions/up-dequeue/index.test.ts: Up becomes Alt+Up only with an empty editor and a
// pending queue; the generated sequence is Alt+Up for the tui; the extension registers the terminal-input handler.
import { matchesKey } from "@nycode/tui";
import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../../../../src/core/extensions/types.ts";
import upDequeueExtension, { rewrite } from "../../../../src/extensions/up-dequeue/index.ts";

type Handler = (data: string) => { data: string } | undefined;
type StartHandler = (event: unknown, ctx: unknown) => void;

describe("up-dequeue", () => {
	it("turns Up into Alt+Up only with an empty editor and a pending queue", () => {
		expect(rewrite("\x1b[A", true, true)).toBe("\x1b[1;3A");
		expect(rewrite("\x1bOA", true, true)).toBe("\x1b[1;3A");
		expect(rewrite("\x1b[A", false, true)).toBeUndefined();
		expect(rewrite("\x1b[A", true, false)).toBeUndefined();
		expect(rewrite("a", true, true)).toBeUndefined();
	});

	it("generates a sequence the tui reads as Alt+Up", () => {
		expect(matchesKey("\x1b[1;3A", "alt+up")).toBe(true);
	});

	it("registers the handler and consults the editor and the queue", () => {
		let onStart: StartHandler | undefined;
		const registered: { handler?: Handler } = {};
		const ctx = (hasUI: boolean, text: string, pending: boolean) => ({
			hasUI,
			hasPendingMessages: () => pending,
			ui: {
				getEditorText: () => text,
				onTerminalInput: (h: Handler) => {
					registered.handler = h;
				},
			},
		});
		upDequeueExtension({
			on: (_event: string, fn: StartHandler) => {
				onStart = fn;
			},
		} as unknown as ExtensionAPI);
		onStart?.({}, ctx(false, "", true));
		expect(registered.handler).toBeUndefined();
		onStart?.({}, ctx(true, "  ", true));
		expect(registered.handler?.("\x1b[A")).toEqual({ data: "\x1b[1;3A" });
		onStart?.({}, ctx(true, "texto", true));
		expect(registered.handler?.("\x1b[A")).toBeUndefined();
	});
});
