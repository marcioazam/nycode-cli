// Schemas of the nycode settings blocks (docs/migration/ny-pi-core/02-arquitetura-alvo.md section 5).
// The keys only exist, validate and are read here; the extensions that consume them arrive in later phases.
import { type Static, Type } from "typebox";
import { SETTINGS_DEFAULTS } from "./settings-defaults.ts";

const flag = (description: string, fallback: boolean) =>
	Type.Optional(Type.Boolean({ description, default: fallback }));

const PermissionsSettingsSchema = Type.Object({
	bypass: Type.Optional(
		Type.Boolean({
			description:
				"Auto-approve the permission prompts of the permission engine; deny rules still apply. Global setting only. NYCODE_BYPASS_PERMISSIONS and --bypass/--safe take precedence.",
			default: SETTINGS_DEFAULTS.permissions.bypass,
		}),
	),
});

const HarnessSettingsSchema = Type.Object({
	effortSandwich: Type.Optional(
		Type.Object({
			enabled: flag(
				"High thinking on the first turns of a top-level headless run. NYCODE_EFFORT_SANDWICH takes precedence.",
				SETTINGS_DEFAULTS.harness.effortSandwich.enabled,
			),
			turns: Type.Optional(
				Type.Integer({
					minimum: 1,
					description: "Turns that use high thinking. NYCODE_EFFORT_SANDWICH_TURNS takes precedence.",
					default: SETTINGS_DEFAULTS.harness.effortSandwich.turns,
				}),
			),
		}),
	),
	headless: Type.Optional(
		Type.Object({
			lean: flag("Lean prompt and tools in top-level headless runs. NYCODE_HEADLESS_LEAN takes precedence.", true),
			trim: flag("Trim docs and tool schemas in headless runs. NYCODE_HEADLESS_TRIM takes precedence.", true),
			tools: Type.Optional(
				Type.Union([Type.Literal("lean"), Type.Literal("all")], {
					description: '"all" keeps subagent, memory, lsp and todo tools. NYCODE_HEADLESS_TOOLS takes precedence.',
					default: SETTINGS_DEFAULTS.harness.headless.tools,
				}),
			),
			floor: flag("Add the headless instruction floor. NYCODE_HEADLESS_FLOOR takes precedence.", true),
		}),
	),
	prefixCache1h: Type.Optional(
		Type.Union([Type.Boolean(), Type.Literal("auto")], {
			description:
				'One-hour prompt-prefix cache TTL. "auto" enables it in interactive sessions only. NYCODE_PREFIX_CACHE_1H takes precedence.',
			default: SETTINGS_DEFAULTS.harness.prefixCache1h,
		}),
	),
	autoResume: flag("Resume a turn cut short by a transient failure. NYCODE_AUTO_RESUME takes precedence.", true),
	completionGate: flag(
		"Block a final answer while the task has unfinished steps. NYCODE_COMPLETION_GATE takes precedence.",
		true,
	),
});

const SubagentSettingsSchema = Type.Object({
	respawn: flag("Respawn a crashed foreground subagent. NYCODE_SUBAGENT_RESPAWN takes precedence.", true),
});

const ToolsSettingsSchema = Type.Object({
	bash: Type.Optional(
		Type.Object({
			backgroundOnTimeout: flag(
				"Keep a command that hits its timeout running in the background. NYCODE_BASH_TIMEOUT_BG takes precedence.",
				false,
			),
		}),
	),
});

const TodoSettingsSchema = Type.Object({
	staleReminder: flag("Remind the model of a stale todo list. NYCODE_TODO_SYNC takes precedence.", true),
});

const PlanSettingsSchema = Type.Object({
	gate: flag("Keep plan mode open until the plan is submitted. NYCODE_PLAN_GATE takes precedence.", true),
});

const NotifySettingsSchema = Type.Object({
	sound: flag("Play a sound when the agent finishes. NYCODE_SOUND_NOTIFY takes precedence.", false),
});

const text = (description: string) => Type.Optional(Type.String({ description }));

const KnowledgeSettingsSchema = Type.Object({
	vault: text("Absolute path of the knowledge vault. NYCODE_KNOWLEDGE_VAULT takes precedence."),
	graphsVault: text("Absolute path of the graphs vault. NYCODE_GRAPHS_VAULT takes precedence."),
});

const CodegraphSettingsSchema = Type.Object({
	autoRoot: text("Root where codegraph auto-indexes repositories. CODEGRAPH_AUTO_ROOT takes precedence."),
	bin: text("codegraph executable. CODEGRAPH_BIN takes precedence."),
	statusTtl: Type.Optional(
		Type.Number({
			minimum: 0,
			description: "Seconds a codegraph status stays valid; 0 disables. CODEGRAPH_STATUS_TTL takes precedence.",
		}),
	),
	autoState: text("State directory of the codegraph auto-indexer. CODEGRAPH_AUTO_STATE takes precedence."),
});

const McpSettingsSchema = Type.Object({
	configPath: text(
		"MCP servers file; defaults to mcp.json in the agent directory. NYCODE_MCP_CONFIG takes precedence.",
	),
});

const HookCommandSchema = Type.Object({
	type: Type.Literal("command"),
	command: Type.String(),
	timeout: Type.Optional(Type.Number({ minimum: 0 })),
});

const HookMatcherSchema = Type.Object({
	matcher: Type.Optional(Type.String()),
	hooks: Type.Array(HookCommandSchema),
});

const StatusLineSettingsSchema = Type.Object({
	type: Type.Literal("command"),
	command: Type.String(),
	padding: Type.Optional(Type.Number({ minimum: 0 })),
});

/** Properties added to `SettingsSchema`, one per block of section 5. */
export const NycodeSettingsProperties = {
	permissions: Type.Optional(PermissionsSettingsSchema),
	harness: Type.Optional(HarnessSettingsSchema),
	subagent: Type.Optional(SubagentSettingsSchema),
	tools: Type.Optional(ToolsSettingsSchema),
	todo: Type.Optional(TodoSettingsSchema),
	plan: Type.Optional(PlanSettingsSchema),
	notify: Type.Optional(NotifySettingsSchema),
	knowledge: Type.Optional(KnowledgeSettingsSchema),
	codegraph: Type.Optional(CodegraphSettingsSchema),
	mcp: Type.Optional(McpSettingsSchema),
	hooks: Type.Optional(
		Type.Record(Type.String(), Type.Array(HookMatcherSchema), {
			description: "Command hooks by event name, read by the hooks extension.",
		}),
	),
	statusLine: Type.Optional(StatusLineSettingsSchema),
	env: Type.Optional(
		Type.Record(Type.String(), Type.String(), {
			description: "Environment variables exported to hooks and the status line command.",
		}),
	),
};

export type HooksSettings = NonNullable<Static<typeof NycodeSettingsProperties.hooks>>;
export type StatusLineSettings = NonNullable<Static<typeof NycodeSettingsProperties.statusLine>>;
