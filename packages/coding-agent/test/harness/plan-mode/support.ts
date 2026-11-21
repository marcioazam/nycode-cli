// Shared fake ExtensionAPI for the plan-mode tests (ported from the pi-code patch tests, which each inlined this fake).
import type { ExtensionAPI } from "../../../src/core/extensions/types.ts";
import planMode from "../../../src/extensions/plan-mode/index.ts";

/** Loose on purpose: the fakes stand in for host types (API, context, messages) that the tests only partly fill in. */
export type Loose = any;

export interface FakeOptions {
	/** Tools active when the extension loads (the set plan mode saves and restores). */
	active?: string[];
	/** Names `getAllTools` reports; defaults to the active set. */
	allTools?: string[];
	/** Captures `registerMarkdownTransformer` when true. */
	transformer?: boolean;
	/** `getFlag` result. */
	flag?: boolean | undefined;
}

/** Loads the plan-mode extension against a recording fake of the extension API. */
export function fakePi(opts: FakeOptions = {}) {
	/** Last handler registered per event (the extension registers one per event unless a test says otherwise). */
	const on: Record<string, Loose> = {};
	/** Every handler registered per event, in order. */
	const handlers: Record<string, Loose[]> = {};
	const bus: Record<string, Array<(d: unknown) => void>> = {};
	const cmds: Record<string, Loose> = {};
	const tools: Record<string, Loose> = {};
	const shortcuts: Loose[] = [];
	const entries: Array<{ customType: string; data: Loose }> = [];
	const sent: Loose[] = [];
	const emitted: Array<[string, Loose]> = [];
	const captured: { transformer?: Loose; options?: Loose } = {};
	let active = opts.active ?? ["read", "bash", "edit", "plan_mode_complete"];
	const pi: Loose = {
		on: (event: string, handler: Loose) => {
			on[event] = handler;
			handlers[event] = [...(handlers[event] ?? []), handler];
		},
		registerCommand: (name: string, command: Loose) => {
			cmds[name] = command;
		},
		registerTool: (tool: Loose) => {
			tools[tool.name] = tool;
		},
		registerShortcut: (_key: unknown, shortcut: Loose) => {
			shortcuts.push(shortcut);
		},
		registerFlag() {},
		...(opts.transformer
			? {
					registerMarkdownTransformer: (transformer: Loose, options: Loose) => {
						captured.transformer = transformer;
						captured.options = options;
					},
				}
			: {}),
		getFlag: () => opts.flag,
		getActiveTools: () => active,
		setActiveTools: (names: string[]) => {
			active = names;
		},
		getAllTools: () => (opts.allTools ?? active).map((name) => ({ name })),
		events: {
			emit: (channel: string, data: unknown) => {
				emitted.push([channel, data]);
				for (const handler of bus[channel] ?? []) handler(data);
			},
			on: (channel: string, handler: (d: unknown) => void) => {
				bus[channel] = [...(bus[channel] ?? []), handler];
			},
		},
		appendEntry: (customType: string, data: unknown) => {
			entries.push({ customType, data });
		},
		sendMessage: (message: Loose) => {
			sent.push(message);
		},
		sendUserMessage() {},
	};
	planMode(pi as ExtensionAPI);
	return { pi, on, handlers, bus, cmds, tools, shortcuts, entries, sent, emitted, captured, active: () => active };
}

export const PLAN = "Tier: T0 (teste)\n1. contar a.txt\n- wc -l a.txt\n2. contar b.txt\n- wc -l b.txt";

/** The assistant message a turn ends with. */
export const assistant = (text: string, stopReason = "stop") => ({
	role: "assistant",
	content: [{ type: "text", text }],
	stopReason,
});

/** A UI stub whose `select` picks "Execute the plan (track progress)". */
export function fakeUi(extra: Loose = {}): Loose {
	return {
		notify() {},
		setStatus() {},
		setWidget() {},
		select: async () => "Execute the plan (track progress)",
		editor: async () => "",
		theme: { fg: (_c: string, s: string) => s },
		...extra,
	};
}

/** A context with an idle session and an empty branch. */
export function fakeCtx(extra: Loose = {}): Loose {
	return {
		hasUI: true,
		ui: fakeUi(),
		isIdle: () => true,
		sessionManager: { getEntries: () => [], getBranch: () => [] },
		...extra,
	};
}

/** Enters plan mode, submits a two-step plan and lets the run end so execution starts. */
export async function startExecution(fake: ReturnType<typeof fakePi>, ctx: Loose) {
	await fake.cmds.plan.handler("", ctx);
	await fake.tools.plan_mode_complete.execute("id", { plan: PLAN });
	await fake.on.agent_end({ messages: [] }, ctx);
}

/** Strips SGR colour sequences. Repeats until stable so nested fragments cannot survive one pass. */
export function stripAnsi(text: string): string {
	let out = text;
	for (let prev = ""; prev !== out; ) {
		prev = out;
		out = out.replace(/\x1b\[[0-9;]*m/g, "");
	}
	return out;
}
