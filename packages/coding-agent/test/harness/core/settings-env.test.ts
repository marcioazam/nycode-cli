// Replaces import/ny-pi/bin/test_pi_env.sh for the wrapper behavior that moved into the core (K3/K4):
// the four permission flags, the bypass precedence (flag > NYCODE_BYPASS_PERMISSIONS > settings.json > false) and
// the `--no-approve` the wrapper injected, now the `defaultProjectTrust: "never"` default.
// The local.env loader checks (owner, mode 0600, the nine keys) go with `nycode migrate from-pi`.
import { describe, expect, it, vi } from "vitest";
import { parseArgs, printHelp } from "../../../src/cli/args.ts";
import { InMemorySettingsStorage, SettingsManager } from "../../../src/core/settings-manager.ts";

const manager = (settings: Parameters<typeof SettingsManager.inMemory>[0] = {}) => SettingsManager.inMemory(settings);
const bypass = (argv: string[], settings = manager()) =>
	settings.getBypassPermissions(parseArgs(argv).bypassPermissions);

describe("permission flags", () => {
	it.each([["--bypass"], ["--dangerously-skip-permissions"]])("%s turns bypass on", (flag) => {
		expect(parseArgs([flag]).bypassPermissions).toBe(true);
	});

	it.each([["--safe"], ["--no-bypass"]])("%s turns bypass off", (flag) => {
		expect(parseArgs([flag]).bypassPermissions).toBe(false);
	});

	it("leaves bypass undecided without a flag and keeps the other arguments", () => {
		const args = parseArgs(["-p", "hello"]);
		expect(args.bypassPermissions).toBeUndefined();
		expect(args.messages).toEqual(["hello"]);
	});

	it("takes the last flag when they conflict", () => {
		expect(parseArgs(["--bypass", "--safe"]).bypassPermissions).toBe(false);
		expect(parseArgs(["--safe", "--dangerously-skip-permissions"]).bypassPermissions).toBe(true);
	});

	it("does not read flag text after -- or inside a prompt", () => {
		expect(parseArgs(["-p", "run with --bypass please"]).bypassPermissions).toBeUndefined();
		expect(parseArgs(["--", "--bypass"]).bypassPermissions).toBeUndefined();
	});

	it("lists the four flags in --help", () => {
		const lines: string[] = [];
		vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
		printHelp([]);
		const help = lines.join("\n");
		for (const flag of ["--bypass", "--dangerously-skip-permissions", "--safe", "--no-bypass"]) {
			expect(help).toContain(flag);
		}
	});
});

describe("bypass precedence", () => {
	it("is off by default", () => {
		vi.stubEnv("NYCODE_BYPASS_PERMISSIONS", undefined);
		expect(bypass([])).toBe(false);
	});

	it("takes settings.json over the default", () => {
		vi.stubEnv("NYCODE_BYPASS_PERMISSIONS", undefined);
		expect(bypass([], manager({ permissions: { bypass: true } }))).toBe(true);
	});

	it("takes the variable over settings.json, in both directions", () => {
		vi.stubEnv("NYCODE_BYPASS_PERMISSIONS", "0");
		expect(bypass([], manager({ permissions: { bypass: true } }))).toBe(false);
		vi.stubEnv("NYCODE_BYPASS_PERMISSIONS", "1");
		expect(bypass([], manager({ permissions: { bypass: false } }))).toBe(true);
	});

	it("takes the flag over the variable, in both directions", () => {
		vi.stubEnv("NYCODE_BYPASS_PERMISSIONS", "1");
		expect(bypass(["--safe"], manager({ permissions: { bypass: true } }))).toBe(false);
		expect(bypass(["--no-bypass"])).toBe(false);
		vi.stubEnv("NYCODE_BYPASS_PERMISSIONS", "0");
		expect(bypass(["--bypass"])).toBe(true);
		expect(bypass(["--dangerously-skip-permissions"])).toBe(true);
	});

	it.each([["no"], ["off"], ["FALSE"], ["Off"], [""], ["  "], ["yes please"], ["2"]])(
		"fails closed on the unrecognised or false value %j over settings bypass true",
		(value) => {
			vi.stubEnv("NYCODE_BYPASS_PERMISSIONS", value);
			expect(bypass([], manager({ permissions: { bypass: true } }))).toBe(false);
		},
	);

	it.each([["YES"], ["On"], ["TRUE"], [" 1 "]])("accepts %j as true regardless of case", (value) => {
		vi.stubEnv("NYCODE_BYPASS_PERMISSIONS", value);
		expect(bypass([])).toBe(true);
	});

	it("reports an unrecognised variable once, without its value, and not for a recognised one", () => {
		const settings = manager({ permissions: { bypass: true } });
		vi.stubEnv("NYCODE_BYPASS_PERMISSIONS", "s3cr3t-nope");
		settings.getBypassPermissions();
		settings.getBypassPermissions();
		const errors = settings.drainErrors();
		expect(errors).toHaveLength(1);
		expect(errors[0].error.message).toContain("NYCODE_BYPASS_PERMISSIONS");
		expect(errors[0].error.message).not.toContain("s3cr3t-nope");
		vi.stubEnv("NYCODE_BYPASS_PERMISSIONS", "off");
		expect(manager().getBypassPermissions()).toBe(false);
		expect(settings.drainErrors()).toEqual([]);
	});

	it("keeps the flag above an unrecognised variable", () => {
		vi.stubEnv("NYCODE_BYPASS_PERMISSIONS", "nope");
		expect(bypass(["--bypass"])).toBe(true);
		expect(bypass(["--safe"], manager({ permissions: { bypass: true } }))).toBe(false);
	});

	it("does not let a project settings file switch bypass on", () => {
		vi.stubEnv("NYCODE_BYPASS_PERMISSIONS", undefined);
		const storage = new InMemorySettingsStorage();
		storage.withLock("project", () => JSON.stringify({ permissions: { bypass: true } }));
		expect(SettingsManager.fromStorage(storage).getBypassPermissions()).toBe(false);
	});
});

describe("project trust (the wrapper's --no-approve)", () => {
	it("defaults to never and keeps --approve and --no-approve as explicit overrides", () => {
		expect(manager().getDefaultProjectTrust()).toBe("never");
		expect(parseArgs(["--approve"]).projectTrustOverride).toBe(true);
		expect(parseArgs(["-a"]).projectTrustOverride).toBe(true);
		expect(parseArgs(["--no-approve"]).projectTrustOverride).toBe(false);
		expect(parseArgs(["-p", "x -a y"]).projectTrustOverride).toBeUndefined();
	});
});
