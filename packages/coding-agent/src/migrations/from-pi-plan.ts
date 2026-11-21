// Builds the plan of `nycode migrate from-pi`: reads the pi agent directory (read only) and decides each write.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { convertMcp, convertSettings, type LocalEnv, parseLocalEnv } from "./from-pi-convert.ts";

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

const COPIED_FILES = ["models.json", "lsp.json", "keybindings.json", "trust.json"];
const AUTH_FILE = /^auth.*\.json$/;
const WARN_LIMIT = 20;

function isRegularFile(path: string): boolean {
	try {
		return lstatSync(path).isFile();
	} catch {
		return false;
	}
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
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch (error) {
		errors.push(`${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
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

	const settingsPath = join(source, "settings.json");
	const piSettings = existsSync(settingsPath) ? readJson(settingsPath, plan.errors) : {};
	if (piSettings && (existsSync(settingsPath) || Object.keys(env.values).length > 0)) {
		const result = convertSettings(piSettings, env);
		add(
			{ rel: "settings.json", label: `converted, ${result.converted.length} key(s) from local.env`, mode: 0o600 },
			`${JSON.stringify(result.settings, null, 2)}\n`,
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
	if (existsSync(mcpPath)) {
		const piMcp = readJson(mcpPath, plan.errors);
		if (piMcp) {
			const { mcp, placeholders } = convertMcp(piMcp);
			add(
				{ rel: "mcp.json", label: "copied, literal secrets replaced by env placeholders", mode: 0o600 },
				`${JSON.stringify(mcp, null, 2)}\n`,
			);
			if (placeholders.length > 0) plan.notes.push(`mcp.json: export these variables: ${placeholders.join(", ")}`);
		}
	}

	for (const name of COPIED_FILES) {
		if (isRegularFile(join(source, name))) add({ rel: name, label: "copied", from: join(source, name) });
	}

	const sessionsRoot = join(source, "sessions");
	if (existsSync(sessionsRoot) && statSync(sessionsRoot).isDirectory()) {
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
