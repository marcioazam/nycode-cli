// D-33: the approval walk gates the project's MCP and agent files under the nycode config directory, not `.pi`.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_DIR_NAME } from "../../../src/config.ts";
import { hasClaudeShapedConfig } from "../../../src/extensions/_shared/project/project-approval.ts";

function project(entry: string): { cwd: string; home: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "nycode-approval-"));
	const cwd = path.join(root, "repo");
	fs.mkdirSync(path.join(cwd, ".git"), { recursive: true });
	const target = path.join(cwd, entry);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	if (entry.endsWith(".json")) fs.writeFileSync(target, "{}");
	else fs.mkdirSync(target, { recursive: true });
	return { cwd, home: path.join(root, "home") };
}

describe("hasClaudeShapedConfig", () => {
	it.each([[path.join(CONFIG_DIR_NAME, "mcp.json")], [path.join(CONFIG_DIR_NAME, "agents")], [".mcp.json"]])(
		"gates %s",
		(entry) => {
			const { cwd, home } = project(entry);
			expect(hasClaudeShapedConfig(cwd, home)).toBe(true);
		},
	);

	it.each([[path.join(".pi", "mcp.json")], [path.join(".pi", "agents")]])("no longer looks at %s", (entry) => {
		const { cwd, home } = project(entry);
		expect(hasClaudeShapedConfig(cwd, home)).toBe(false);
	});
});
