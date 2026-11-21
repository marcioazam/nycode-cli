import { DEFAULT_MAX_AGENT_RETRY_DELAY_MS } from "@nycode/ai/utils/retry";

// nycode: K4 embedded hooks, status line and env defaults (docs/migration/ny-pi-core/02-arquitetura-alvo.md sections 5 and 6)
// The embedded resources root as the shell sees it: the `claude-rules` and `hooks` extensions export NYCODE_RESOURCES
// (core/builtin-resources.ts), so the commands below expand when they run. Quoted in the commands: the root may have spaces.
// biome-ignore lint/suspicious/noTemplateCurlyInString: shell variable, expanded when the hook runs
const RES = "${NYCODE_RESOURCES}";

/** One embedded command hook; `type` is always "command". */
const hook = (command: string, timeout: number) => ({ type: "command", command, timeout }) as const;
const graphContext = hook(`python3 "${RES}/hooks/graph_context.py"`, 10);
const dispatch = hook(`bash "${RES}/hooks/dispatch/hook-dispatch.sh"`, 10);
const impeccableGate = (timeout: number) => hook(`sh "${RES}/hooks/impeccable_gate.sh" hook`, timeout);

/** Runtime defaults shared by settings accessors and the published JSON Schema. */
export const SETTINGS_DEFAULTS = {
	transport: "auto",
	sessionShareDestination: "auto",
	steeringMode: "one-at-a-time",
	followUpMode: "one-at-a-time",
	compaction: {
		enabled: true,
		reserveTokens: 16384,
		keepRecentTokens: 20000,
		maxContextTokens: 250000,
	},
	branchSummary: {
		reserveTokens: 16384,
		skipPrompt: false,
	},
	retry: {
		enabled: true,
		maxRetries: 10,
		baseDelayMs: 2000,
		maxAgentDelayMs: DEFAULT_MAX_AGENT_RETRY_DELAY_MS,
		provider: {
			maxRetryDelayMs: 60000,
		},
	},
	hideThinkingBlock: false,
	showCacheMissNotices: false,
	// nycode: K4 nycode defaults: quietStartup "header", defaultProjectTrust "never", retry, permissions and harness blocks
	quietStartup: "header",
	defaultProjectTrust: "never",
	shellCommandPrefix:
		"export GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true GIT_MERGE_AUTOEDIT=no GIT_PAGER=cat PAGER=cat AWS_PAGER= LESS=FRX",
	collapseChangelog: false,
	enableInstallTelemetry: true,
	enableAnalytics: false,
	enableSkillCommands: true,
	terminal: {
		showImages: true,
		imageWidthCells: 60,
		clearOnShrink: false,
		showTerminalProgress: false,
		reducedMotion: false,
		nerdFont: "auto",
		asciiIcons: false,
	},
	images: {
		autoResize: true,
		blockImages: false,
	},
	doubleEscapeAction: "tree",
	treeFilterMode: "default",
	editorPaddingX: 0,
	outputPad: 1,
	autocompleteMaxVisible: 5,
	markdown: {
		codeBlockIndent: "  ",
		mermaid: "streaming",
	},
	warnings: {
		anthropicExtraUsage: true,
	},
	codemode: {
		mode: "on",
		inlineBudget: 3000,
	},
	cacheWarming: "idle",
	tuiMode: "fullscreen",
	fullscreenExitOutput: "transcript",
	fullscreenScrollbar: "auto",
	fullscreenCopyOnSelect: true,
	fullscreenWheelScrollLines: "auto",
	// nycode keys (docs/migration/ny-pi-core/02-arquitetura-alvo.md section 5); read by the extensions that own them.
	permissions: { bypass: false, engine: "script" },
	harness: {
		effortSandwich: { enabled: false, turns: 1 },
		headless: { lean: true, trim: true, tools: "lean", floor: true },
		prefixCache1h: "auto",
		autoResume: true,
		completionGate: true,
	},
	subagent: { respawn: true },
	tools: { bash: { backgroundOnTimeout: false } },
	todo: { staleReminder: true },
	plan: { gate: true },
	notify: { sound: true },
	// nycode: K4 hooks, statusLine and env defaults
	// Hooks registered by default, run by the `hooks` extension (needs python3 and jq). A `hooks` entry in settings.json
	// replaces the default list of that event; `"PreToolUse": []` turns the guard off. The ralph-loop Stop hook is a
	// third-party package (F9) and registers itself when installed.
	hooks: {
		PreToolUse: [{ matcher: "Bash|Edit|Write|Read", hooks: [hook(`python3 "${RES}/hooks/guard.py"`, 30)] }],
		SessionStart: [{ matcher: "startup|resume|clear|compact", hooks: [graphContext, dispatch, impeccableGate(5)] }],
		SubagentStart: [{ matcher: "*", hooks: [graphContext] }],
		PostToolUse: [
			{ matcher: "*", hooks: [dispatch] },
			{ matcher: "Edit|Write", hooks: [impeccableGate(5)] },
		],
		Stop: [{ hooks: [impeccableGate(30)] }],
	},
	// Status line: the claude-hud launcher. It prints nothing until the claude-hud plugin is installed (/claude-hud-setup).
	// A `statusLine` entry in settings.json replaces it; an empty `command` turns it off.
	statusLine: { type: "command", command: `node "${RES}/statusline/statusline.mjs"` },
	// Exported to every process by the `env-settings` extension; a `env` entry in settings.json adds to or overrides it.
	env: { EIO_BACKEND: "posix" },
} as const;
