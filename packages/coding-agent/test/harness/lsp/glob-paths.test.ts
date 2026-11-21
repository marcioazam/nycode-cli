// Glob matching, project-root discovery, URI conversion and placeholder expansion used by the lsp extension.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPathIncluded, matchesAnyGlob, matchesGlob } from "../../../src/extensions/lsp/_shared/glob.ts";
import {
	filePathToUri,
	findProjectRoot,
	findUp,
	normalizeRelativePath,
	resolveCommand,
	toAbsolutePath,
	uriToFilePath,
} from "../../../src/extensions/lsp/_shared/paths.ts";

describe("globs", () => {
	it("matches ** across directories and * within one segment", () => {
		expect(matchesGlob("**/*.ts", "a.ts")).toBe(true);
		expect(matchesGlob("**/*.ts", "src/deep/b.ts")).toBe(true);
		expect(matchesGlob("**/*.ts", "a.js")).toBe(false);
		expect(matchesGlob("*.ts", "src/b.ts")).toBe(false);
		expect(matchesGlob("**/node_modules/**", "pkg/node_modules/x/y.js")).toBe(true);
	});

	it("normalizes backslashes and a leading ./", () => {
		expect(matchesGlob("**/*.py", ".\\pkg\\m.py")).toBe(true);
		expect(matchesGlob("src/*.ts", "./src/a.ts")).toBe(true);
	});

	it("matchesAnyGlob is false without patterns", () => {
		expect(matchesAnyGlob(undefined, "a.ts")).toBe(false);
		expect(matchesAnyGlob([], "a.ts")).toBe(false);
	});

	it("include narrows and exclude wins", () => {
		expect(isPathIncluded("a.ts")).toBe(true);
		expect(isPathIncluded("a.py", ["**/*.ts"])).toBe(false);
		expect(isPathIncluded("dist/a.ts", ["**/*.ts"], ["dist/**"])).toBe(false);
		expect(isPathIncluded("src/a.ts", ["**/*.ts"], ["dist/**"])).toBe(true);
	});
});

describe("paths", () => {
	const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "lsp-paths-")));
	const nested = path.join(tmp, "pkg", "src");
	mkdirSync(nested, { recursive: true });
	writeFileSync(path.join(tmp, "pkg", "marker.json"), "{}");
	writeFileSync(path.join(nested, "a.txt"), "x");

	it("finds the nearest directory that holds a root marker", () => {
		expect(findProjectRoot(path.join(nested, "a.txt"), ["marker.json"], tmp)).toBe(path.join(tmp, "pkg"));
	});

	it("returns undefined when no marker exists up to the filesystem root, and the fallback without markers", () => {
		expect(findProjectRoot(path.join(nested, "a.txt"), ["no-such-marker.zz"], tmp)).toBeUndefined();
		expect(findProjectRoot(path.join(nested, "a.txt"), undefined, tmp)).toBe(tmp);
	});

	it("findUp walks parents for a relative file", () => {
		expect(findUp(nested, path.join("pkg", "marker.json"))).toBe(path.join(tmp, "pkg", "marker.json"));
		expect(findUp(nested, "no-such-file.zz")).toBeUndefined();
	});

	it("resolves relative inputs against cwd and normalizes separators", () => {
		expect(toAbsolutePath("a/b.ts", "/w")).toBe(path.resolve("/w", "a/b.ts"));
		expect(toAbsolutePath("/x/../y.ts", "/w")).toBe("/y.ts");
		expect(normalizeRelativePath("")).toBe(".");
	});

	it("round-trips a file path through a file URI", () => {
		const file = path.join(nested, "a b.txt");
		expect(uriToFilePath(filePathToUri(file))).toBe(file);
	});

	it("expands placeholders in the command, its arguments, cwd and env", () => {
		const resolved = resolveCommand(
			"srv",
			{
				bin: "{root}/bin/srv",
				args: ["--file", "{relFile}", "--ws={workspace}"],
				cwd: "{root}",
				env: { D: "{dir}" },
			},
			{ workspace: "/ws", root: "/ws/pkg", file: "/ws/pkg/src/a.ts" },
		);
		expect(resolved.bin).toBe("/ws/pkg/bin/srv");
		expect(resolved.args).toEqual(["--file", "src/a.ts", "--ws=/ws"]);
		expect(resolved.cwd).toBe("/ws/pkg");
		expect(resolved.env).toEqual({ D: "/ws/pkg/src" });
	});

	it("keeps a bare binary name for PATH lookup and resolves a relative path against the root", () => {
		const options = { workspace: "/ws", root: "/ws/pkg", file: "/ws/pkg/a.ts" };
		expect(resolveCommand("s", { bin: "tsserver" }, options).bin).toBe("tsserver");
		expect(resolveCommand("s", { bin: "./bin/s" }, options).bin).toBe("/ws/pkg/bin/s");
		expect(resolveCommand("s", { bin: "s" }, options).cwd).toBe("/ws/pkg");
	});
});
