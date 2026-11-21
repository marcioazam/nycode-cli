// Settings conversion of `migrate from-pi`: the nine local.env keys, packages, mcp placeholders and plain copies.
import { readFileSync, writeFileSync } from "node:fs";
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
		expect(mcp.search.env).toEqual({
			SEARCH_API_KEY: ph("SEARCH_SEARCH_API_KEY"),
			KEEP: ph("KEEP"),
			MODE: ph("SEARCH_MODE"),
		});
		expect(mcp.exa.headers["x-api-key"]).toMatch(/^\$\{[A-Z0-9_]+\}$/);
		expect(h.out.join("\n")).toContain("SEARCH_SEARCH_API_KEY");
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

	it("replaces every literal env and headers value, keeping only the Bearer/Basic prefix and existing placeholders", async () => {
		const h = makeHome();
		writeFileSync(
			join(h.source, "mcp.json"),
			JSON.stringify({
				mcpServers: {
					api: {
						url: "https://example.test/mcp",
						headers: {
							Authorization: "Basic dXNlcjpwdw==",
							"x-custom": "plainvalue",
							"x-ok": `Bearer ${ph("TOK")}`,
							"x-mixed": `pre-${ph("TOK")}-post`,
						},
						env: { PLAIN: "visible", OK: ph("OK") },
					},
				},
			}),
		);
		await h.run(["--apply"]);
		const raw = readFileSync(join(h.agentDir, "mcp.json"), "utf8");
		for (const leaked of ["dXNlcjpwdw==", "plainvalue", "pre-", "visible"]) expect(raw).not.toContain(leaked);
		const api = JSON.parse(raw).mcpServers.api;
		expect(api.headers.Authorization).toBe(`Basic ${ph("API_AUTHORIZATION")}`);
		expect(api.headers["x-custom"]).toBe(ph("API_X_CUSTOM"));
		expect(api.headers["x-ok"]).toBe(`Bearer ${ph("TOK")}`);
		expect(api.headers["x-mixed"]).toBe(ph("API_X_MIXED"));
		expect(api.env).toEqual({ PLAIN: ph("API_PLAIN"), OK: ph("OK") });
	});

	it("lists credential-like args and urls as not migrated, by server and field, never by value", async () => {
		const h = makeHome();
		writeFileSync(
			join(h.source, "mcp.json"),
			JSON.stringify({
				mcpServers: {
					gh: {
						command: "npx",
						args: ["-y", "srv", "--token=ghp_value123", "--api-key", "abcd1234", "--verbose"],
					},
					web: { url: "https://user:hunter22@host.test/mcp?api_key=zzz999" },
					q: { url: "https://host.test/mcp?x=1&token=tok888" },
					clean: {
						command: "npx",
						args: ["-y", "srv", `--token=${ph("GH_TOKEN")}`],
						url: `https://host.test/mcp?key=${ph("K")}`,
					},
				},
			}),
		);
		await h.run([]);
		const text = h.out.join("\n");
		expect(text).toMatch(/not migrated automatically.*gh\.args\[2\].*gh\.args\[3\]/s);
		expect(text).toContain("web.url");
		expect(text).toContain("q.url");
		expect(text).not.toMatch(/clean\./);
		for (const leaked of ["ghp_value123", "abcd1234", "hunter22", "zzz999", "tok888"])
			expect(text).not.toContain(leaked);
	});

	it("labels the mcp.json plan entry for what it does", async () => {
		const h = makeHome();
		await h.run([]);
		expect(h.out.join("\n")).toMatch(/mcp\.json\s+\(.*env and headers values replaced.*args and url copied as is/);
	});

	it("gives env placeholders of different servers distinct names, listed once each", async () => {
		const h = makeHome();
		writeFileSync(
			join(h.source, "mcp.json"),
			JSON.stringify({
				mcpServers: {
					one: { command: "a", env: { API_KEY: "v1" } },
					two: { command: "b", env: { API_KEY: "v2" } },
					"a-b": { command: "c", env: { c: "v3" } },
					a: { command: "d", env: { b_c: "v4" } },
				},
			}),
		);
		await h.run(["--apply"]);
		const servers = JSON.parse(readFileSync(join(h.agentDir, "mcp.json"), "utf8")).mcpServers;
		const names = Object.values(servers).map(
			(server) => Object.values((server as { env: Record<string, string> }).env)[0],
		);
		expect(names[0]).toBe(ph("ONE_API_KEY"));
		expect(names[1]).toBe(ph("TWO_API_KEY"));
		expect(new Set(names).size).toBe(4);
		const note = h.out.find((line) => line.includes("export these variables")) ?? "";
		const listed = note.split(": ").pop()?.split(", ") ?? [];
		expect(listed).toHaveLength(4);
		expect(new Set(listed).size).toBe(4);
	});
});
