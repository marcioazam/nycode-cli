import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const syncVersionsScript = fileURLToPath(new URL("./sync-versions.js", import.meta.url));

async function writeManifest(root, relativeDirectory, manifest) {
	const directory = join(root, relativeDirectory);
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
}

async function readManifest(root, relativeDirectory) {
	return JSON.parse(await readFile(join(root, relativeDirectory, "package.json"), "utf8"));
}

function runSyncVersions(root) {
	return spawnSync(process.execPath, [syncVersionsScript, join(root, "packages")], {
		cwd: root,
		encoding: "utf8",
	});
}

// #10865: caret ranges allowed older agents to install incompatible newer workspace dependencies.
test("pins published and private dependencies without touching registry aliases, generated manifests, or published lockstep", async () => {
	const root = await mkdtemp(join(tmpdir(), "nycode-sync-versions-"));
	try {
		await writeManifest(root, "packages/ai", {
			name: "@nycode/ai",
			version: "2.0.0",
		});
		await writeManifest(root, "packages/coding-agent", {
			name: "@nycode/coding-agent",
			version: "2.0.0",
			dependencies: {
				"@nycode/ai": "^2.0.0",
			},
			devDependencies: {
				"@nycode/ai": "~1.0.0",
			},
			optionalDependencies: {
				"@nycode/ai": "1.0.0",
			},
		});
		await writeManifest(root, "packages/evals", {
			name: "@nycode/evals",
			version: "9.9.9",
			private: true,
			dependencies: {
				"@nycode/coding-agent": "^1.0.0",
				"@mariozechner/pi-ai": "npm:@nycode/ai@1.0.0",
			},
		});
		await writeManifest(root, "apps/p2", {
			name: "p2",
			version: "0.0.1",
			private: true,
			dependencies: {
				"@nycode/ai": "1.0.0",
			},
		});
		await writeManifest(root, "packages/coding-agent/install-lock", {
			name: "generated-install-lock",
			version: "0.0.0",
			private: true,
			dependencies: {
				"@nycode/coding-agent": "^1.0.0",
			},
		});

		const result = runSyncVersions(root);
		assert.equal(result.status, 0, result.stderr);

		const agentManifest = await readManifest(root, "packages/coding-agent");
		for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
			assert.equal(agentManifest[section]["@nycode/ai"], "2.0.0");
		}
		const evalsManifest = await readManifest(root, "packages/evals");
		assert.equal(evalsManifest.dependencies["@nycode/coding-agent"], "2.0.0");
		assert.equal(evalsManifest.dependencies["@mariozechner/pi-ai"], "npm:@nycode/ai@1.0.0");
		const appManifest = await readManifest(root, "apps/p2");
		assert.equal(appManifest.dependencies["@nycode/ai"], "2.0.0");
		assert.equal(appManifest.version, "0.0.1");
		const generatedManifest = await readManifest(root, "packages/coding-agent/install-lock");
		assert.equal(generatedManifest.dependencies["@nycode/coding-agent"], "^1.0.0");

		const alreadySynced = runSyncVersions(root);
		assert.equal(alreadySynced.status, 0, alreadySynced.stderr);
		assert.match(alreadySynced.stdout, /All inter-package dependencies are already in sync/);

		await writeManifest(root, "packages/ai", {
			name: "@nycode/ai",
			version: "3.0.0",
		});
		const lockstepFailure = runSyncVersions(root);
		assert.equal(lockstepFailure.status, 1, lockstepFailure.stderr);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("syncs to the published packages only, not to private fixtures or nested copies of a package", async () => {
	const root = await mkdtemp(join(tmpdir(), "nycode-sync-versions-"));
	try {
		await writeManifest(root, "packages/coding-agent", {
			name: "@nycode/coding-agent",
			version: "2.0.0",
		});
		// Leftover output of scripts/build-binaries.sh: a non-private copy of the manifest at an older version.
		await writeManifest(root, "packages/coding-agent/binaries/darwin-arm64", {
			name: "@nycode/coding-agent",
			version: "1.0.0",
		});
		await writeManifest(root, "packages/chord/test/examples/deps/greeting", {
			name: "example-greeting",
			version: "1.0.0",
			private: true,
		});
		await writeManifest(root, "packages/chord/test/examples/plugins/report", {
			name: "report",
			private: true,
			dependencies: { "example-greeting": "file:../../deps/greeting" },
		});
		await writeManifest(root, "packages/evals", {
			name: "@nycode/evals",
			version: "2.0.0",
			private: true,
			dependencies: { "@nycode/coding-agent": "1.0.0" },
		});

		const result = runSyncVersions(root);
		assert.equal(result.status, 0, result.stderr);
		const evalsManifest = await readManifest(root, "packages/evals");
		assert.equal(evalsManifest.dependencies["@nycode/coding-agent"], "2.0.0");
		const pluginManifest = await readManifest(root, "packages/chord/test/examples/plugins/report");
		assert.equal(pluginManifest.dependencies["example-greeting"], "file:../../deps/greeting");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("writes the nycode-ai version constant", async () => {
	const root = await mkdtemp(join(tmpdir(), "nycode-sync-versions-"));
	try {
		await writeManifest(root, "packages/ai", {
			name: "@nycode/ai",
			version: "2.0.0",
		});
		const versionPath = join(root, "packages/ai/src/utils/version.ts");
		await mkdir(join(root, "packages/ai/src/utils"), { recursive: true });
		await writeFile(versionPath, 'export const NYCODE_AI_VERSION = "1.0.0";\n');

		const result = runSyncVersions(root);
		assert.equal(result.status, 0, result.stderr);
		assert.match(await readFile(versionPath, "utf8"), /export const NYCODE_AI_VERSION = "2\.0\.0";\n$/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
