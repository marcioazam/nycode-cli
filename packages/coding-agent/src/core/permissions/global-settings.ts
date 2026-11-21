// The settings only the user's own settings.json may set: the permission engine, the PreToolUse hooks that replace the
// embedded guard, and NYCODE_* env. A checked-out project must not turn its own guard off or redirect nycode.
// Read from the file (not from a SettingsManager) because the hooks and env-settings extensions only get the merged
// settings, and the gate and those extensions must take the engine from the same place.
import { readFileSync } from "node:fs";
import { getSettingsPath } from "../../config.ts";
import { resolveNycodeSettings } from "../settings-nycode.ts";
import type { Settings } from "../settings-schema.ts";

/** The global settings.json; empty when it is missing or unreadable, so the embedded defaults (guard on) apply. */
export function readGlobalSettings(): Settings {
	try {
		const parsed: unknown = JSON.parse(readFileSync(getSettingsPath(), "utf-8"));
		// The file is user input: anything but an object is ignored.
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Settings) : {};
	} catch {
		return {};
	}
}

/** The permission engine `global` (readGlobalSettings) names, or the default. */
export const engineOf = (global: Settings): string => resolveNycodeSettings(global, process.env).permissions.engine;

/** `permissions.engine` from the global settings only; the one source of the gate and of the hooks extension. */
export const globalPermissionsEngine = (): string => engineOf(readGlobalSettings());
