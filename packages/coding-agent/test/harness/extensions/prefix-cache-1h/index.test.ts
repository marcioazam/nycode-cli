// Ported from import/ny-pi/claude-home/bin/tests/prefix-cache-1h.test.ts (3 cases): 1h only on tools and system,
// nothing to mark, and the on/off rules, now driven by `harness.prefixCache1h`; plus the handler wiring.
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../../../../src/core/extensions/types.ts";
import prefixCache1hExtension, { enabled, prefixTtl1h } from "../../../../src/extensions/prefix-cache-1h/index.ts";

const eph = () => ({ type: "ephemeral" });
const payload = () => ({
	tools: [{ name: "a" }, { name: "b", cache_control: eph() }],
	system: [
		{ type: "text", text: "x", cache_control: eph() },
		{ type: "text", text: "y", cache_control: eph() },
	],
	messages: [{ role: "user", content: [{ type: "text", text: "oi", cache_control: eph() }] }],
});

type Handler = (event: { payload: unknown }, ctx: { hasUI: boolean }) => unknown;

function register(settings: unknown): Handler {
	let handler: Handler | undefined;
	prefixCache1hExtension({
		getSettings: () => settings,
		on: (_event: string, fn: Handler) => {
			handler = fn;
		},
	} as unknown as ExtensionAPI);
	if (!handler) throw new Error("handler not registered");
	return handler;
}

describe("prefix-cache-1h", () => {
	afterEach(() => {
		delete process.env.NYCODE_PREFIX_CACHE_1H;
		delete process.env.NYCODE_SUBAGENT;
	});

	it("marks 1h only on tools and system; messages stay at 5 min", () => {
		const p = payload();
		expect(prefixTtl1h(p)).toBe(p);
		expect(p.tools[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
		expect((p.tools[0] as { cache_control?: unknown }).cache_control).toBeUndefined();
		for (const b of p.system) expect(b.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
		expect(p.messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });
	});

	it("leaves the payload alone when there is nothing to mark", () => {
		expect(prefixTtl1h({ messages: [] })).toBeUndefined(); // thread continuation: no system/tools
		expect(prefixTtl1h({ system: "texto", tools: [{ name: "a" }] })).toBeUndefined(); // cache off
		const long = { system: [{ type: "text", text: "x", cache_control: { type: "ephemeral", ttl: "1h" } }] };
		expect(prefixTtl1h(long)).toBeUndefined(); // long retention already marked it
		expect(prefixTtl1h(null)).toBeUndefined();
		expect(prefixTtl1h("x")).toBeUndefined();
	});

	it("auto is on in the main interactive session only; true forces, false and subagents turn it off", () => {
		expect(enabled(true, "auto", {})).toBe(true);
		expect(enabled(false, "auto", {})).toBe(false); // -p: prefix rarely reused within 5-60 min
		expect(enabled(true, "auto", { NYCODE_SUBAGENT: "1" })).toBe(false);
		expect(enabled(true, false, {})).toBe(false);
		expect(enabled(false, true, {})).toBe(true);
		expect(enabled(false, true, { NYCODE_SUBAGENT: "1" })).toBe(false);
	});

	it("the handler follows the setting and NYCODE_PREFIX_CACHE_1H wins over it", () => {
		const handler = register({});
		expect(handler({ payload: payload() }, { hasUI: true })).toBeDefined();
		expect(handler({ payload: payload() }, { hasUI: false })).toBeUndefined();
		process.env.NYCODE_PREFIX_CACHE_1H = "0";
		expect(handler({ payload: payload() }, { hasUI: true })).toBeUndefined();
		process.env.NYCODE_PREFIX_CACHE_1H = "1";
		expect(handler({ payload: payload() }, { hasUI: false })).toBeDefined();
		delete process.env.NYCODE_PREFIX_CACHE_1H;
		expect(register({ harness: { prefixCache1h: false } })({ payload: payload() }, { hasUI: true })).toBeUndefined();
	});
});
