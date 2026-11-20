import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { delimiter, join } from "path";
import { afterEach, describe, expect, test } from "vitest";
import {
	detectInstallChange,
	detectInstallMethod,
	findNodePackageDir,
	getConfiguredSelfUpdateArgv,
	getSelfUpdateCommand,
	getSelfUpdateUnavailableInstruction,
	getUpdateInstruction,
	makeConfiguredSelfUpdateCommand,
} from "../src/config.ts";

const execPathDescriptor = Object.getOwnPropertyDescriptor(process, "execPath");
const originalPath = process.env.PATH;
const originalNycodePackageDir = process.env.NYCODE_PACKAGE_DIR;
const originalArgv1 = process.argv[1];
let tempDir: string | undefined;

function setExecPath(value: string): void {
	Object.defineProperty(process, "execPath", {
		value,
		configurable: true,
	});
}

afterEach(() => {
	if (execPathDescriptor) {
		Object.defineProperty(process, "execPath", execPathDescriptor);
	}
	if (originalPath === undefined) {
		delete process.env.PATH;
	} else {
		process.env.PATH = originalPath;
	}
	if (originalNycodePackageDir === undefined) {
		delete process.env.NYCODE_PACKAGE_DIR;
	} else {
		process.env.NYCODE_PACKAGE_DIR = originalNycodePackageDir;
	}
	if (originalArgv1 === undefined) {
		process.argv.splice(1, 1);
	} else {
		process.argv[1] = originalArgv1;
	}
	if (tempDir) {
		chmodSync(tempDir, 0o700);
		rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

function createNpmPrefixInstall(template = "nycode-prefix-"): { prefix: string; packageDir: string } {
	const prefix = mkdtempSync(join(tmpdir(), template));
	const root = join(prefix, "lib", "node_modules");
	const scopeDir = join(root, "@nycode");
	const packageDir = join(scopeDir, "nycode-coding-agent");
	mkdirSync(packageDir, { recursive: true });
	tempDir = prefix;
	process.env.NYCODE_PACKAGE_DIR = packageDir;
	setExecPath(join(packageDir, "dist", "cli.js"));
	return { prefix, packageDir };
}

function createPnpmGlobalInstall(): { root: string; packageDir: string } {
	const temp = mkdtempSync(join(tmpdir(), "nycode-pnpm-"));
	const binDir = join(temp, "bin");
	const root = join(temp, "pnpm", "global", "5", "node_modules");
	const packageDir = join(root, "@mariozechner", "nycode-coding-agent");
	mkdirSync(packageDir, { recursive: true });
	mkdirSync(binDir, { recursive: true });
	writeFileSync(join(binDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm"), createFakePnpmScript(root));
	chmodSync(join(binDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm"), 0o755);
	tempDir = temp;
	process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;
	process.env.NYCODE_PACKAGE_DIR = packageDir;
	setExecPath(
		join(
			root,
			".pnpm",
			"@mariozechner+nycode-coding-agent@0.0.0",
			"node_modules",
			"@mariozechner",
			"nycode-coding-agent",
			"dist",
			"cli.js",
		),
	);
	return { root, packageDir };
}

function createYarnGlobalInstall(): { globalDir: string; packageDir: string } {
	const temp = mkdtempSync(join(tmpdir(), "nycode-yarn-"));
	const binDir = join(temp, "bin");
	const globalDir = join(temp, "yarn", "global");
	const packageDir = join(globalDir, "node_modules", "@mariozechner", "nycode-coding-agent");
	mkdirSync(packageDir, { recursive: true });
	mkdirSync(binDir, { recursive: true });
	writeFileSync(join(binDir, process.platform === "win32" ? "yarn.cmd" : "yarn"), createFakeYarnScript(globalDir));
	chmodSync(join(binDir, process.platform === "win32" ? "yarn.cmd" : "yarn"), 0o755);
	tempDir = temp;
	process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;
	process.env.NYCODE_PACKAGE_DIR = packageDir;
	setExecPath(join(globalDir, ".yarn", "@mariozechner", "nycode-coding-agent", "dist", "cli.js"));
	return { globalDir, packageDir };
}

function createBunGlobalInstall(): { packageDir: string } {
	const temp = mkdtempSync(join(tmpdir(), "nycode-bun-"));
	const prefix = join(temp, ".bun");
	const bunBin = join(prefix, "bin");
	const root = join(prefix, "install", "global", "node_modules");
	const scopeDir = join(root, "@nycode");
	const packageDir = join(scopeDir, "nycode-coding-agent");
	mkdirSync(packageDir, { recursive: true });
	mkdirSync(bunBin, { recursive: true });
	writeFileSync(join(bunBin, process.platform === "win32" ? "bun.cmd" : "bun"), createFakeBunScript(bunBin));
	chmodSync(join(bunBin, process.platform === "win32" ? "bun.cmd" : "bun"), 0o755);
	tempDir = temp;
	process.env.PATH = `${bunBin}${delimiter}${originalPath ?? ""}`;
	process.env.NYCODE_PACKAGE_DIR = packageDir;
	setExecPath(join(packageDir, "dist", "cli.js"));
	return { packageDir };
}

function createFakePnpmScript(root: string): string {
	if (process.platform === "win32") {
		return `@echo off\r\nif "%1"=="root" if "%2"=="-g" echo ${root}\r\n`;
	}
	const escapedRoot = root.replaceAll("'", "'\\''");
	return `#!/bin/sh\nif [ "$1" = "root" ] && [ "$2" = "-g" ]; then\n\tprintf '%s\\n' '${escapedRoot}'\n\texit 0\nfi\nexit 1\n`;
}

function createFakeYarnScript(globalDir: string): string {
	if (process.platform === "win32") {
		return `@echo off\r\nif "%1"=="global" if "%2"=="dir" echo ${globalDir}\r\n`;
	}
	const escapedGlobalDir = globalDir.replaceAll("'", "'\\''");
	return `#!/bin/sh\nif [ "$1" = "global" ] && [ "$2" = "dir" ]; then\n\tprintf '%s\\n' '${escapedGlobalDir}'\n\texit 0\nfi\nexit 1\n`;
}

function createFakeBunScript(bunBin: string): string {
	if (process.platform === "win32") {
		return `@echo off\r\nif "%1"=="pm" if "%2"=="bin" if "%3"=="-g" echo ${bunBin}\r\n`;
	}
	const escapedBunBin = bunBin.replaceAll("'", "'\\''");
	return `#!/bin/sh\nif [ "$1" = "pm" ] && [ "$2" = "bin" ] && [ "$3" = "-g" ]; then\n\tprintf '%s\\n' '${escapedBunBin}'\n\texit 0\nfi\nexit 1\n`;
}

describe("findNodePackageDir", () => {
	test("skips binary metadata copied into dist", () => {
		tempDir = mkdtempSync(join(tmpdir(), "nycode-package-dir-"));
		const distDir = join(tempDir, "dist");
		const bundleDir = join(distDir, "bundle");
		mkdirSync(bundleDir, { recursive: true });
		writeFileSync(join(tempDir, "package.json"), "{}");
		writeFileSync(join(distDir, "package.json"), "{}");

		expect(findNodePackageDir(bundleDir)).toBe(tempDir);
	});
});

describe("detectInstallMethod", () => {
	test("detects pnpm from Windows .pnpm install paths", () => {
		setExecPath(
			"C:\\Users\\Admin\\Documents\\pnpm-repository\\global\\5\\.pnpm\\@nycode+coding-agent@0.67.68\\node_modules\\@nycode\\coding-agent\\dist\\cli.js",
		);

		expect(detectInstallMethod()).toBe("pnpm");
		expect(getUpdateInstruction("@nycode/coding-agent")).toBe(
			"Run: pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 @nycode/coding-agent",
		);
	});

	test("does not self-update unknown wrapper installs", () => {
		setExecPath("/usr/local/bin/node");

		expect(detectInstallMethod()).toBe("unknown");
		expect(getSelfUpdateCommand("@nycode/coding-agent")).toBeUndefined();
		expect(getUpdateInstruction("@nycode/coding-agent")).toBe(
			"Update @nycode/coding-agent using the package manager, wrapper, or source checkout that provides this installation.",
		);
	});

	// Issue #7756
	test("does not name pnpm for unmanaged installs under PNPM_HOME", () => {
		tempDir = mkdtempSync(join(tmpdir(), "nycode-pnpm-home-"));
		const packageDir = join(
			tempDir,
			".local",
			"share",
			"pnpm",
			"global-nub",
			"5",
			"node_modules",
			"@nycode",
			"coding-agent",
		);
		mkdirSync(packageDir, { recursive: true });
		process.env.NYCODE_PACKAGE_DIR = packageDir;
		process.env.PATH = "";
		process.argv[1] = join(packageDir, "dist", "cli.js");
		setExecPath(join(packageDir, "dist", "cli.js"));

		expect(detectInstallMethod()).toBe("pnpm");
		expect(getSelfUpdateCommand("@nycode/coding-agent")).toBeUndefined();
		expect(getSelfUpdateUnavailableInstruction("@nycode/coding-agent")).toBe(
			"Update @nycode/coding-agent using the package manager, wrapper, or source checkout that provides this installation.",
		);
	});

	test("self-updates npm installs from custom prefixes", () => {
		const { prefix } = createNpmPrefixInstall();

		const command = getSelfUpdateCommand("@nycode/coding-agent");

		expect(detectInstallMethod()).toBe("npm");
		expect(command).toEqual({
			command: "npm",
			args: ["--prefix", prefix, "install", "-g", "--ignore-scripts", "--min-release-age=0", "@nycode/coding-agent"],
			display: `npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @nycode/coding-agent`,
		});
	});

	test("self-updates exact npm versions without uninstalling the current package", () => {
		const { prefix } = createNpmPrefixInstall();

		const command = getSelfUpdateCommand("@nycode/coding-agent", undefined, {
			packageName: "@nycode/coding-agent",
			installSpec: "@nycode/coding-agent@1.2.3",
		});

		expect(command).toEqual({
			command: "npm",
			args: [
				"--prefix",
				prefix,
				"install",
				"-g",
				"--ignore-scripts",
				"--min-release-age=0",
				"@nycode/coding-agent@1.2.3",
			],
			display: `npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @nycode/coding-agent@1.2.3`,
		});
	});

	test("self-updates renamed packages from the current install prefix", () => {
		const { prefix } = createNpmPrefixInstall();

		const command = getSelfUpdateCommand("@mariozechner/pi-coding-agent", undefined, "@new-scope/nycode");

		expect(command).toEqual({
			command: "npm",
			args: ["--prefix", prefix, "install", "-g", "--ignore-scripts", "--min-release-age=0", "@new-scope/nycode"],
			display: `npm --prefix ${prefix} uninstall -g @mariozechner/pi-coding-agent && npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @new-scope/nycode`,
			steps: [
				{
					command: "npm",
					args: ["--prefix", prefix, "uninstall", "-g", "@mariozechner/pi-coding-agent"],
					display: `npm --prefix ${prefix} uninstall -g @mariozechner/pi-coding-agent`,
				},
				{
					command: "npm",
					args: [
						"--prefix",
						prefix,
						"install",
						"-g",
						"--ignore-scripts",
						"--min-release-age=0",
						"@new-scope/nycode",
					],
					display: `npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @new-scope/nycode`,
				},
			],
		});
	});

	test("self-update respects configured npmCommand", () => {
		const { prefix } = createNpmPrefixInstall();

		const command = getSelfUpdateCommand("@nycode/coding-agent", ["npm", "--prefix", prefix]);

		expect(command).toEqual({
			command: "npm",
			args: ["--prefix", prefix, "install", "-g", "--ignore-scripts", "--min-release-age=0", "@nycode/coding-agent"],
			display: `npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @nycode/coding-agent`,
		});
	});

	test("self-update treats empty npmCommand as unset", () => {
		const { prefix } = createNpmPrefixInstall();

		const command = getSelfUpdateCommand("@nycode/coding-agent", []);

		expect(command?.args).toEqual([
			"--prefix",
			prefix,
			"install",
			"-g",
			"--ignore-scripts",
			"--min-release-age=0",
			"@nycode/coding-agent",
		]);
	});

	test("quotes npm self-update display paths", () => {
		const { prefix } = createNpmPrefixInstall("nycode prefix ");

		const command = getSelfUpdateCommand("@nycode/coding-agent");

		expect(command?.display).toBe(
			`npm --prefix "${prefix}" install -g --ignore-scripts --min-release-age=0 @nycode/coding-agent`,
		);
	});

	test("does not infer Windows npm custom prefixes from package paths", () => {
		const packageDir = "C:\\Users\\Admin\\npm prefix\\node_modules\\@nycode\\coding-agent";
		process.env.NYCODE_PACKAGE_DIR = packageDir;
		setExecPath(`${packageDir}\\dist\\cli.js`);

		expect(detectInstallMethod()).toBe("npm");
		expect(getUpdateInstruction("@nycode/coding-agent")).toBe(
			"Run: npm install -g --ignore-scripts --min-release-age=0 @nycode/coding-agent",
		);
	});

	test("self-updates bun global installs from bun pm bin", () => {
		createBunGlobalInstall();

		const command = getSelfUpdateCommand("@nycode/coding-agent");

		expect(detectInstallMethod()).toBe("bun");
		expect(command).toEqual({
			command: "bun",
			args: ["install", "-g", "--ignore-scripts", "--minimum-release-age=0", "@nycode/coding-agent"],
			display: "bun install -g --ignore-scripts --minimum-release-age=0 @nycode/coding-agent",
		});
	});

	test("self-updates renamed pnpm global installs by removing the old package first", () => {
		createPnpmGlobalInstall();

		const command = getSelfUpdateCommand("@mariozechner/pi-coding-agent", undefined, "@new-scope/nycode");

		expect(detectInstallMethod()).toBe("pnpm");
		expect(command).toEqual({
			command: "pnpm",
			args: ["install", "-g", "--ignore-scripts", "--config.minimumReleaseAge=0", "@new-scope/nycode"],
			display:
				"pnpm remove -g @mariozechner/pi-coding-agent && pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 @new-scope/nycode",
			steps: [
				{
					command: "pnpm",
					args: ["remove", "-g", "@mariozechner/pi-coding-agent"],
					display: "pnpm remove -g @mariozechner/pi-coding-agent",
				},
				{
					command: "pnpm",
					args: ["install", "-g", "--ignore-scripts", "--config.minimumReleaseAge=0", "@new-scope/nycode"],
					display: "pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 @new-scope/nycode",
				},
			],
		});
	});

	test("self-updates pnpm v11 global installs resolved through the store", () => {
		const temp = mkdtempSync(join(tmpdir(), "nycode-pnpm11-"));
		const binDir = join(temp, "bin");
		const root = join(temp, "Library", "pnpm", "global", "v11");
		const packageName = "@nycode/coding-agent";
		const globalPackageDir = join(root, "11e9a", "node_modules", "@nycode", "coding-agent");
		const storePackageDir = join(
			temp,
			"Library",
			"pnpm",
			"store",
			"v11",
			"links",
			"@nycode",
			"coding-agent",
			"0.75.0",
			"hash",
			"node_modules",
			"@nycode",
			"coding-agent",
		);
		mkdirSync(globalPackageDir, { recursive: true });
		mkdirSync(storePackageDir, { recursive: true });
		mkdirSync(binDir, { recursive: true });
		writeFileSync(join(globalPackageDir, "package.json"), "{}");
		writeFileSync(join(binDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm"), createFakePnpmScript(root));
		chmodSync(join(binDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm"), 0o755);
		tempDir = temp;
		process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;
		process.env.NYCODE_PACKAGE_DIR = storePackageDir;
		process.argv[1] = join(globalPackageDir, "dist", "cli.js");
		setExecPath(join(storePackageDir, "dist", "cli.js"));

		const command = getSelfUpdateCommand(packageName);

		expect(detectInstallMethod()).toBe("pnpm");
		expect(command).toEqual({
			command: "pnpm",
			args: ["install", "-g", "--ignore-scripts", "--config.minimumReleaseAge=0", packageName],
			display: `pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 ${packageName}`,
		});
	});

	test("self-updates renamed yarn global installs by removing the old package first", () => {
		createYarnGlobalInstall();

		const command = getSelfUpdateCommand("@mariozechner/pi-coding-agent", undefined, "@new-scope/nycode");

		expect(detectInstallMethod()).toBe("yarn");
		expect(command).toEqual({
			command: "yarn",
			args: ["global", "add", "--ignore-scripts", "@new-scope/nycode"],
			display:
				"yarn global remove @mariozechner/pi-coding-agent && yarn global add --ignore-scripts @new-scope/nycode",
			steps: [
				{
					command: "yarn",
					args: ["global", "remove", "@mariozechner/pi-coding-agent"],
					display: "yarn global remove @mariozechner/pi-coding-agent",
				},
				{
					command: "yarn",
					args: ["global", "add", "--ignore-scripts", "@new-scope/nycode"],
					display: "yarn global add --ignore-scripts @new-scope/nycode",
				},
			],
		});
	});

	test("self-updates renamed bun global installs by removing the old package first", () => {
		createBunGlobalInstall();

		const command = getSelfUpdateCommand("@mariozechner/pi-coding-agent", undefined, "@new-scope/nycode");

		expect(detectInstallMethod()).toBe("bun");
		expect(command).toEqual({
			command: "bun",
			args: ["install", "-g", "--ignore-scripts", "--minimum-release-age=0", "@new-scope/nycode"],
			display:
				"bun uninstall -g @mariozechner/pi-coding-agent && bun install -g --ignore-scripts --minimum-release-age=0 @new-scope/nycode",
			steps: [
				{
					command: "bun",
					args: ["uninstall", "-g", "@mariozechner/pi-coding-agent"],
					display: "bun uninstall -g @mariozechner/pi-coding-agent",
				},
				{
					command: "bun",
					args: ["install", "-g", "--ignore-scripts", "--minimum-release-age=0", "@new-scope/nycode"],
					display: "bun install -g --ignore-scripts --minimum-release-age=0 @new-scope/nycode",
				},
			],
		});
	});

	test("does not self-update when npm install path is not writable", () => {
		const { packageDir } = createNpmPrefixInstall();
		chmodSync(packageDir, 0o500);

		expect(getSelfUpdateCommand("@nycode/coding-agent")).toBeUndefined();
		expect(getSelfUpdateUnavailableInstruction("@nycode/coding-agent")).toContain("the install path is not writable");
	});
});

describe("detectInstallChange", () => {
	// Regression test for #10439: a deleted pnpm install must not fall back to a package.json further up.
	test("reports a removed install instead of reading a package.json further up", () => {
		tempDir = mkdtempSync(join(tmpdir(), "nycode-install-change-"));
		const installDir = join(tempDir, "global", "hash");
		mkdirSync(installDir, { recursive: true });
		writeFileSync(join(tempDir, "package.json"), JSON.stringify({ version: "0.0.1" }));
		rmSync(installDir, { recursive: true, force: true });
		expect(detectInstallChange(join(installDir, "package.json"))).toEqual({ kind: "removed" });
	});
});

describe("configured self-update command", () => {
	const originalSelfUpdateCommand = process.env.NYCODE_SELF_UPDATE_COMMAND;

	afterEach(() => {
		if (originalSelfUpdateCommand === undefined) {
			delete process.env.NYCODE_SELF_UPDATE_COMMAND;
		} else {
			process.env.NYCODE_SELF_UPDATE_COMMAND = originalSelfUpdateCommand;
		}
	});

	test("prefers NYCODE_SELF_UPDATE_COMMAND over the setting and splits it on whitespace", () => {
		process.env.NYCODE_SELF_UPDATE_COMMAND = "  nub   upgrade {installSpec} ";

		expect(getConfiguredSelfUpdateArgv(["mise", "upgrade"])).toEqual(["nub", "upgrade", "{installSpec}"]);
	});

	test("uses the setting when NYCODE_SELF_UPDATE_COMMAND is unset or blank", () => {
		process.env.NYCODE_SELF_UPDATE_COMMAND = " ";

		expect(getConfiguredSelfUpdateArgv(["mise", "upgrade", "npm:{packageName}"])).toEqual([
			"mise",
			"upgrade",
			"npm:{packageName}",
		]);
		expect(getConfiguredSelfUpdateArgv([])).toBeUndefined();
		expect(getConfiguredSelfUpdateArgv(undefined)).toBeUndefined();
	});

	test("fills placeholders in every argument", () => {
		const command = makeConfiguredSelfUpdateCommand(
			["wrapper", "install", "{installSpec}", "--name={packageName}", "--version", "{version}", "{unknown}"],
			{ packageName: "@nycode/coding-agent", version: "1.2.3" },
		);

		expect(command).toEqual({
			command: "wrapper",
			args: [
				"install",
				"@nycode/coding-agent@1.2.3",
				"--name=@nycode/coding-agent",
				"--version",
				"1.2.3",
				"{unknown}",
			],
			display: "wrapper install @nycode/coding-agent@1.2.3 --name=@nycode/coding-agent --version 1.2.3 {unknown}",
		});
	});
});
