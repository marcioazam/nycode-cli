// Temporary package root for the built-in resources tests: NYCODE_PACKAGE_DIR points getPackageDir() at it, so the
// resources root is `<root>/resources` and nothing here depends on the real package contents.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface ResourcesFixture {
	/** The temporary package directory (NYCODE_PACKAGE_DIR). */
	root: string;
	/** `<root>/resources`. */
	resources: string;
	/** Writes `<root>/resources/<rel>`, creating directories. */
	write(rel: string, content: string): string;
	/** Restores the environment and removes the directory. */
	dispose(): void;
}

const ENV_KEYS = [
	"NYCODE_PACKAGE_DIR",
	"NYCODE_CODING_AGENT_DIR",
	"HOME",
	"USERPROFILE",
	"CLAUDE_CODE_DISABLE_CLAUDE_MDS",
];

/** Creates the fixture and points the environment at it (home and agent dir are empty temp directories too). */
export function createResourcesFixture(): ResourcesFixture {
	const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
	const root = mkdtempSync(join(tmpdir(), "nycode-resources-"));
	process.env.NYCODE_PACKAGE_DIR = root;
	process.env.NYCODE_CODING_AGENT_DIR = join(root, "agent");
	process.env.HOME = join(root, "home");
	process.env.USERPROFILE = join(root, "home");
	delete process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS;
	mkdirSync(process.env.NYCODE_CODING_AGENT_DIR, { recursive: true });
	mkdirSync(process.env.HOME, { recursive: true });
	return {
		root,
		resources: join(root, "resources"),
		write(rel, content) {
			const file = join(root, "resources", rel);
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, content);
			return file;
		},
		dispose() {
			for (const [key, value] of saved) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			rmSync(root, { recursive: true, force: true });
		},
	};
}
