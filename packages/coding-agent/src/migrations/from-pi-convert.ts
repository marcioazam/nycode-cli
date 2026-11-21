// Pure conversions for `nycode migrate from-pi`: local.env parsing, settings keys, packages, mcp secrets.
// D-09: this is the only place that may name the old PI_* variables.

type Json = Record<string, unknown>;
type EnvKind = "bool" | "int" | "string";

interface EnvMapping {
	envKey: string;
	path: string[];
	kind: EnvKind;
}

/** The nine keys the old wrapper read from local.env, with the settings key each one becomes (02 section 5). */
const ENV_MAPPINGS: EnvMapping[] = [
	{ envKey: "PI_BYPASS_PERMISSIONS", path: ["permissions", "bypass"], kind: "bool" },
	{ envKey: "PI_COMPACT_AT", path: ["compaction", "maxContextTokens"], kind: "int" },
	{ envKey: "PI_KNOWLEDGE_VAULT", path: ["knowledge", "vault"], kind: "string" },
	{ envKey: "PI_GRAPHS_VAULT", path: ["knowledge", "graphsVault"], kind: "string" },
	{ envKey: "CODEGRAPH_AUTO_ROOT", path: ["codegraph", "autoRoot"], kind: "string" },
	{ envKey: "PI_SUBAGENT_RESPAWN", path: ["subagent", "respawn"], kind: "bool" },
	{ envKey: "PI_EFFORT_SANDWICH", path: ["harness", "effortSandwich", "enabled"], kind: "bool" },
	{ envKey: "PI_EFFORT_SANDWICH_TURNS", path: ["harness", "effortSandwich", "turns"], kind: "int" },
];

/** Belongs to the optional ponytail package, which reads it from the environment: reported, never converted. */
const PACKAGE_ENV_KEY = "PONYTAIL_QUIET_STARTUP";

const KNOWN_ENV_KEYS = new Set([...ENV_MAPPINGS.map((m) => m.envKey), PACKAGE_ENV_KEY]);

export interface LocalEnv {
	values: Record<string, string>;
	/** Names (never values) of lines that are not one of the nine keys. */
	ignored: string[];
}

/** Parses local.env line by line as KEY=VALUE; nothing is expanded or evaluated, one pair of quotes is stripped. */
export function parseLocalEnv(text: string): LocalEnv {
	const values: Record<string, string> = {};
	const ignored: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
		if (!match) {
			ignored.push("(unparsable line)");
			continue;
		}
		const [, key, raw] = match;
		if (!KNOWN_ENV_KEYS.has(key)) {
			ignored.push(key);
			continue;
		}
		const quoted = raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw.endsWith(raw[0]);
		values[key] = quoted ? raw.slice(1, -1) : raw;
	}
	return { values, ignored };
}

function parseEnvValue(kind: EnvKind, raw: string): boolean | number | string | undefined {
	if (kind === "bool")
		return raw === "1" || raw === "true" ? true : raw === "0" || raw === "false" ? false : undefined;
	if (kind === "int") return /^[1-9][0-9]*$/.test(raw) ? Number(raw) : undefined;
	return raw === "" ? undefined : raw;
}

function setPath(target: Json, path: string[], value: unknown): void {
	let node = target;
	for (const key of path.slice(0, -1)) {
		const next = node[key];
		const child: Json = typeof next === "object" && next !== null && !Array.isArray(next) ? (next as Json) : {};
		node[key] = child;
		node = child;
	}
	node[path[path.length - 1]] = value;
}

export interface SettingsConversion {
	settings: Json;
	/** `ENV_KEY -> settings.path` lines for the plan; values are not included. */
	converted: string[];
	warnings: string[];
	/** Packages the new core embeds (pi-code, pi-lsp) and removes from `packages`. */
	embedded: string[];
	/** Packages the user must install again as nycode packages. */
	toInstall: string[];
	/** The optional ponytail package env key, when it was set. */
	packageEnvKey: string | undefined;
}

const EMBEDDED_PACKAGE = /^(npm:pi-code(@.*)?|\.\/vendor\/pi-lsp\/?)$/;
const INSTALL_PACKAGE = /^\.\/vendor\/ponytail\/?$/;

function packageSource(entry: unknown): string {
	if (typeof entry === "string") return entry;
	const source = (entry as { source?: unknown } | null)?.source;
	return typeof source === "string" ? source : "";
}

/** Applies the pi settings.json and local.env values to a nycode settings object (02 section 5). */
export function convertSettings(piSettings: Json, env: LocalEnv): SettingsConversion {
	const settings: Json = structuredClone(piSettings);
	const embedded: string[] = [];
	const toInstall: string[] = [];
	if (Array.isArray(settings.packages)) {
		const kept = settings.packages.filter((entry: unknown) => {
			const source = packageSource(entry);
			if (EMBEDDED_PACKAGE.test(source)) embedded.push(source);
			else if (INSTALL_PACKAGE.test(source)) toInstall.push(source);
			else return true;
			return false;
		});
		if (kept.length > 0) settings.packages = kept;
		else delete settings.packages;
	}

	const converted: string[] = [];
	const warnings: string[] = [];
	for (const { envKey, path, kind } of ENV_MAPPINGS) {
		const raw = env.values[envKey];
		if (raw === undefined) continue;
		const value = parseEnvValue(kind, raw);
		if (value === undefined) {
			warnings.push(`${envKey}: not a valid ${kind === "string" ? "non-empty string" : kind}; skipped`);
			continue;
		}
		setPath(settings, path, value);
		converted.push(`${envKey} -> ${path.join(".")}`);
	}
	return {
		settings,
		converted,
		warnings,
		embedded,
		toInstall,
		packageEnvKey: PACKAGE_ENV_KEY in env.values ? PACKAGE_ENV_KEY : undefined,
	};
}

const SCHEME_PREFIX = /^(Bearer|Basic) /i;
const PLACEHOLDER = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
// Credential patterns the converter cannot rewrite safely inside `args` and `url`; reported, never altered.
const CREDENTIAL_FLAG = /^--?[a-z0-9_-]*(?:token|key|secret|passw|auth|credential|bearer)[a-z0-9_-]*(=(.*))?$/i;
const CREDENTIAL_QUERY = /[?&](?:api[-_]?key|token|access[-_]?token|key|secret|passw(?:or)?d|auth)=(?!\$\{)[^&#\s]+/i;
const CREDENTIAL_USERINFO = /\/\/[^\s/:@]+:(?!\$\{)[^\s/@]+@/;

export interface McpConversion {
	mcp: Json;
	/** Placeholder names the user must export; the replaced values are discarded and never reported. */
	placeholders: string[];
	/** `server.field` of args and urls that look like credentials and were copied as is (never the value). */
	unmigrated: string[];
}

function placeholderName(...parts: string[]): string {
	return parts
		.join("_")
		.replace(/[^A-Za-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toUpperCase();
}

function looksLikeCredential(text: string): boolean {
	return CREDENTIAL_QUERY.test(text) || CREDENTIAL_USERINFO.test(text);
}

function credentialArgs(args: unknown[]): number[] {
	const found: number[] = [];
	args.forEach((arg, index) => {
		if (typeof arg !== "string") return;
		const flag = CREDENTIAL_FLAG.exec(arg);
		const next = args[index + 1];
		const flagged = flag
			? flag[1] !== undefined
				? flag[2] !== "" && !PLACEHOLDER.test(flag[2])
				: typeof next === "string" && !next.startsWith("-") && !PLACEHOLDER.test(next)
			: false;
		if (flagged || looksLikeCredential(arg)) found.push(index);
	});
	return found;
}

/** Replaces every literal `env` and `headers` value by a `${NAME}` placeholder and lists credential-like args/url. */
export function convertMcp(piMcp: Json): McpConversion {
	const mcp: Json = structuredClone(piMcp);
	const placeholders: string[] = [];
	const unmigrated: string[] = [];
	const servers = (mcp.mcpServers ?? {}) as Record<string, Json>;
	for (const [serverName, server] of Object.entries(servers)) {
		for (const field of ["env", "headers"] as const) {
			const table = server[field] as Record<string, unknown> | undefined;
			if (!table) continue;
			for (const [key, value] of Object.entries(table)) {
				const scheme = typeof value === "string" ? (SCHEME_PREFIX.exec(value)?.[0] ?? "") : "";
				if (typeof value === "string" && PLACEHOLDER.test(value.slice(scheme.length))) continue;
				const name = field === "env" ? placeholderName(key) : placeholderName(serverName, key);
				table[key] = `${scheme}\${${name}}`;
				placeholders.push(name);
			}
		}
		if (typeof server.url === "string" && looksLikeCredential(server.url)) unmigrated.push(`${serverName}.url`);
		if (Array.isArray(server.args)) {
			for (const index of credentialArgs(server.args)) unmigrated.push(`${serverName}.args[${index}]`);
		}
	}
	return { mcp, placeholders: [...new Set(placeholders)], unmigrated };
}
