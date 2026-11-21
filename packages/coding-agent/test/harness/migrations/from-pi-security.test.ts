// Security of the writing side of `migrate from-pi`: file modes from creation, merges that never raise trust.
import { chmodSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeHome } from "./from-pi-fixture.ts";

const mode = (path: string) => statSync(path).mode & 0o777;
const yes = async () => true;

let previousUmask = 0;
beforeEach(() => {
	previousUmask = process.umask(0o022);
});
afterEach(() => {
	process.umask(previousUmask);
});

describe("migrate from-pi file modes", () => {
	it("creates settings, mcp and auth with 0600 and the agent directory with 0700 under umask 022", async () => {
		const h = makeHome();
		chmodSync(join(h.source, "auth.json"), 0o644);
		expect(await h.run(["--apply"], { isInteractive: true, confirm: yes })).toBe(0);
		for (const name of ["settings.json", "mcp.json", "auth.json"]) expect(mode(join(h.agentDir, name))).toBe(0o600);
		expect(mode(h.agentDir)).toBe(0o700);
		expect(readdirSync(h.agentDir).filter((n) => n.includes(".tmp"))).toEqual([]);
	});

	it("creates the backup directories with 0700 and the sensitive backups with 0600", async () => {
		const h = makeHome();
		mkdirSync(h.agentDir, { recursive: true });
		for (const name of ["settings.json", "auth.json"]) writeFileSync(join(h.agentDir, name), "{}", { mode: 0o644 });
		await h.run(["--apply"], { isInteractive: true, confirm: yes });
		const root = join(h.agentDir, ".backup-from-pi");
		const [stamp] = readdirSync(root);
		expect(mode(root)).toBe(0o700);
		expect(mode(join(root, stamp))).toBe(0o700);
		for (const name of ["settings.json", "auth.json"]) expect(mode(join(root, stamp, name))).toBe(0o600);
	});
});
