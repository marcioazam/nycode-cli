// Read-only scan of the pi extensions in `migrate from-pi`: warns about imports of the pi module names. Never rewrites code.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 2000;
const MAX_DEPTH = 8;
const CODE_FILE = /\.(?:ts|js|mjs)$/;
/** `@mariozechner/<name>` and `@earendil-works/pi-<name>` module specifiers, with an optional subpath. */
const LEGACY_IMPORT = /@(?:mariozechner\/[\w.-]+|earendil-works\/pi-[\w.-]+)(?:\/[\w./-]+)?/g;

/** `@mariozechner/pi-ai/oauth` -> `@nycode/ai/oauth`. */
function nycodeName(specifier: string): string {
	const [, name = "", subpath = ""] = /^@[^/]+\/([^/]+)(\/.*)?$/.exec(specifier) ?? [];
	return `@nycode/${name.replace(/^(?:pi|nycode)-/, "")}${subpath}`;
}

function scanFile(path: string, found: Set<string>, budget: { files: number }): void {
	if (budget.files <= 0 || !CODE_FILE.test(path)) return;
	const stat = lstatSync(path);
	if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return;
	budget.files--;
	for (const match of readFileSync(path, "utf8").matchAll(LEGACY_IMPORT)) found.add(match[0]);
}

function scanTree(path: string, found: Set<string>, budget: { files: number }, depth = 0): void {
	const stat = lstatSync(path);
	if (stat.isFile()) {
		scanFile(path, found, budget);
		return;
	}
	// Symlinks are not followed: they could point outside the origin directory.
	if (!stat.isDirectory() || depth > MAX_DEPTH) return;
	for (const entry of readdirSync(path)) {
		if (entry !== "node_modules") scanTree(join(path, entry), found, budget, depth + 1);
	}
}

function warnings(label: string, root: string): string[] {
	const found = new Set<string>();
	try {
		scanTree(root, found, { files: MAX_FILES });
	} catch {
		return [];
	}
	return [...found].sort().map((specifier) => `${label}: import ${specifier}: rename to ${nycodeName(specifier)}`);
}

/** Local package sources of the pi settings (`./dir`, `../dir`, absolute); npm and git sources are not readable. */
function localPackages(settings: Record<string, unknown> | undefined): string[] {
	const packages = Array.isArray(settings?.packages) ? settings.packages : [];
	const sources = packages.map((entry: unknown) =>
		typeof entry === "string" ? entry : (entry as { source?: unknown } | null)?.source,
	);
	return sources.filter((s): s is string => typeof s === "string" && (isAbsolute(s) || /^\.\.?\//.test(s)));
}

/** One note per legacy import found in `extensions/` (per top-level entry) and in the local packages of `settings`. */
export function legacyImportNotes(source: string, settings: Record<string, unknown> | undefined): string[] {
	const notes: string[] = [];
	const extensionsDir = join(source, "extensions");
	try {
		for (const entry of readdirSync(extensionsDir).sort()) {
			if (entry !== "node_modules")
				notes.push(...warnings(`extension extensions/${entry}`, join(extensionsDir, entry)));
		}
	} catch {
		// no readable extensions directory
	}
	for (const pkg of localPackages(settings)) {
		const root = resolve(source, pkg);
		notes.push(...warnings(`package ${relative(source, root) || pkg}`, root));
	}
	return notes;
}
