// Behavior of the notify extension beyond focus handling: channel resolution from the user's
// preferredNotifChannel, the terminal protocol per host, the Windows toast, ownership by another extension, and
// the guards (non-tty, extension-sourced input).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "../../../../src/core/extensions/types.ts";
import notifyExtension, {
	AWAY_AFTER_MS,
	isAway,
	resolveNotifChannel,
} from "../../../../src/extensions/notify/index.ts";

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

type Handler = (...args: unknown[]) => unknown;

const ENV_KEYS = ["HOME", "WT_SESSION", "KITTY_WINDOW_ID", "SystemRoot"] as const;
const savedEnv = new Map<string, string | undefined>();
const realPlatform = process.platform;
let home: string;

function setPlatform(value: string): void {
	Object.defineProperty(process, "platform", { value, configurable: true });
}

beforeEach(() => {
	for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
	home = mkdtempSync(join(tmpdir(), "notify-home-"));
	process.env.HOME = home;
	delete process.env.WT_SESSION;
	delete process.env.KITTY_WINDOW_ID;
	execFileMock.mockClear();
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		const value = savedEnv.get(key);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	setPlatform(realPlatform);
	rmSync(home, { recursive: true });
});

function writeChannel(value: string): void {
	mkdirSync(join(home, ".claude"), { recursive: true });
	writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ preferredNotifChannel: value }));
}

/** Loads the extension; run() plays one finished turn and returns what went to stdout. */
function load() {
	const handlers = new Map<string, Handler>();
	const bus = new Map<string, (data: unknown) => void>();
	notifyExtension({
		on: (name: string, handler: Handler) => handlers.set(name, handler),
		events: { on: (name: string, handler: (data: unknown) => void) => bus.set(name, handler) },
	} as unknown as ExtensionAPI);
	const run = (opts: { tty?: boolean; inputSource?: string } = {}): string[] => {
		const written: string[] = [];
		const realWrite = process.stdout.write;
		const wasTty = process.stdout.isTTY;
		process.stdout.write = ((chunk: string) => {
			written.push(String(chunk));
			return true;
		}) as typeof process.stdout.write;
		process.stdout.isTTY = opts.tty ?? true;
		try {
			handlers.get("session_start")?.({}, {});
			if (opts.inputSource) handlers.get("input")?.({ source: opts.inputSource });
			handlers.get("agent_end")?.({ messages: [{ role: "user" }] });
			handlers.get("agent_settled")?.({});
		} finally {
			process.stdout.write = realWrite;
			process.stdout.isTTY = wasTty;
		}
		return written;
	};
	return { bus, run };
}

describe("resolveNotifChannel", () => {
	it("maps Claude's preferredNotifChannel; unknown or non-string means desktop", () => {
		expect(resolveNotifChannel("notifications_disabled")).toBe("off");
		expect(resolveNotifChannel("terminal_bell")).toBe("bell");
		expect(resolveNotifChannel("iterm2_with_bell")).toBe("both");
		expect(resolveNotifChannel("iterm2")).toBe("desktop");
		expect(resolveNotifChannel(undefined)).toBe("desktop");
		expect(resolveNotifChannel(42)).toBe("desktop");
	});
});

describe("isAway", () => {
	it("no input yet is away; otherwise the elapsed time against the threshold", () => {
		expect(isAway(undefined, 0, AWAY_AFTER_MS)).toBe(true);
		expect(isAway(0, AWAY_AFTER_MS - 1, AWAY_AFTER_MS)).toBe(false);
		expect(isAway(0, AWAY_AFTER_MS, AWAY_AFTER_MS)).toBe(true);
	});
});

describe("notify extension channels", () => {
	it("default channel sends an OSC 777 notification", () => {
		expect(load().run()).toEqual(["\x1b]777;notify;Nycode;Ready for input\x07"]);
	});

	it("terminal_bell rings the bell only", () => {
		writeChannel("terminal_bell");
		expect(load().run()).toEqual(["\x07"]);
	});

	it("iterm2_with_bell notifies and rings", () => {
		writeChannel("iterm2_with_bell");
		expect(load().run()).toEqual(["\x1b]777;notify;Nycode;Ready for input\x07", "\x07"]);
	});

	it("notifications_disabled stays silent", () => {
		writeChannel("notifications_disabled");
		expect(load().run()).toEqual([]);
	});
});

describe("notify extension hosts", () => {
	it("Kitty gets the two OSC 99 sequences", () => {
		process.env.KITTY_WINDOW_ID = "1";
		expect(load().run()).toEqual(["\x1b]99;i=1:d=0;Nycode\x1b\\", "\x1b]99;i=1:p=body;Ready for input\x1b\\"]);
	});

	it("Windows Terminal on win32 launches PowerShell from the system path with a toast script", () => {
		process.env.WT_SESSION = "x";
		process.env.SystemRoot = String.raw`D:\Win`;
		setPlatform("win32");
		expect(load().run()).toEqual([]);
		expect(execFileMock).toHaveBeenCalledTimes(1);
		const [file, args] = execFileMock.mock.calls[0] as [string, string[]];
		expect(file).toBe(String.raw`D:\Win\System32\WindowsPowerShell\v1.0\powershell.exe`);
		expect(args.slice(0, 2)).toEqual(["-NoProfile", "-Command"]);
		expect(args[2]).toContain("CreateToastNotifier('Nycode')");
		expect(args[2]).toContain("CreateTextNode('Ready for input')");
	});

	it("WT_SESSION on a non-Windows process (WSL) falls back to OSC 777", () => {
		process.env.WT_SESSION = "x";
		setPlatform("linux");
		expect(load().run()).toEqual(["\x1b]777;notify;Nycode;Ready for input\x07"]);
		expect(execFileMock).not.toHaveBeenCalled();
	});
});

describe("notify extension guards", () => {
	it("without a tty nothing is written", () => {
		expect(load().run({ tty: false })).toEqual([]);
	});

	it("another extension that owns notifications silences this one", () => {
		const h = load();
		h.bus.get("pi-harness:notify-owner")?.({});
		expect(h.run()).toEqual([]);
	});

	it("input from an extension is not the user: the turn still counts as away", () => {
		expect(load().run({ inputSource: "extension" })).toHaveLength(1);
	});

	it("user input makes a short turn not away", () => {
		expect(load().run({ inputSource: "user" })).toEqual([]);
	});
});
