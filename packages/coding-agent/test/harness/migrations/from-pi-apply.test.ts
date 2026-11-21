// Writing side of `migrate from-pi`: backups, credentials confirmation, existing sessions kept.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { makeHome, SECRET } from "./from-pi-fixture.ts";

describe("migrate from-pi --apply", () => {
	it("backs up an existing destination file before overwriting it", async () => {
		const h = makeHome();
		mkdirSync(h.agentDir, { recursive: true });
		writeFileSync(join(h.agentDir, "settings.json"), '{"theme":"old"}');
		expect(await h.run(["--apply"])).toBe(0);
		const root = join(h.agentDir, ".backup-from-pi");
		const [stamp] = readdirSync(root);
		expect(readFileSync(join(root, stamp, "settings.json"), "utf8")).toBe('{"theme":"old"}');
		expect(JSON.parse(readFileSync(join(h.agentDir, "settings.json"), "utf8")).theme).toBe("tokyo-night");
	});

	it("creates no backup directory when nothing existed", async () => {
		const h = makeHome();
		await h.run(["--apply"]);
		expect(existsSync(join(h.agentDir, ".backup-from-pi"))).toBe(false);
	});

	it("asks before copying auth.json and copies it with mode 0600 when confirmed", async () => {
		const h = makeHome();
		const confirm = vi.fn(async (_question: string) => true);
		await h.run(["--apply"], { isInteractive: true, confirm });
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(confirm.mock.calls[0]?.[0]).toContain("auth.json");
		expect(readFileSync(join(h.agentDir, "auth.json"), "utf8")).toContain(SECRET);
		expect(statSync(join(h.agentDir, "auth.json")).mode & 0o777).toBe(0o600);
	});

	it("skips auth.json when the user declines", async () => {
		const h = makeHome();
		await h.run(["--apply"], { isInteractive: true, confirm: async () => false });
		expect(existsSync(join(h.agentDir, "auth.json"))).toBe(false);
	});

	it("skips auth.json without a terminal and never asks", async () => {
		const h = makeHome();
		const confirm = vi.fn(async (_question: string) => true);
		await h.run(["--apply"], { isInteractive: false, confirm });
		expect(confirm).not.toHaveBeenCalled();
		expect(existsSync(join(h.agentDir, "auth.json"))).toBe(false);
		expect(h.out.join("\n")).toMatch(/auth\.json.*(terminal|interactive)/);
	});

	it("keeps sessions that already exist in the destination", async () => {
		const h = makeHome();
		const target = join(h.agentDir, "sessions", "--proj--");
		mkdirSync(target, { recursive: true });
		writeFileSync(join(target, "a.jsonl"), "mine\n");
		await h.run(["--apply"]);
		expect(readFileSync(join(target, "a.jsonl"), "utf8")).toBe("mine\n");
	});

	it("is idempotent: a second run reports unchanged files and makes no backup", async () => {
		const h = makeHome();
		await h.run(["--apply"]);
		await h.run(["--apply"]);
		expect(existsSync(join(h.agentDir, ".backup-from-pi"))).toBe(false);
	});

	it("copies the memory directory, nested files included, and keeps existing destination files (P-20)", async () => {
		const h = makeHome();
		const nested = join(h.source, "memory", "proj-slug");
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(nested, "MEMORY.md"), "index\n");
		writeFileSync(join(nested, "note.md"), "note\n");
		const target = join(h.agentDir, "memory", "proj-slug");
		mkdirSync(target, { recursive: true });
		writeFileSync(join(target, "note.md"), "mine\n");
		await h.run(["--apply"]);
		expect(readFileSync(join(target, "MEMORY.md"), "utf8")).toBe("index\n");
		expect(readFileSync(join(target, "note.md"), "utf8")).toBe("mine\n");
		expect(existsSync(join(h.agentDir, ".backup-from-pi"))).toBe(false);
	});

	it("does not fail when the origin has no memory directory", async () => {
		const h = makeHome();
		expect(await h.run(["--apply"])).toBe(0);
		expect(existsSync(join(h.agentDir, "memory"))).toBe(false);
	});
});
