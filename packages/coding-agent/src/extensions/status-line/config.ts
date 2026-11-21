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
	if (typeof record.command !== "string") return undefined;
	if (record.type !== undefined && record.type !== "command") return undefined;
	return {
		command: record.command,
		padding: typeof record.padding === "number" && record.padding > 0 ? record.padding : 0,
		refreshInterval:
			typeof record.refreshInterval === "number" && record.refreshInterval >= 1 ? record.refreshInterval : undefined,
	};
}

/** The `statusLine` recorded in settings, last file winning; a managed policy
 * entry wins over every file, and allowManagedHooksOnly narrows the setting to
 * managed settings entirely, as Claude documents. */
export function readStatusLineConfig(
	files: string[],
	managed: Record<string, unknown> = readManagedSettings(),
): StatusLineConfig | undefined {
	const managedConfig = parseStatusLineEntry(managed.statusLine);
	if (managedConfig) return managedConfig;
	if (managed.allowManagedHooksOnly === true) return undefined;
	let found: StatusLineConfig | undefined;
	for (const settings of readSettingsChain(files)) found = parseStatusLineEntry(settings.statusLine) ?? found;
	return found;
}

/** The statusLine that runs. Claude: with disableAllHooks set outside managed settings,
 * "Claude Code runs only a statusLine from managed settings, and with no managed
 * statusLine the status line is disabled"; set in managed settings, nothing runs. */
export function activeStatusLine(
	files: string[],
	managed: Record<string, unknown> = readManagedSettings(),
): StatusLineConfig | undefined {
	if (managed.disableAllHooks === true) return undefined;
	if (readSettingsDisableAllHooks(files)) return parseStatusLineEntry(managed.statusLine);
	return readStatusLineConfig(files, managed);
}
