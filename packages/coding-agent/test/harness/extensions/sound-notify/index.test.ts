// Ported from import/ny-pi/claude-home/bin/tests/sound-notify.test.ts (1 case), plus the settled handler gated by
// `notify.sound` / NYCODE_SOUND_NOTIFY.
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../../../../src/core/extensions/types.ts";
import soundNotifyExtension, { playerCommand } from "../../../../src/extensions/sound-notify/index.ts";

type Settled = (event: unknown, ctx: { hasUI: boolean }) => Promise<void>;

function register(settings: unknown): Settled | undefined {
	let handler: Settled | undefined;
	soundNotifyExtension({
		getSettings: () => settings,
		on: (_event: string, fn: Settled) => {
			handler = fn;
		},
	} as unknown as ExtensionAPI);
	return handler;
}

describe("sound-notify", () => {
	afterEach(() => {
		delete process.env.NYCODE_SOUND_NOTIFY;
		delete process.env.NYCODE_SUBAGENT;
	});

	it("order: canberra, then pw-play with the sound, otherwise none (bell)", () => {
		expect(playerCommand((b) => b === "canberra-gtk-play", true)?.[0]).toBe("canberra-gtk-play");
		expect(playerCommand((b) => b === "pw-play", true)).toEqual([
			"pw-play",
			"/usr/share/sounds/freedesktop/stereo/complete.oga",
		]);
		expect(playerCommand((b) => b === "pw-play", false)).toBeUndefined();
		expect(playerCommand(() => false, true)).toBeUndefined();
	});

	it("registers nothing inside a subagent", () => {
		process.env.NYCODE_SUBAGENT = "1";
		expect(register({})).toBeUndefined();
	});

	it("loads in the main session and lets the key decide", async () => {
		process.env.NYCODE_SOUND_NOTIFY = "0";
		const handler = register({});
		expect(handler).toBeDefined();
		// Off by key: no player is looked up, so the call is a no-op even with a UI.
		await expect(handler?.({}, { hasUI: true })).resolves.toBeUndefined();
	});
});
