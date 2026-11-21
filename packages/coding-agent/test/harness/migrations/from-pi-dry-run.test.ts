// `nycode migrate from-pi` plan mode: default dry run writes nothing, leaves the origin intact and never prints secrets.
import { existsSync } from "node:fs";
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
});
