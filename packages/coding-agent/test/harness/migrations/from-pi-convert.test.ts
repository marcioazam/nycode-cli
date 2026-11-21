// Settings conversion of `migrate from-pi`: the nine local.env keys, packages, mcp placeholders and plain copies.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeHome, ph, SECRET } from "./from-pi-fixture.ts";

const read = (dir: string, name: string) => JSON.parse(readFileSync(join(dir, name), "utf8"));

describe("migrate from-pi conversion", () => {
	it("maps the local.env keys to settings.json keys", async () => {
		const h = makeHome();
		expect(await h.run(["--apply"])).toBe(0);
		const s = read(h.agentDir, "settings.json");
		expect(s.permissions).toEqual({ bypass: true });
		expect(s.compaction).toEqual({ enabled: true, maxContextTokens: 200000 });
		expect(s.knowledge).toEqual({ vault: "/vault/notes", graphsVault: "/vault/graphs" });
		expect(s.codegraph).toEqual({ autoRoot: "/src" });
		expect(s.subagent).toEqual({ respawn: false });
		expect(s.harness).toEqual({ effortSandwich: { enabled: true, turns: 2 } });
		expect(s.theme).toBe("tokyo-night");
		expect(s.quietStartup).toBe("header");
	});

	it("keeps PONYTAIL_QUIET_STARTUP out of settings and tells the user", async () => {
		const h = makeHome();
		await h.run(["--apply"]);
		expect(JSON.stringify(read(h.agentDir, "settings.json"))).not.toMatch(/ponytail/i);
		expect(h.out.join("\n")).toContain("PONYTAIL_QUIET_STARTUP");
	});

	it("drops the embedded packages and reports ponytail for installation", async () => {
		const h = makeHome();
		await h.run(["--apply"]);
		expect(read(h.agentDir, "settings.json").packages).toEqual(["npm:some-other-package@1.0.0"]);
		expect(h.out.join("\n")).toMatch(/install.*ponytail|ponytail.*install/i);
	});

	it("replaces literal mcp secrets with env placeholders and keeps the rest", async () => {
		const h = makeHome();
		await h.run(["--apply"]);
		const raw = readFileSync(join(h.agentDir, "mcp.json"), "utf8");
		expect(raw).not.toContain(SECRET);
		const mcp = JSON.parse(raw).mcpServers;
		expect(mcp.search.env).toEqual({ SEARCH_API_KEY: ph("SEARCH_API_KEY"), KEEP: ph("KEEP"), MODE: "fast" });
		expect(mcp.exa.headers["x-api-key"]).toMatch(/^\$\{[A-Z0-9_]+\}$/);
		expect(h.out.join("\n")).toContain("SEARCH_API_KEY");
	});

	it("copies models, lsp, keybindings, trust and sessions", async () => {
		const h = makeHome();
		await h.run(["--apply"]);
		expect(read(h.agentDir, "models.json")).toEqual({ providers: {} });
		expect(read(h.agentDir, "lsp.json").version).toBe(1);
		expect(read(h.agentDir, "keybindings.json")).toEqual({});
		expect(read(h.agentDir, "trust.json")).toEqual({ "/work/proj": true });
		expect(readFileSync(join(h.agentDir, "sessions", "--proj--", "a.jsonl"), "utf8")).toContain("session");
	});
});
