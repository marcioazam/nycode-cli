// Ported from the pi-code notify-focus patch test: a known terminal-focus state decides alone, otherwise the isAway heuristic.
import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../../../src/core/extensions/types.ts";
import notifyExtension, { shouldNotify } from "../../../src/extensions/notify/index.ts";

type Handler = (...args: unknown[]) => unknown;

/** Runs one turn through the extension and returns whether anything was written to stdout. */
function harness(withEvents = true) {
	const handlers = new Map<string, Handler>();
	const bus = new Map<string, (data: unknown) => void>();
	const api = { on: (name: string, handler: Handler) => handlers.set(name, handler) } as unknown as ExtensionAPI & {
		events?: { on: (name: string, handler: (data: unknown) => void) => void };
	};
	if (withEvents) api.events = { on: (name, handler) => bus.set(name, handler) } as never;
	notifyExtension(api);
	const written: string[] = [];
	const run = (opts: { aborted?: boolean; userInput?: boolean } = {}) => {
		written.length = 0;
		const realWrite = process.stdout.write;
		const wasTty = process.stdout.isTTY;
		process.stdout.write = ((chunk: string) => {
			written.push(String(chunk));
			return true;
		}) as typeof process.stdout.write;
		process.stdout.isTTY = true;
		try {
			handlers.get("session_start")?.({}, {});
			if (opts.userInput) handlers.get("input")?.({ source: "user" });
			handlers.get("agent_end")?.({
				messages: [{ role: "assistant", stopReason: opts.aborted ? "aborted" : "stop" }],
			});
			handlers.get("agent_settled")?.({});
		} finally {
			process.stdout.write = realWrite;
			process.stdout.isTTY = wasTty;
		}
		return written.length > 0;
	};
	return { bus, run };
}

describe("shouldNotify", () => {
	it("a known focus state decides alone; unknown falls back to isAway", () => {
		expect(shouldNotify(true, undefined, 0, 30_000)).toBe(false);
		expect(shouldNotify(false, 0, 1, 30_000)).toBe(true);
		expect(shouldNotify(undefined, undefined, 0, 30_000)).toBe(true);
		expect(shouldNotify(undefined, 1000, 2000, 30_000)).toBe(false);
		expect(shouldNotify(undefined, 1000, 40_000, 30_000)).toBe(true);
	});
});

describe("notify extension", () => {
	it("focused: does not notify, even without recent input", () => {
		const h = harness();
		h.bus.get("pi-ui:terminal-focus")?.({ focused: true });
		expect(h.run()).toBe(false);
	});

	it("unfocused: notifies even with recent input (short turn)", () => {
		const h = harness();
		h.bus.get("pi-ui:terminal-focus")?.({ focused: false });
		expect(h.run({ userInput: true })).toBe(true);
	});

	it("unfocused but aborted turn: does not notify", () => {
		const h = harness();
		h.bus.get("pi-ui:terminal-focus")?.({ focused: false });
		expect(h.run({ aborted: true })).toBe(false);
	});

	it("focus returns: the last event wins", () => {
		const h = harness();
		h.bus.get("pi-ui:terminal-focus")?.({ focused: false });
		h.bus.get("pi-ui:terminal-focus")?.({ focused: true });
		expect(h.run()).toBe(false);
	});

	it("no focus event: the isAway heuristic is unchanged", () => {
		const h = harness();
		expect(h.run()).toBe(true); // no prompt since session start = away
		expect(h.run({ userInput: true })).toBe(false); // short turn after input
	});

	it("a stub without pi.events loads and falls back to the heuristic", () => {
		expect(harness(false).run()).toBe(true);
	});
});
