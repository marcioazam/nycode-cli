// `nycode migrate from-pi` plan mode: default dry run writes nothing, leaves the origin intact and never prints secrets.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hashTree, makeHome, SECRET } from "./from-pi-fixture.ts";

describe("migrate from-pi dry run", () => {
	it("writes nothing by default and prints the plan", async () => {
		const h = makeHome();
		const code = await h.run([]);
		expect(code).toBe(0);
		expect(existsSync(h.agentDir)).toBe(false);
		const text = h.out.join("\n");
		expect(text).toContain("dry run");
		expect(text).toContain("settings.json");
		expect(text).toContain("--apply");
	});

	it("leaves the origin byte-identical, with and without --apply", async () => {
		const h = makeHome();
		const before = hashTree(h.source);
		await h.run([]);
		await h.run(["--apply"]);
		expect(hashTree(h.source)).toEqual(before);
	});

	it("never prints secret values, in the plan or after applying", async () => {
		const h = makeHome();
		await h.run([]);
		await h.run(["--apply"], { isInteractive: true, confirm: async () => true });
		expect([...h.out, ...h.err].join("\n")).not.toContain(SECRET);
	});

	it("reports ponytail as a package to install and skips auth in dry run", async () => {
		const h = makeHome();
		await h.run([]);
		const text = h.out.join("\n");
		expect(text).toMatch(/ponytail/);
		expect(text).toMatch(/auth\.json.*(--apply|interactive)/);
	});

	it("rejects a missing source directory", async () => {
		const h = makeHome();
		const code = await h.run(["--from", `${h.home}/nowhere`]);
		expect(code).toBe(1);
		expect(h.err.join("\n")).toContain("nowhere");
	});

	it("prints help", async () => {
		const h = makeHome();
		expect(await h.run(["--help"])).toBe(0);
		expect(h.out.join("\n")).toContain("--apply");
	});

	it("reports a JSON syntax error by file and position without echoing the content", async () => {
		const h = makeHome();
		writeFileSync(join(h.source, "settings.json"), '{"a": 1 "b": "sk-secret-zzz"}');
		expect(await h.run([])).toBe(1);
		const text = h.err.join("\n");
		expect(text).toContain("settings.json");
		expect(text).toMatch(/position \d+/);
		expect(text).not.toContain("sk-secret-zzz");
	});

	it("skips settings.json, mcp.json and sessions/ when they are symlinks, saying so", async () => {
		const h = makeHome();
		for (const name of ["settings.json", "mcp.json", "sessions"]) {
			cpSync(join(h.source, name), join(h.home, `real-${name}`), { recursive: true });
			rmSync(join(h.source, name), { recursive: true });
			symlinkSync(join(h.home, `real-${name}`), join(h.source, name));
		}
		expect(await h.run(["--apply"])).toBe(0);
		expect(existsSync(join(h.agentDir, "mcp.json"))).toBe(false);
		expect(existsSync(join(h.agentDir, "sessions"))).toBe(false);
		// local.env still converts into a settings.json that holds none of the symlinked file's keys
		expect(readFileSync(join(h.agentDir, "settings.json"), "utf8")).not.toContain("tokyo-night");
		expect(h.out.join("\n")).toMatch(/settings\.json is not a regular file/);
		expect(h.out.join("\n")).toMatch(/mcp\.json is not a regular file/);
		expect(h.out.join("\n")).toMatch(/sessions is not a regular directory/);
	});

	it("warns that origin packages, hooks, shellCommandPrefix and mcp commands run code when --from is not the default", async () => {
		const h = makeHome();
		writeFileSync(
			join(h.source, "settings.json"),
			JSON.stringify({ packages: ["npm:x@1.0.0"], hooks: { a: 1 }, shellCommandPrefix: "p;" }),
		);
		const other = join(h.home, "other");
		cpSync(h.source, other, { recursive: true });
		await h.run(["--from", other]);
		const text = h.out.join("\n");
		expect(text).toMatch(
			/not the default.*run code.*packages.*hooks.*shellCommandPrefix.*mcp\.json command \(search\)/s,
		);
	});

	it("does not warn about code execution for the default origin", async () => {
		const h = makeHome();
		await h.run([]);
		expect(h.out.join("\n")).not.toMatch(/run code/);
	});

	it("lists the memory directory in the plan and writes nothing (P-20)", async () => {
		const h = makeHome();
		mkdirSync(join(h.source, "memory", "proj-slug"), { recursive: true });
		writeFileSync(join(h.source, "memory", "proj-slug", "MEMORY.md"), "index\n");
		expect(await h.run([])).toBe(0);
		expect(h.out.join("\n")).toMatch(/memory\/\s+1 file\(s\) to copy, 0 already present/);
		expect(existsSync(h.agentDir)).toBe(false);
	});

	it("skips a memory symlink, saying so", async () => {
		const h = makeHome();
		mkdirSync(join(h.home, "real-memory"));
		symlinkSync(join(h.home, "real-memory"), join(h.source, "memory"));
		expect(await h.run(["--apply"])).toBe(0);
		expect(existsSync(join(h.agentDir, "memory"))).toBe(false);
		expect(h.out.join("\n")).toMatch(/memory is not a regular directory/);
	});
});
