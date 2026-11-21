// Security of the writing side of `migrate from-pi`: file modes from creation, merges that never raise trust.
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

describe("migrate from-pi merges into an existing destination", () => {
	it("merges trust.json with the destination entries prevailing", async () => {
		const h = makeHome();
		mkdirSync(h.agentDir, { recursive: true });
		writeFileSync(join(h.agentDir, "trust.json"), JSON.stringify({ "/work/proj": false, "/mine": true }));
		await h.run(["--apply"]);
		expect(JSON.parse(readFileSync(join(h.agentDir, "trust.json"), "utf8"))).toEqual({
			"/work/proj": false,
			"/mine": true,
		});
	});

	it("adds origin trust entries the destination does not have", async () => {
		const h = makeHome();
		mkdirSync(h.agentDir, { recursive: true });
		writeFileSync(join(h.agentDir, "trust.json"), JSON.stringify({ "/mine": true }));
		await h.run(["--apply"]);
		expect(JSON.parse(readFileSync(join(h.agentDir, "trust.json"), "utf8"))).toEqual({
			"/work/proj": true,
			"/mine": true,
		});
	});

	it("keeps the security keys already present in the destination settings.json and says so", async () => {
		const h = makeHome();
		writeFileSync(
			join(h.source, "settings.json"),
			JSON.stringify({
				defaultProjectTrust: "always",
				packages: ["npm:evil@1.0.0"],
				hooks: { PreToolUse: ["evil"] },
				shellCommandPrefix: "evil;",
				theme: "tokyo-night",
			}),
		);
		mkdirSync(h.agentDir, { recursive: true });
		writeFileSync(
			join(h.agentDir, "settings.json"),
			JSON.stringify({ defaultProjectTrust: "never", permissions: { bypass: false }, theme: "old", mine: 1 }),
		);
		await h.run(["--apply"]);
		const s = JSON.parse(readFileSync(join(h.agentDir, "settings.json"), "utf8"));
		expect(s.defaultProjectTrust).toBe("never");
		expect(s.permissions).toEqual({ bypass: false });
		expect(s.mine).toBe(1);
		expect(s.theme).toBe("tokyo-night");
		// keys absent from the destination come from the origin
		expect(s.packages).toEqual(["npm:evil@1.0.0"]);
		expect(h.out.join("\n")).toMatch(/kept destination value.*defaultProjectTrust.*permissions/s);
	});

	it("does not let local.env raise permissions.bypass over an existing destination permissions", async () => {
		const h = makeHome();
		mkdirSync(h.agentDir, { recursive: true });
		writeFileSync(join(h.agentDir, "settings.json"), JSON.stringify({ permissions: { bypass: false } }));
		await h.run(["--apply"]);
		expect(JSON.parse(readFileSync(join(h.agentDir, "settings.json"), "utf8")).permissions).toEqual({
			bypass: false,
		});
	});

	it("refuses an invalid destination trust.json without echoing its content", async () => {
		const h = makeHome();
		mkdirSync(h.agentDir, { recursive: true });
		writeFileSync(join(h.agentDir, "trust.json"), '{"secret-path-zzz": oops}');
		expect(await h.run(["--apply"])).toBe(1);
		expect(h.err.join("\n")).not.toContain("secret-path-zzz");
	});
});
