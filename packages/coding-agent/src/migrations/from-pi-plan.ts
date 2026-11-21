// Builds the plan of `nycode migrate from-pi`: reads the pi agent directory (read only) and decides each write.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { convertMcp, convertSettings, type LocalEnv, mergeSettings, parseLocalEnv } from "./from-pi-convert.ts";
import { legacyImportNotes } from "./from-pi-imports.ts";

export type FileAction = "create" | "overwrite" | "unchanged" | "keep";

export interface PlanFile {
	/** Path relative to both the origin and the destination agent directory. */
	rel: string;
	label: string;
	action: FileAction;
	/** Converted content; when absent the origin file `from` is copied byte for byte. */
	data?: string;
	from?: string;
	mode?: number;
	/** Credentials: copied only after an interactive confirmation. */
	credential?: boolean;
}

export interface Plan {
	source: string;
	dest: string;
	files: PlanFile[];
	notes: string[];
	errors: string[];
}

const COPIED_FILES = ["models.json", "lsp.json", "keybindings.json"];
const AUTH_FILE = /^auth.*\.json$/;
const WARN_LIMIT = 20;
/** Settings keys whose origin values run code at startup. */
const CODE_KEYS = ["packages", "hooks", "shellCommandPrefix"];

function entryKind(path: string): "missing" | "file" | "directory" | "other" {
	try {
		const stat = lstatSync(path);
		return stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other";
	} catch {
		return "missing";
	}
}

const isRegularFile = (path: string): boolean => entryKind(path) === "file";

/** True for a regular file; an entry that exists but is a symlink or special file is reported and skipped. */
function regularOrNote(path: string, label: string, kind: "file" | "directory", notes: string[]): boolean {
	const found = entryKind(path);
	if (found === "missing") return false;
	if (found === kind) return true;
	notes.push(`${label} is not a regular ${kind} (symlink or special entry); skipped`);
	return false;
}

/** The old wrapper trusted local.env only when it was owned by the user with mode 0600 or 0400. */
function checkLocalEnv(path: string): string | undefined {
	const stat = lstatSync(path);
	if (!stat.isFile()) return "local.env is not a regular file; refusing to read it";
	if (process.getuid === undefined)
		return "local.env ownership cannot be verified on this platform; refusing to read it";
	const mode = stat.mode & 0o777;
	if (stat.uid !== process.getuid()) return "local.env is not owned by the current user; refusing to read it";
	if (mode !== 0o600 && mode !== 0o400) {
		const shown = `0${mode.toString(8)}`;
		return `local.env has mode ${shown} (needs 0600 or 0400); refusing to read it. Run: chmod 600 ${path}`;
	}
	return undefined;
}

function actionFor(destPath: string, data: Buffer | string | undefined, from: string | undefined): FileAction {
	if (!existsSync(destPath)) return "create";
	if (data === undefined && from === undefined) return "overwrite";
	const next = data === undefined ? readFileSync(from as string) : Buffer.from(data);
	return readFileSync(destPath).equals(next) ? "unchanged" : "overwrite";
}

function readJson(path: string, errors: string[]): Record<string, unknown> | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
			return parsed as Record<string, unknown>;
		errors.push(`${path}: not a JSON object`);
		return undefined;
	} catch (error) {
		// The engine message can quote file content; keep only the position it reports.
		const position = error instanceof Error ? /position (\d+)/.exec(error.message)?.[1] : undefined;
		errors.push(`${path}: invalid JSON${position ? ` at position ${position}` : ""}`);
		return undefined;
	}
}

function listTree(root: string, rel: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
		const entryRel = `${rel}/${entry.name}`;
		if (entry.isDirectory()) found.push(...listTree(root, entryRel));
		else if (entry.isFile()) found.push(entryRel);
	}
	return found;
}

/** trust.json is merged into an existing destination file, whose entries prevail; otherwise copied as is. */
function addTrust(
	source: string,
	dest: string,
	add: (file: Omit<PlanFile, "action">, data?: string) => void,
	errors: string[],
	notes: string[],
): void {
	const from = join(source, "trust.json");
	if (!isRegularFile(from)) return;
	const destPath = join(dest, "trust.json");
	if (!isRegularFile(destPath)) {
		add({ rel: "trust.json", label: "copied", from });
		return;
	}
	const incoming = readJson(from, errors);
	const existing = readJson(destPath, errors);
	if (!incoming || !existing) return;
	const merged = { ...incoming, ...existing };
	// Nothing new to add: keep the destination bytes so the file reports as unchanged.
	const unchanged = Object.keys(merged).length === Object.keys(existing).length;
	add(
		{ rel: "trust.json", label: "merged, destination entries prevail" },
		unchanged ? readFileSync(destPath, "utf8") : `${JSON.stringify(merged, null, 2)}\n`,
	);
	notes.push("trust.json: merged with the destination file; destination entries prevail");
}

/** Collects what would be written into `dest` from the pi agent directory `source`. */
export function buildPlan(source: string, dest: string): Plan {
	const plan: Plan = { source, dest, files: [], notes: [], errors: [] };
	if (!existsSync(source) || !statSync(source).isDirectory()) {
		plan.errors.push(`source directory not found: ${source}`);
		return plan;
	}
	if (existsSync(dest) && realpathSync(source) === realpathSync(dest)) {
		plan.errors.push("source and destination are the same directory");
		return plan;
	}
	const add = (file: Omit<PlanFile, "action">, data?: string) => {
		const destPath = join(dest, file.rel);
		plan.files.push({ ...file, data, action: actionFor(destPath, data, file.from) });
	};

	const localEnvPath = join(source, "local.env");
	let env: LocalEnv = { values: {}, ignored: [] };
	if (existsSync(localEnvPath)) {
		const problem = checkLocalEnv(localEnvPath);
		if (problem) plan.errors.push(problem);
		else env = parseLocalEnv(readFileSync(localEnvPath, "utf8"));
	}

	const codeRunners: string[] = [];
	const settingsPath = join(source, "settings.json");
	const hasSettings = regularOrNote(settingsPath, "settings.json", "file", plan.notes);
	const piSettings = hasSettings ? readJson(settingsPath, plan.errors) : {};
	if (piSettings && (hasSettings || Object.keys(env.values).length > 0)) {
		const result = convertSettings(piSettings, env);
		let settings = result.settings;
		const destSettings = join(dest, "settings.json");
		const existing = isRegularFile(destSettings) ? readJson(destSettings, plan.errors) : undefined;
		for (const key of CODE_KEYS) if (key in result.settings && !(existing && key in existing)) codeRunners.push(key);
		if (existing) {
			const merged = mergeSettings(existing, settings);
			settings = merged.settings;
			if (merged.kept.length > 0) {
				plan.notes.push(
					`settings.json: kept destination value of security key(s), origin value not applied: ${merged.kept.join(", ")}`,
				);
			}
		}
		add(
			{ rel: "settings.json", label: `converted, ${result.converted.length} key(s) from local.env`, mode: 0o600 },
			`${JSON.stringify(settings, null, 2)}\n`,
		);
		for (const line of result.converted) plan.notes.push(`local.env: ${line}`);
		for (const warning of result.warnings) plan.notes.push(`local.env: ${warning}`);
		for (const source of result.embedded)
			plan.notes.push(`package ${source} is embedded in nycode; removed from packages`);
		for (const source of result.toInstall) {
			plan.notes.push(
				`package ${source}: install it as a nycode package (nycode install <source>); removed from packages`,
			);
		}
		if (result.packageEnvKey) {
			plan.notes.push(`${result.packageEnvKey} belongs to the ponytail package: keep it in your shell environment`);
		}
	}
	if (env.ignored.length > 0) plan.notes.push(`local.env: ignored ${env.ignored.slice(0, WARN_LIMIT).join(", ")}`);

	const mcpPath = join(source, "mcp.json");
	if (regularOrNote(mcpPath, "mcp.json", "file", plan.notes)) {
		const piMcp = readJson(mcpPath, plan.errors);
		if (piMcp) {
			const { mcp, placeholders, unmigrated, warnings, commands } = convertMcp(piMcp);
			for (const warning of warnings) plan.notes.push(`mcp.json: ${warning}`);
			if (commands.length > 0) codeRunners.push(`mcp.json command (${commands.join(", ")})`);
			add(
				{
					rel: "mcp.json",
					label: "env and headers values replaced by env placeholders; args and url copied as is",
					mode: 0o600,
				},
				`${JSON.stringify(mcp, null, 2)}\n`,
			);
			if (placeholders.length > 0) plan.notes.push(`mcp.json: export these variables: ${placeholders.join(", ")}`);
			if (unmigrated.length > 0) {
				plan.notes.push(
					`mcp.json: not migrated automatically (credential-like args/url copied as is; replace them by env placeholders): ${unmigrated.join(", ")}`,
				);
			}
		}
	}

	for (const name of COPIED_FILES) {
		if (isRegularFile(join(source, name))) add({ rel: name, label: "copied", from: join(source, name) });
	}

	addTrust(source, dest, add, plan.errors, plan.notes);

	const sessionsRoot = join(source, "sessions");
	if (regularOrNote(sessionsRoot, "sessions", "directory", plan.notes)) {
		for (const rel of listTree(source, "sessions")) {
			const destPath = join(dest, rel);
			plan.files.push({
				rel,
				label: "session",
				from: join(source, rel),
				action: existsSync(destPath) ? "keep" : "create",
			});
		}
	}

	for (const name of readdirSync(source).filter((n) => AUTH_FILE.test(n) && isRegularFile(join(source, n)))) {
		add({ rel: name, label: "credentials", from: join(source, name), mode: 0o600, credential: true });
	}

	if (codeRunners.length > 0 && resolve(source) !== defaultSource(homedir())) {
		plan.notes.push(
			`--from is not the default ${defaultSource(homedir())}: these origin entries run code at the next nycode start, review them first: ${codeRunners.join(", ")}`,
		);
	}

	plan.notes.push(...legacyImportNotes(source, piSettings));

	const claudeHome = join(source, "claude-home");
	if (existsSync(claudeHome) && statSync(claudeHome).isDirectory()) {
		const entries = readdirSync(claudeHome);
		plan.notes.push(
			`claude-home/ is not copied (embedded resources replace it); review it for personal changes: ${entries.slice(0, WARN_LIMIT).join(", ")}`,
		);
	}
	return plan;
}

/** Default origin directory: the pi agent directory under the user's home. */
export function defaultSource(home: string): string {
	return resolve(home, ".pi", "agent");
}
