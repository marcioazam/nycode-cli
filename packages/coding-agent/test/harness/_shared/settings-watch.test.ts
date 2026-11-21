// D-33: the settings poll keeps its test knob under the nycode name; pi-code read PI_CODE_SETTINGS_WATCH_INTERVAL_MS.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { watchSettingsFiles } from "../../../src/extensions/_shared/settings/settings-watch.ts";

const disposers: Array<() => void> = [];
afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
	vi.unstubAllEnvs();
});

describe("watchSettingsFiles", () => {
	it("polls at NYCODE_SETTINGS_WATCH_INTERVAL_MS and reloads on a content change", async () => {
		vi.stubEnv("NYCODE_SETTINGS_WATCH_INTERVAL_MS", "20");
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nycode-watch-")), "settings.json");
		fs.writeFileSync(file, "{}");
		const reload = vi.fn();
		disposers.push(watchSettingsFiles([file], reload));
		fs.writeFileSync(file, '{"a":1}');
		await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1), { timeout: 1000, interval: 10 });
	});

	it("ignores the pi-code variable", async () => {
		vi.stubEnv("PI_CODE_SETTINGS_WATCH_INTERVAL_MS", "20");
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nycode-watch-")), "settings.json");
		fs.writeFileSync(file, "{}");
		const reload = vi.fn();
		disposers.push(watchSettingsFiles([file], reload));
		fs.writeFileSync(file, '{"a":1}');
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(reload).not.toHaveBeenCalled();
	});
});
