import type { InlineExtension } from "../core/extensions/types.ts";
import codemodeExtension from "./codemode/index.ts";
import envSettingsExtension from "./env-settings/index.ts";
import llamaExtension from "./llama/index.ts";
import mcpExtension from "./mcp/index.ts";
import settingsFlagsExtension from "./settings-flags/index.ts";
import toolSearchExtension from "./tool-search/index.ts";

export const builtInExtensions: InlineExtension[] = [
	{ name: "llama.cpp", factory: llamaExtension, builtin: true },
	// Replaceable: an extension that registers `codemode`, `tool_search`, or `/mcp` (such as a third-party
	// MCP extension) takes over instead of running alongside the built-in one.
	{ name: "codemode", factory: codemodeExtension, replaceable: true, builtin: true },
	{ name: "tool-search", factory: toolSearchExtension, replaceable: true, builtin: true },
	{ name: "mcp", factory: mcpExtension, replaceable: true, builtin: true },
	{ name: "env-settings", factory: envSettingsExtension, builtin: true },
	{ name: "settings-flags", factory: settingsFlagsExtension, builtin: true },
];
