import type { InlineExtension } from "../core/extensions/types.ts";
import codemodeExtension from "./codemode/index.ts";
import hooksExtension from "./hooks/index.ts";
import llamaExtension from "./llama/index.ts";
import mcpExtension from "./mcp/index.ts";
import toolSearchExtension from "./tool-search/index.ts";
import webExtension from "./web/index.ts";

export const builtInExtensions: InlineExtension[] = [
	{ name: "hooks", factory: hooksExtension, builtin: true },
	{ name: "llama.cpp", factory: llamaExtension, builtin: true },
	// Replaceable: an extension that registers `codemode`, `tool_search`, or `/mcp` (such as a third-party
	// MCP extension) takes over instead of running alongside the built-in one.
	{ name: "codemode", factory: codemodeExtension, replaceable: true, builtin: true },
	{ name: "tool-search", factory: toolSearchExtension, replaceable: true, builtin: true },
	{ name: "mcp", factory: mcpExtension, replaceable: true, builtin: true },
	// Off by default: `web_search` and `web_fetch` reach the public web, so the user opts in with
	// `-e builtin:web` or `extensions: ["builtin:web"]`.
	{ name: "web", factory: webExtension, builtin: true, enabledByDefault: false },
];
