// Ported from zzzzzzzzzzzzzz-onda5/hooks.test.ts (pi-code patch tests). The patch-apply and diff-of-removed-lines
// cases have no counterpart: the code now lives in the tree, so the source checks read it directly.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hookAttention, hookNotice } from "../../../src/extensions/hooks/index.ts";

const HOOKS_SRC = join(import.meta.dirname, "../../../src/extensions/hooks");
const sourceFiles = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? sourceFiles(join(dir, entry.name))
			: entry.name.endsWith(".ts")
				? [join(dir, entry.name)]
				: [],
	);
// Whitespace, quote style and trailing commas are Biome's business; the text must otherwise match.
const squash = (text: string): string =>
	text
		.replaceAll(/\s+/g, "")
		.replaceAll("'", '"')
		.replaceAll(/,([)}\]])/g, "$1");
// A literal `${` in a plain string trips noTemplateCurlyInString.
const D = "$";
const source = squash(
	sourceFiles(HOOKS_SRC)
		.map((file) => readFileSync(file, "utf8"))
		.join("\n"),
);

describe("hook notices", () => {
	it("hook informativo: info com ◇", () => {
		expect(hookNotice("PostToolUse", "Hook de demonstração executado")).toEqual({
			text: "◇ hook PostToolUse · Hook de demonstração executado",
			level: "info",
		});
	});

	it("falha de execução: error com ✗ só em sink que carrega falhas; vazio/normal segue info", () => {
		expect(hookNotice("PreToolUse", "Hook failed to run: x.sh: boom", true)).toEqual({
			text: "✗ Hook PreToolUse falhou · Hook failed to run: x.sh: boom",
			level: "error",
		});
		expect(hookNotice("PreToolUse", "x.sh hook error: invalid JSON", true).level).toBe("error");
		expect(hookNotice("PostToolUse", "x.sh hook error: não é falha", false).level).toBe("info");
		expect(hookNotice("PreToolUse", "systemMessage comum", true).level).toBe("info");
	});

	it("bloqueio: texto ▲ em português", () => {
		expect(hookAttention("bloqueou a compactação", "motivo")).toBe("▲ Hook bloqueou a compactação · motivo");
		expect(hookAttention("Stop bloqueou 3 vezes seguidas", "encerrando o turno")).toBe(
			"▲ Hook Stop bloqueou 3 vezes seguidas · encerrando o turno",
		);
	});
});

describe("fonte", () => {
	it("avisos de bloqueio usam warning", () => {
		for (const call of [
			`notify(hookAttention('PreToolUse reescreveu o comando', \`rodando: ${D}{rewritten}\`), 'warning')`,
			`notify(hookAttention(\`Stop bloqueou ${D}{cap} vezes seguidas\`, 'encerrando o turno'), 'warning')`,
			"notify(hookAttention('bloqueou a compactação', blocked.reason), 'warning')",
		])
			expect(source).toContain(squash(call));
	});

	it("o que vai ao modelo continua o mesmo", () => {
		for (const keep of [
			"nycode.sendMessage({ customType: 'claude-stop-hook', content: reason, display: true }, { triggerTurn: true })",
			"return blockedToolCall(decision.reason, decision.stop === true || decision.defer === true || (decision.ask === true && ctx.hasUI))",
			`output: \`Blocked by hook: ${D}{reason}\``,
		])
			expect(source).toContain(squash(keep));
	});
});
