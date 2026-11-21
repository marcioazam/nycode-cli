// D-33: the session-end report is prefixed `nycode:` (pi-code printed `pi-code:`).
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "../../../src/core/extensions/types.ts";
import { setCliSettingsReader } from "../../../src/extensions/_shared/settings/cli-settings.ts";
import settingsFlagsExtension from "../../../src/extensions/settings-flags/index.ts";

afterEach(() => {
	setCliSettingsReader(undefined);
	vi.restoreAllMocks();
});

function host(flags: Record<string, string | boolean>) {
	const registered: string[] = [];
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
	const api = {
		registerFlag: (name: string) => registered.push(name),
		getFlag: (name: string) => flags[name],
		on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) => handlers.set(event, handler),
	} as unknown as ExtensionAPI;
	settingsFlagsExtension(api);
	return { registered, handlers };
}

describe("settings-flags extension", () => {
	it("registers the four Claude flags", () => {
		expect(host({}).registered).toEqual(["settings", "setting-sources", "mcp-config", "strict-mcp-config"]);
	});

	it("reports a refused --settings value as an error and ends the session with the nycode prefix", () => {
		const missing = path.join("/nonexistent-nycode-dir", "settings.json");
		const { handlers } = host({ settings: missing });
		const notify = vi.fn();
		const shutdown = vi.fn();
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(((_text: string, cb?: () => void) => {
			cb?.();
			return true;
		}) as typeof process.stderr.write);
		const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
		handlers.get("session_start")?.({}, { ui: { notify }, hasUI: false, shutdown } as unknown as ExtensionContext);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Settings file not found"), "error");
		expect(String(stderr.mock.calls[0][0])).toMatch(/^nycode: Settings file not found/);
		expect(exit).toHaveBeenCalledWith(1);
		expect(shutdown).not.toHaveBeenCalled();
	});

	it("stays quiet when no flag is refused", () => {
		const { handlers } = host({});
		const notify = vi.fn();
		handlers.get("session_start")?.({}, { ui: { notify }, hasUI: false } as unknown as ExtensionContext);
		expect(notify).not.toHaveBeenCalled();
	});
});
