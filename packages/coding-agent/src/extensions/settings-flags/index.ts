/**
 * Claude's `--settings` and `--setting-sources` CLI flags (docs/specs/settings-flags.md),
 * and its `--mcp-config` and `--strict-mcp-config` flags (docs/mcp.md).
 *
 * This extension owns the flags: pi answers `getFlag` only for the extension that
 * registered a flag, so the values are resolved here and shared with every consumer of
 * the settings chain through _shared/settings/cli-settings. pi parses flag values after every
 * extension has loaded, so the reader resolves lazily and re-resolves when the raw
 * values change; a read at load time sees no flags, as documented in the spec.
 *
 * A refused value is reported the way Claude does ("Settings file not found: ...",
 * "Invalid setting source: ...") and the session ends: Claude exits 1 rather than run
 * with settings the caller did not ask for. In a terminal session that is pi's own
 * shutdown, which restores the terminal. Elsewhere the process exits 1 itself: print
 * mode binds no shutdown handler (nycode print mode), and rpc mode only marks
 * the session to end after the first turn settles (nycode rpc mode).
 */

import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import {
	type CliFlags,
	type CliSettings,
	resolveCliSettingsOnce,
	setCliSettingsReader,
} from "../_shared/settings/cli-settings.ts";

const MCP_CONFIG = "--mcp-config";

/** Every `--mcp-config` value, as Claude collects a repeated flag. pi keeps one value per
 * flag name, the last, so the earlier ones are read from the argv by pi's own rule (`=v`,
 * or the next token unless it starts with `-` or `@`). Unless the argv ends in pi's value,
 * pi's value alone stands: nothing pi did not parse is loaded. */
function mcpConfigValues(piValue: unknown, argv: readonly string[]): string[] | undefined {
	if (typeof piValue !== "string") return undefined;
	const values: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith(`${MCP_CONFIG}=`)) values.push(arg.slice(MCP_CONFIG.length + 1));
		else if (arg === MCP_CONFIG && argv[i + 1] !== undefined && !/^[-@]/.test(argv[i + 1])) values.push(argv[++i]);
	}
	return values.at(-1) === piValue ? values : [piValue];
}

export default function settingsFlagsExtension(nycode: ExtensionAPI) {
	// Optional-called so the extension still wires under stub hosts without flags.
	nycode.registerFlag?.("settings", {
		description:
			"Claude settings: a JSON file or inline JSON applied above user, project and local settings for this session",
		type: "string",
	});
	nycode.registerFlag?.("setting-sources", {
		description: "Claude settings sources to load, comma-separated: user, project, local",
		type: "string",
	});
	nycode.registerFlag?.("mcp-config", {
		description:
			"Claude MCP servers: a JSON file or inline JSON with mcpServers, added for this session (repeat the flag for more)",
		type: "string",
	});
	nycode.registerFlag?.("strict-mcp-config", {
		description: "Use only the MCP servers from --mcp-config, ignoring every other MCP configuration",
		type: "boolean",
	});

	let last: CliSettings | undefined;
	const read = (): CliSettings => {
		let flags: CliFlags;
		try {
			flags = {
				settings: nycode.getFlag?.("settings"),
				settingSources: nycode.getFlag?.("setting-sources"),
				mcpConfig: mcpConfigValues(nycode.getFlag?.("mcp-config"), process.argv.slice(2)),
				strictMcpConfig: nycode.getFlag?.("strict-mcp-config"),
			};
		} catch {
			// After a session replacement this instance's nycode is stale and every call throws;
			// the last answer stands until the fresh instance registers its own reader.
			return last ?? resolveCliSettingsOnce({}, process.cwd());
		}
		last = resolveCliSettingsOnce(flags, process.cwd());
		return last;
	};
	setCliSettingsReader(read);

	nycode.on("session_start", (_event, ctx: ExtensionContext) => {
		const { errors } = read();
		if (errors.length === 0) return;
		for (const error of errors) ctx.ui.notify(error, "error");
		// The session ends once the report has flushed: piped stderr is asynchronous on
		// some platforms, and an exit right after the write can lose the message.
		const terminal = ctx.hasUI && process.stdout.isTTY === true;
		const end = terminal ? () => ctx.shutdown() : () => process.exit(1);
		const report = errors.map((error) => `nycode: ${error}`).join("\n");
		process.stderr.write(`${report}\n`, end);
	});
}
