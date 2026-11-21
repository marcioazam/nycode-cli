import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const RELEASE_SCRIPT = fileURLToPath(new URL("./release.mjs", import.meta.url));

// Stub `npm` and `git` that only log their arguments; `npm run version:patch` bumps packages/ai/package.json.
const STUB = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const [tool, args] = [process.argv[1].split("/").pop(), process.argv.slice(2)];
appendFileSync(process.env.STUB_LOG, tool + " " + args.join(" ") + "\\n");
if (tool === "npm" && args[0] === "--version") console.log("11.0.0");
if (tool === "npm" && args[1] === "version:patch") {
	const p = "packages/ai/package.json";
	writeFileSync(p, readFileSync(p, "utf8").replace("1.0.0", "1.0.1"));
}
`;

test("release.mjs stops at the version commit: no npm registry call, no tag, no push", (t) => {
	const root = mkdtempSync(join(tmpdir(), "nycode-release-test-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const bin = join(root, "bin");
	mkdirSync(bin);
	for (const tool of ["npm", "git"]) {
		writeFileSync(join(bin, tool), STUB);
		chmodSync(join(bin, tool), 0o755);
	}
	const repo = join(root, "repo");
	mkdirSync(join(repo, "packages", "ai"), { recursive: true });
	writeFileSync(join(repo, "packages", "ai", "package.json"), '{"name":"@nycode/ai","version":"1.0.0"}\n');
	writeFileSync(join(repo, "packages", "ai", "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n- change\n");
	writeFileSync(join(repo, "package-lock.json"), '{"packages":{}}\n');
	const log = join(root, "calls.log");
	writeFileSync(log, "");

	const result = spawnSync(process.execPath, [RELEASE_SCRIPT, "patch"], {
		cwd: repo,
		encoding: "utf8",
		env: {
			...process.env,
			PATH: `${bin}${delimiter}${process.env.PATH}`,
			STUB_LOG: log,
			NYCODE_RELEASE_SKIP_TESTS: "1",
		},
	});

	assert.equal(result.status, 0, result.stdout + result.stderr);
	const calls = readFileSync(log, "utf8").trim().split("\n");
	assert.equal(calls.at(-1), 'git commit -m Release v1.0.1');
	assert.deepEqual(
		calls.filter((call) => /^git (push|tag)|^npm (view|publish|whoami)/.test(call)),
		[],
	);
	assert.match(readFileSync(join(repo, "packages", "ai", "CHANGELOG.md"), "utf8"), /## \[1\.0\.1\] - \d{4}-\d{2}-\d{2}/);
	assert.match(result.stdout, /open a PR, squash-merge it, then tag the commit on main/);
});

test("release.mjs rejects an argument that is not major, minor, patch or x.y.z", () => {
	const result = spawnSync(process.execPath, [RELEASE_SCRIPT, "latest"], { encoding: "utf8" });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Usage: node scripts\/release\.mjs/);
});
