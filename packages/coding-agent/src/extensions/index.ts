import type { InlineExtension } from "../core/extensions/types.ts";
import claudeRulesExtension from "./claude-rules/index.ts";
import codemodeExtension from "./codemode/index.ts";
import commandsExtension from "./commands/index.ts";
import contextImportsExtension from "./context-imports/index.ts";
import envSettingsExtension from "./env-settings/index.ts";
import hooksExtension from "./hooks/index.ts";
import initExtension from "./init/index.ts";
import llamaExtension from "./llama/index.ts";
import mcpExtension from "./mcp/index.ts";
import memoryExtension from "./memory/index.ts";
import outputStylesExtension from "./output-styles/index.ts";
import questionExtension from "./question/index.ts";
import settingsFlagsExtension from "./settings-flags/index.ts";
import skillsCompatExtension from "./skills-compat/index.ts";
import todoExtension from "./todo/index.ts";
import toolSearchExtension from "./tool-search/index.ts";

export const builtInExtensions: InlineExtension[] = [
	{ name: "llama.cpp", factory: llamaExtension, builtin: true },
	// Replaceable: an extension that registers `codemode`, `tool_search`, or `/mcp` (such as a third-party
	// MCP extension) takes over instead of running alongside the built-in one.
	{ name: "codemode", factory: codemodeExtension, replaceable: true, builtin: true },
	{ name: "tool-search", factory: toolSearchExtension, replaceable: true, builtin: true },
	{ name: "mcp", factory: mcpExtension, replaceable: true, builtin: true },
	// Embedded pi-code extensions, in pi-code's load order (claude-rules first, then by name).
	{ name: "claude-rules", factory: claudeRulesExtension, builtin: true },
	{ name: "commands", factory: commandsExtension, builtin: true },
	{ name: "context-imports", factory: contextImportsExtension, builtin: true },
	{ name: "env-settings", factory: envSettingsExtension, builtin: true },
	{ name: "hooks", factory: hooksExtension, builtin: true },
	{ name: "init", factory: initExtension, builtin: true },
	{ name: "memory", factory: memoryExtension, builtin: true },
	{ name: "output-styles", factory: outputStylesExtension, builtin: true },
	{ name: "question", factory: questionExtension, builtin: true },
	{ name: "settings-flags", factory: settingsFlagsExtension, builtin: true },
	{ name: "skills-compat", factory: skillsCompatExtension, builtin: true },
	{ name: "todo", factory: todoExtension, builtin: true },
];
