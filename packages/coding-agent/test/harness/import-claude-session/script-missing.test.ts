// Outside a source checkout (published package) puxar.py is absent: /puxar says so and never runs python.
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "../../../src/core/extensions/types.ts";

// NYCODE_PACKAGE_DIR is read when the extension module loads, so set it before the import below runs.
vi.hoisted(() => {
	process.env.NYCODE_PACKAGE_DIR = `${process.env.TMPDIR ?? "/tmp"}/nycode-puxar-nopkg/a/b`;
});

import importClaudeSessionExtension from "../../../src/extensions/import-claude-session/index.ts";

describe("/puxar without the script", () => {
	it("reports it clearly and does not exec", async () => {
		const exec = vi.fn();
		const notify = vi.fn();
		let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
		importClaudeSessionExtension({
			exec,
			registerCommand: (_name: string, options: { handler: typeof handler }) => {
				handler = options.handler;
			},
		} as unknown as ExtensionAPI);
		await handler?.("1", { ui: { notify } } as unknown as ExtensionCommandContext);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("puxar.py não encontrado"), "error");
		expect(exec).not.toHaveBeenCalled();
	});
});
