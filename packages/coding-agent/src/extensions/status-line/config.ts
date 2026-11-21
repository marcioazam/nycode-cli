import { SETTINGS_DEFAULTS } from "../../core/settings-defaults.ts";
import { readManagedSettings } from "../_shared/settings/managed-settings.ts";
import { readSettingsChain } from "../_shared/settings/settings-chain.ts";
import { readSettingsDisableAllHooks } from "../hooks/index.ts";

export interface StatusLineConfig {
	command: string;
	padding: number;
	refreshInterval: number | undefined;
}

/** One settings `statusLine` entry parsed into a config, or undefined when it is
 * not Claude's `{type: "command", command, padding?, refreshInterval?}` shape;
 * refreshInterval has a documented minimum of 1. */
function parseStatusLineEntry(entry: unknown): StatusLineConfig | undefined {
	if (entry === null || typeof entry !== "object") return undefined;
	const record = entry as { type?: unknown; command?: unknown; padding?: unknown; refreshInterval?: unknown };
	if (typeof record.command !== "string" || record.command.trim() === "") return undefined;
	if (record.type !== undefined && record.type !== "command") return undefined;
	return {
		command: record.command,
		padding: typeof record.padding === "number" && record.padding > 0 ? record.padding : 0,
		refreshInterval:
			typeof record.refreshInterval === "number" && record.refreshInterval >= 1 ? record.refreshInterval : undefined,
	};
}

/** The `statusLine` that applies: a managed policy entry wins over everything, and allowManagedHooksOnly narrows
 * the setting to managed settings entirely, as Claude documents. Below them, nycode's own settings.json entry
 * (`own`: an empty `command` turns the status line off), then the Claude settings files, last file winning, and
 * the embedded default (claude-hud) as the floor. */
export function readStatusLineConfig(
	files: string[],
	managed: Record<string, unknown> = readManagedSettings(),
	own?: unknown,
): StatusLineConfig | undefined {
	const managedConfig = parseStatusLineEntry(managed.statusLine);
	if (managedConfig) return managedConfig;
	if (managed.allowManagedHooksOnly === true) return undefined;
	if (own !== undefined) return parseStatusLineEntry(own);
	let found = parseStatusLineEntry(SETTINGS_DEFAULTS.statusLine);
	for (const settings of readSettingsChain(files)) found = parseStatusLineEntry(settings.statusLine) ?? found;
	return found;
}

/** The statusLine that runs. Claude: with disableAllHooks set outside managed settings,
 * "Claude Code runs only a statusLine from managed settings, and with no managed
 * statusLine the status line is disabled"; set in managed settings, nothing runs. */
export function activeStatusLine(
	files: string[],
	managed: Record<string, unknown> = readManagedSettings(),
	own?: unknown,
): StatusLineConfig | undefined {
	if (managed.disableAllHooks === true) return undefined;
	if (readSettingsDisableAllHooks(files)) return parseStatusLineEntry(managed.statusLine);
	return readStatusLineConfig(files, managed, own);
}
