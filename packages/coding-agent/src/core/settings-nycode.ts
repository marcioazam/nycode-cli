// Resolution of the nycode settings keys (docs/migration/ny-pi-core/02-arquitetura-alvo.md section 5).
// Precedence: environment variable, then settings.json, then default. A malformed value in either source is skipped,
// never thrown: settings files are not schema-validated at load time.
import { join } from "node:path";
import { getAgentDir } from "../config.ts";
import { SETTINGS_DEFAULTS } from "./settings-defaults.ts";
import type { Settings } from "./settings-schema.ts";

export type Env = Readonly<Record<string, string | undefined>>;

export interface NycodeSettings {
	compaction: { maxContextTokens: number };
	harness: {
		effortSandwich: { enabled: boolean; turns: number };
		headless: { lean: boolean; trim: boolean; tools: "lean" | "all"; floor: boolean };
		/** "auto" means on in interactive sessions only. */
		prefixCache1h: boolean | "auto";
		autoResume: boolean;
		completionGate: boolean;
	};
	subagent: { respawn: boolean };
	tools: { bash: { backgroundOnTimeout: boolean } };
	todo: { staleReminder: boolean };
	plan: { gate: boolean };
	notify: { sound: boolean };
	terminal: { uiState: string; reducedMotion: boolean; nerdFont: boolean | "auto"; asciiIcons: boolean };
	knowledge: { vault?: string; graphsVault?: string };
	codegraph: { autoRoot?: string; bin?: string; statusTtl?: number; autoState?: string };
	mcp: { configPath: string };
}

/** How one key is read: from the variable text and from the settings.json value. Both return undefined when malformed. */
interface Field<T> {
	fromEnv: (raw: string) => T | undefined;
	fromSettings: (raw: unknown) => T | undefined;
}

const envBoolean = (raw: string): boolean | undefined => {
	const text = raw.trim().toLowerCase();
	if (text === "1" || text === "true" || text === "yes" || text === "on") return true;
	if (text === "0" || text === "false" || text === "no" || text === "off") return false;
	return undefined;
};
const envNumber = (raw: string): number | undefined => (/^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : undefined);

const BOOLEAN: Field<boolean> = {
	fromEnv: envBoolean,
	fromSettings: (raw) => (typeof raw === "boolean" ? raw : undefined),
};
const AUTO: Field<boolean | "auto"> = {
	fromEnv: (raw) => (raw.trim() === "auto" ? "auto" : envBoolean(raw)),
	fromSettings: (raw) => (raw === "auto" ? raw : BOOLEAN.fromSettings(raw)),
};
const TOOLS: Field<"lean" | "all"> = {
	fromEnv: (raw) => (raw === "lean" || raw === "all" ? raw : undefined),
	fromSettings: (raw) => (raw === "lean" || raw === "all" ? raw : undefined),
};
const TEXT: Field<string> = {
	fromEnv: (raw) => (raw === "" ? undefined : raw),
	fromSettings: (raw) => (typeof raw === "string" && raw !== "" ? raw : undefined),
};
const integerAtLeast = (min: number): Field<number> => {
	const valid = (value: number | undefined) =>
		value !== undefined && Number.isSafeInteger(value) && value >= min ? value : undefined;
	return {
		fromEnv: (raw) => valid(envNumber(raw)),
		fromSettings: (raw) => valid(typeof raw === "number" ? raw : undefined),
	};
};
const SECONDS: Field<number> = {
	fromEnv: envNumber,
	fromSettings: (raw) => (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : undefined),
};

function pickOptional<T>(field: Field<T>, envRaw: string | undefined, settingValue: unknown): T | undefined {
	return (envRaw === undefined ? undefined : field.fromEnv(envRaw)) ?? field.fromSettings(settingValue);
}

function pick<T>(field: Field<T>, envRaw: string | undefined, settingValue: unknown, fallback: T): T {
	return pickOptional(field, envRaw, settingValue) ?? fallback;
}

/** True when NYCODE_BYPASS_PERMISSIONS is set but is not a recognised boolean (an empty value included). */
export function isBypassEnvUnrecognised(env: Env): boolean {
	const raw = env.NYCODE_BYPASS_PERMISSIONS;
	return raw !== undefined && envBoolean(raw) === undefined;
}

/**
 * Whether permission prompts are auto-approved. Flag, then NYCODE_BYPASS_PERMISSIONS, then settings.json, then false.
 * Fail closed: a variable that is set but unrecognised (empty included) is false, never a fall-through to settings.json.
 * `settings` must be the global layer: a project must not switch its own permission prompts off.
 */
export function resolveBypassPermissions(input: { flag?: boolean; env: Env; settings: Settings }): boolean {
	if (input.flag !== undefined) return input.flag;
	const raw = input.env.NYCODE_BYPASS_PERMISSIONS;
	if (raw !== undefined) return envBoolean(raw) ?? false;
	return pick(BOOLEAN, undefined, input.settings.permissions?.bypass, SETTINGS_DEFAULTS.permissions.bypass);
}

/** Resolve every nycode key except `permissions.bypass`, `hooks`, `statusLine` and `env`, which have their own getters. */
export function resolveNycodeSettings(settings: Settings, env: Env): NycodeSettings {
	const d = SETTINGS_DEFAULTS;
	const h = settings.harness;
	return {
		compaction: {
			maxContextTokens: pick(
				integerAtLeast(1),
				env.NYCODE_COMPACT_AT,
				settings.compaction?.maxContextTokens,
				d.compaction.maxContextTokens,
			),
		},
		harness: {
			effortSandwich: {
				enabled: pick(
					BOOLEAN,
					env.NYCODE_EFFORT_SANDWICH,
					h?.effortSandwich?.enabled,
					d.harness.effortSandwich.enabled,
				),
				turns: pick(
					integerAtLeast(1),
					env.NYCODE_EFFORT_SANDWICH_TURNS,
					h?.effortSandwich?.turns,
					d.harness.effortSandwich.turns,
				),
			},
			headless: {
				lean: pick(BOOLEAN, env.NYCODE_HEADLESS_LEAN, h?.headless?.lean, d.harness.headless.lean),
				trim: pick(BOOLEAN, env.NYCODE_HEADLESS_TRIM, h?.headless?.trim, d.harness.headless.trim),
				tools: pick(TOOLS, env.NYCODE_HEADLESS_TOOLS, h?.headless?.tools, d.harness.headless.tools),
				floor: pick(BOOLEAN, env.NYCODE_HEADLESS_FLOOR, h?.headless?.floor, d.harness.headless.floor),
			},
			prefixCache1h: pick(AUTO, env.NYCODE_PREFIX_CACHE_1H, h?.prefixCache1h, d.harness.prefixCache1h),
			autoResume: pick(BOOLEAN, env.NYCODE_AUTO_RESUME, h?.autoResume, d.harness.autoResume),
			completionGate: pick(BOOLEAN, env.NYCODE_COMPLETION_GATE, h?.completionGate, d.harness.completionGate),
		},
		subagent: { respawn: pick(BOOLEAN, env.NYCODE_SUBAGENT_RESPAWN, settings.subagent?.respawn, d.subagent.respawn) },
		tools: {
			bash: {
				backgroundOnTimeout: pick(
					BOOLEAN,
					env.NYCODE_BASH_TIMEOUT_BG,
					settings.tools?.bash?.backgroundOnTimeout,
					d.tools.bash.backgroundOnTimeout,
				),
			},
		},
		todo: { staleReminder: pick(BOOLEAN, env.NYCODE_TODO_SYNC, settings.todo?.staleReminder, d.todo.staleReminder) },
		plan: { gate: pick(BOOLEAN, env.NYCODE_PLAN_GATE, settings.plan?.gate, d.plan.gate) },
		notify: { sound: pick(BOOLEAN, env.NYCODE_SOUND_NOTIFY, settings.notify?.sound, d.notify.sound) },
		terminal: {
			uiState: pick(TEXT, env.NYCODE_UI_STATE, settings.terminal?.uiState, join(getAgentDir(), "ui-state.json")),
			reducedMotion: pick(
				BOOLEAN,
				env.NYCODE_REDUCED_MOTION,
				settings.terminal?.reducedMotion,
				d.terminal.reducedMotion,
			),
			nerdFont: pick(AUTO, env.NYCODE_NERD_FONT, settings.terminal?.nerdFont, d.terminal.nerdFont),
			asciiIcons: pick(BOOLEAN, env.NYCODE_ASCII_ICONS, settings.terminal?.asciiIcons, d.terminal.asciiIcons),
		},
		knowledge: {
			vault: pickOptional(TEXT, env.NYCODE_KNOWLEDGE_VAULT, settings.knowledge?.vault),
			graphsVault: pickOptional(TEXT, env.NYCODE_GRAPHS_VAULT, settings.knowledge?.graphsVault),
		},
		codegraph: {
			autoRoot: pickOptional(TEXT, env.CODEGRAPH_AUTO_ROOT, settings.codegraph?.autoRoot),
			bin: pickOptional(TEXT, env.CODEGRAPH_BIN, settings.codegraph?.bin),
			statusTtl: pickOptional(SECONDS, env.CODEGRAPH_STATUS_TTL, settings.codegraph?.statusTtl),
			autoState: pickOptional(TEXT, env.CODEGRAPH_AUTO_STATE, settings.codegraph?.autoState),
		},
		mcp: { configPath: pick(TEXT, env.NYCODE_MCP_CONFIG, settings.mcp?.configPath, join(getAgentDir(), "mcp.json")) },
	};
}
