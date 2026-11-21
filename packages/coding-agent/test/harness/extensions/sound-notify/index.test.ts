// Ported from import/ny-pi/claude-home/bin/tests/sound-notify.test.ts (1 case), plus the settled handler gated by
// `notify.sound` / NYCODE_SOUND_NOTIFY.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "../../../../src/core/extensions/types.ts";
import soundNotifyExtension, { playerCommand } from "../../../../src/extensions/sound-notify/index.ts";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

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

describe("sound-notify playback", () => {
	const savedPath = process.env.PATH;
	let bin: string;

	beforeEach(() => {
		spawnMock.mockReset();
		bin = fs.mkdtempSync(path.join(os.tmpdir(), "sound-bin-"));
		fs.writeFileSync(path.join(bin, "canberra-gtk-play"), "");
		process.env.PATH = bin;
		delete process.env.NYCODE_SOUND_NOTIFY;
		delete process.env.NYCODE_SUBAGENT;
	});

	afterEach(() => {
		process.env.PATH = savedPath;
		fs.rmSync(bin, { recursive: true });
	});

	it("spawns the found player detached when a UI session settles", async () => {
		const unref = vi.fn();
		spawnMock.mockReturnValue({ unref });
		await register({})?.({}, { hasUI: true });
		expect(spawnMock).toHaveBeenCalledWith("canberra-gtk-play", ["-i", "complete", "-d", "nycode turn complete"], {
			stdio: "ignore",
			detached: true,
		});
		expect(unref).toHaveBeenCalled();
	});

	it("plays nothing without a UI", async () => {
		await register({})?.({}, { hasUI: false });
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("plays nothing when the key is off", async () => {
		process.env.NYCODE_SOUND_NOTIFY = "0";
		await register({})?.({}, { hasUI: true });
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("survives a failing spawn and falls back to the bell without throwing", async () => {
		spawnMock.mockImplementation(() => {
			throw new Error("spawn failed");
		});
		await expect(register({})?.({}, { hasUI: true })).resolves.toBeUndefined();
		expect(spawnMock).toHaveBeenCalledTimes(1);
	});

	it("falls back to the bell without throwing when no player exists", async () => {
		process.env.PATH = "";
		await expect(register({})?.({}, { hasUI: true })).resolves.toBeUndefined();
		expect(spawnMock).not.toHaveBeenCalled();
	});
});
