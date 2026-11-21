// K4: mono and tokyo-night ship next to dark and light, and NO_COLOR applies mono.
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../../../src/core/extensions/types.ts";
import a11y from "../../../src/extensions/ui/a11y.ts";
import { getAvailableThemes, getThemeByName } from "../../../src/modes/interactive/theme/theme.ts";

const saved = process.env.NO_COLOR;
afterEach(() => {
	if (saved === undefined) delete process.env.NO_COLOR;
	else process.env.NO_COLOR = saved;
});

describe("nycode themes", () => {
	it("lists tokyo-night and mono beside the upstream dark and light", () => {
		expect(getAvailableThemes()).toEqual(expect.arrayContaining(["dark", "light", "tokyo-night", "mono"]));
		expect(getThemeByName("tokyo-night")?.name).toBe("tokyo-night");
		expect(getThemeByName("mono")?.name).toBe("mono");
	});

	it("NO_COLOR makes the a11y extension apply mono without a warning", () => {
		process.env.NO_COLOR = "1";
		let handler: ((event: unknown, ctx: unknown) => void) | undefined;
		a11y({
			on: (_name: string, h: typeof handler) => {
				handler = h;
			},
			getSettings: () => ({}),
		} as unknown as ExtensionAPI);
		const applied: string[] = [];
		const notes: string[] = [];
		handler?.(
			{},
			{
				hasUI: true,
				ui: {
					getTheme: getThemeByName,
					setTheme: (t: { name?: string }) => {
						applied.push(String(t.name));
						return { success: true };
					},
					setWorkingIndicator: () => {},
					notify: (m: string) => notes.push(m),
				},
			},
		);
		expect(applied).toEqual(["mono"]);
		expect(notes).toEqual([]);
	});
});
