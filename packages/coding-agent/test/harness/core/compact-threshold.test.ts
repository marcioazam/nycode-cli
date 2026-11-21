// Ports import/ny-pi/claude-home/bin/tests/compact-at-400k.test.ts to the core rule (K9) and adds the settled-session cases.
import { describe, expect, it, vi } from "vitest";
import {
	type CompactThresholdContext,
	compactWhenOverLimit,
	reportCompactError,
	warnInvalidCompactAt,
} from "../../../src/core/compaction/threshold.ts";
import { resolveNycodeSettings } from "../../../src/core/settings-nycode.ts";

const limitOf = (env: Record<string, string | undefined>) => resolveNycodeSettings({}, env).compaction.maxContextTokens;

describe("limit", () => {
	it("a positive integer wins; absent uses 250000 without warning", () => {
		const warns: string[] = [];
		const check = (env: Record<string, string | undefined>) => {
			const limit = limitOf(env);
			warnInvalidCompactAt(env, limit, (m) => warns.push(m));
			return limit;
		};
		expect(check({ NYCODE_COMPACT_AT: "300000" })).toBe(300000);
		expect(check({})).toBe(250000);
		expect(warns).toEqual([]);
	});

	it("an invalid value falls to the default and warns", () => {
		for (const bad of ["250k", "0", "-5", "1.5", "", "abc"]) {
			const env = { NYCODE_COMPACT_AT: bad };
			expect(limitOf(env), bad).toBe(250000);
		}
	});

	it("warns once with the refused text and the limit in use", () => {
		const warns: string[] = [];
		warnInvalidCompactAt({ NYCODE_COMPACT_AT: "250k" }, 250000, (m) => warns.push(m));
		warnInvalidCompactAt({ NYCODE_COMPACT_AT: "250k" }, 250000, (m) => warns.push(m));
		expect(warns).toHaveLength(1);
		expect(warns[0]).toMatch(/NYCODE_COMPACT_AT="250k".*250000/);
	});
});

describe("reportCompactError", () => {
	it("notifies with a UI and writes to stderr without one", () => {
		const notes: string[] = [];
		const errs: string[] = [];
		const withUi: CompactThresholdContext = { hasUI: true, ui: { notify: (m) => notes.push(m) } };
		reportCompactError(withUi, new Error("boom"), (m) => errs.push(m));
		expect(notes).toHaveLength(1);
		expect(errs).toEqual([]);
		const noUi: CompactThresholdContext = {
			hasUI: false,
			ui: {
				notify: () => {
					throw new Error("no UI");
				},
			},
		};
		reportCompactError(noUi, new Error("boom"), (m) => errs.push(m));
		expect(errs).toHaveLength(1);
		expect(errs[0]).toMatch(/boom/);
	});
});

describe("compactWhenOverLimit", () => {
	const setup = (over: Partial<Parameters<typeof compactWhenOverLimit>[0]> = {}) => {
		const notes: string[] = [];
		const compact = vi.fn(async () => undefined);
		const input = {
			aborted: false,
			isCompacting: false,
			contextWindow: 1_000_000 as number | undefined,
			getTokens: vi.fn((): number | null | undefined => 260_000),
			limit: 250_000,
			getContext: vi.fn(() => ({ hasUI: true, ui: { notify: (m: string) => notes.push(m) } })),
			compact,
			...over,
		};
		return { notes, compact, input };
	};

	it("compacts, awaits and announces when the context is at or over the limit", async () => {
		const { notes, compact, input } = setup();
		await compactWhenOverLimit(input);
		expect(compact).toHaveBeenCalledTimes(1);
		expect(notes).toEqual(["Contexto em 260k ≥ 250k: compactando"]);
	});

	it.each([
		["aborted run", { aborted: true }],
		["compaction already running", { isCompacting: true }],
		["unknown usage", { getTokens: () => undefined }],
		["below the limit", { getTokens: () => 249_999 }],
	])("does nothing on %s", async (_name, over) => {
		const { compact, input } = setup(over);
		await compactWhenOverLimit(input);
		expect(compact).not.toHaveBeenCalled();
	});

	it.each([
		["a window below the limit", 200_000],
		["no model", undefined],
		["a zero window", 0],
	])("exits early on %s: no usage read, no context built", async (_name, contextWindow) => {
		const { compact, input } = setup({ contextWindow });
		await compactWhenOverLimit(input);
		expect(input.getTokens).not.toHaveBeenCalled();
		expect(input.getContext).not.toHaveBeenCalled();
		expect(compact).not.toHaveBeenCalled();
	});

	it("builds the context only once it compacts", async () => {
		const { input } = setup({ getTokens: () => 100 });
		await compactWhenOverLimit(input);
		expect(input.getContext).not.toHaveBeenCalled();
	});

	it("reports a failed compaction instead of throwing", async () => {
		const { notes, input } = setup({
			compact: async () => {
				throw new Error("boom");
			},
		});
		await compactWhenOverLimit(input);
		expect(notes.at(-1)).toMatch(/boom/);
	});
});
