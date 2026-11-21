import { DEFAULT_MAX_AGENT_RETRY_DELAY_MS } from "@nycode/ai/utils/retry";

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
	permissions: { bypass: false },
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
} as const;
