// Shared env for subagent tests that spawn or track runs: a private temp dir, and os.tmpdir() (hence the fleet root,
// which follows it) moved inside it, so the roots a test creates and sweeps stay away from live sessions.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

export function fleetTestEnv(prefix: string): { tmp: string } {
	const tmp = mkdtempSync(join(tmpdir(), prefix));
	const savedTmpdir = process.env.TMPDIR;
	process.env.TMPDIR = join(tmp, "os-tmp");
	mkdirSync(process.env.TMPDIR);
	afterAll(() => {
		if (savedTmpdir === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = savedTmpdir;
		rmSync(tmp, { recursive: true, force: true });
	});
	return { tmp };
}
