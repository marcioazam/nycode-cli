// Shared environment of the fleet tests: a throwaway directory, with os.tmpdir() pointed inside it so that the fleet
// roots a test creates and sweeps stay away from the live sessions' root.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

export function fleetTestEnv(prefix: string): { tmp: string } {
	const tmp = mkdtempSync(join(tmpdir(), prefix));
	process.env.TMPDIR = join(tmp, "os-tmp");
	mkdirSync(process.env.TMPDIR);
	afterAll(() => rmSync(tmp, { recursive: true, force: true }));
	return { tmp };
}
