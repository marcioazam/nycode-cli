import type { InlineExtension } from "../core/extensions/types.ts";
import codemodeExtension from "./codemode/index.ts";
import contextUsageExtension from "./context-usage/index.ts";
import llamaExtension from "./llama/index.ts";
import mcpExtension from "./mcp/index.ts";
import notifyExtension from "./notify/index.ts";
import sessionTitleExtension from "./session-title/index.ts";
import thinkingExtension from "./thinking/index.ts";
import toolSearchExtension from "./tool-search/index.ts";

export const builtInExtensions: InlineExtension[] = [
	{ name: "llama.cpp", factory: llamaExtension, builtin: true },
	// Replaceable: an extension that registers `codemode`, `tool_search`, or `/mcp` (such as a third-party
	// MCP extension) takes over instead of running alongside the built-in one.
	{ name: "codemode", factory: codemodeExtension, replaceable: true, builtin: true },
	{ name: "tool-search", factory: toolSearchExtension, replaceable: true, builtin: true },
	{ name: "mcp", factory: mcpExtension, replaceable: true, builtin: true },
	{ name: "notify", factory: notifyExtension, builtin: true },
	{ name: "session-title", factory: sessionTitleExtension, builtin: true },
	{ name: "thinking", factory: thinkingExtension, builtin: true },
	{ name: "context-usage", factory: contextUsageExtension, builtin: true },
];
