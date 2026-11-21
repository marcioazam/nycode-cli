import type { InlineExtension } from "../core/extensions/types.ts";
import autoResumeExtension from "./auto-resume/index.ts";
import claudeRulesExtension from "./claude-rules/index.ts";
import codemodeExtension from "./codemode/index.ts";
import commandsExtension from "./commands/index.ts";
import completionGateExtension from "./completion-gate/index.ts";
import contextImportsExtension from "./context-imports/index.ts";
import contextUsageExtension from "./context-usage/index.ts";
import devCommandsExtension from "./dev-commands/index.ts";
import docsPointerExtension from "./docs-pointer/index.ts";
import envSettingsExtension from "./env-settings/index.ts";
import footerExtension from "./footer/index.ts";
import gitCheckpointExtension from "./git-checkpoint/index.ts";
import goalExtension from "./goal/index.ts";
import hooksExtension from "./hooks/index.ts";
import initExtension from "./init/index.ts";
import llamaExtension from "./llama/index.ts";
import mcpExtension from "./mcp/index.ts";
import memoryExtension from "./memory/index.ts";
import notifyExtension from "./notify/index.ts";
import outputStylesExtension from "./output-styles/index.ts";
import planModeExtension from "./plan-mode/index.ts";
import prefixCache1hExtension from "./prefix-cache-1h/index.ts";
import questionExtension from "./question/index.ts";
import runExtension from "./run/index.ts";
import sessionTitleExtension from "./session-title/index.ts";
import settingsFlagsExtension from "./settings-flags/index.ts";
import skillsCompatExtension from "./skills-compat/index.ts";
import soundNotifyExtension from "./sound-notify/index.ts";
import statusLineExtension from "./status-line/index.ts";
import subagentExtension from "./subagent/index.ts";
import syntaxCheckExtension from "./syntax-check/index.ts";
import thinkingExtension from "./thinking/index.ts";
import todoExtension from "./todo/index.ts";
import toolSearchExtension from "./tool-search/index.ts";
import upDequeueExtension from "./up-dequeue/index.ts";
import webExtension from "./web/index.ts";

export const builtInExtensions: InlineExtension[] = [
	{ name: "llama.cpp", factory: llamaExtension, builtin: true },
	// Replaceable: an extension that registers `codemode`, `tool_search`, or `/mcp` (such as a third-party
	// MCP extension) takes over instead of running alongside the built-in one.
	{ name: "codemode", factory: codemodeExtension, replaceable: true, builtin: true },
	{ name: "tool-search", factory: toolSearchExtension, replaceable: true, builtin: true },
	{ name: "mcp", factory: mcpExtension, replaceable: true, builtin: true },
	// nycode: K5 one registration line per embedded extension, alphabetical, below this marker
	// Embedded pi-code extensions, in pi-code's load order (claude-rules first, then by name).
	{ name: "claude-rules", factory: claudeRulesExtension, builtin: true },
	{ name: "commands", factory: commandsExtension, builtin: true },
	{ name: "context-imports", factory: contextImportsExtension, builtin: true },
	{ name: "context-usage", factory: contextUsageExtension, builtin: true },
	{ name: "env-settings", factory: envSettingsExtension, builtin: true },
	{ name: "git-checkpoint", factory: gitCheckpointExtension, builtin: true },
	{ name: "goal", factory: goalExtension, builtin: true },
	{ name: "hooks", factory: hooksExtension, builtin: true },
	{ name: "init", factory: initExtension, builtin: true },
	{ name: "memory", factory: memoryExtension, builtin: true },
	{ name: "notify", factory: notifyExtension, builtin: true },
	{ name: "output-styles", factory: outputStylesExtension, builtin: true },
	{ name: "plan-mode", factory: planModeExtension, builtin: true },
	{ name: "question", factory: questionExtension, builtin: true },
	{ name: "run", factory: runExtension, builtin: true },
	{ name: "session-title", factory: sessionTitleExtension, builtin: true },
	{ name: "settings-flags", factory: settingsFlagsExtension, builtin: true },
	{ name: "skills-compat", factory: skillsCompatExtension, builtin: true },
	{ name: "status-line", factory: statusLineExtension, builtin: true },
	{ name: "subagent", factory: subagentExtension, builtin: true },
	{ name: "thinking", factory: thinkingExtension, builtin: true },
	{ name: "todo", factory: todoExtension, builtin: true },
	{ name: "web", factory: webExtension, builtin: true, enabledByDefault: false },
	// Embedded ny-pi extensions, in ny-pi's load order (after pi-code, by source file name).
	{ name: "auto-resume", factory: autoResumeExtension, builtin: true },
	{ name: "completion-gate", factory: completionGateExtension, builtin: true },
	{ name: "dev-commands", factory: devCommandsExtension, builtin: true },
	{ name: "footer", factory: footerExtension, builtin: true },
	{ name: "docs-pointer", factory: docsPointerExtension, builtin: true },
	{ name: "prefix-cache-1h", factory: prefixCache1hExtension, builtin: true },
	{ name: "sound-notify", factory: soundNotifyExtension, builtin: true },
	{ name: "syntax-check", factory: syntaxCheckExtension, builtin: true },
	{ name: "up-dequeue", factory: upDequeueExtension, builtin: true },
];
