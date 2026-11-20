/**
 * Bash Spawn Hook Example
 *
 * Adjusts command, cwd, and env before execution.
 *
 * Usage:
 *   nycode -e ./bash-spawn-hook.ts
 */

import type { ExtensionAPI } from "@nycode/coding-agent";
import { createBashTool } from "@nycode/coding-agent";

export default function (nycode: ExtensionAPI) {
	const cwd = process.cwd();

	const bashTool = createBashTool(cwd, {
		spawnHook: ({ command, cwd, env }) => ({
			command: `source ~/.profile\n${command}`,
			cwd,
			env: { ...env, NYCODE_SPAWN_HOOK: "1" },
		}),
	});

	nycode.registerTool({
		...bashTool,
		execute: async (id, params, signal, onUpdate, _ctx) => {
			return bashTool.execute(id, params, signal, onUpdate);
		},
	});
}
