// Records, fake fleet source and themes shared by the fleet panel and viewer tests.
import type { ExtensionContext } from "../../../../src/core/extensions/types.ts";
import type { FleetSource, RunRecord, TranscriptItem } from "../../../../src/extensions/subagent/fleet/types.ts";

export const NOW = 1_000_000;
export const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s };
// Tema que marca a cor, para checar estilo por grau.
export const tagTheme = { fg: (c: string, s: string) => `<${c}>${s}</${c}>`, bold: (s: string) => `*${s}*` };

export function rec(id: string, parentId: string | null, depth: number, over: Record<string, unknown> = {}): RunRecord {
	return {
		v: 1,
		id,
		parentId,
		depth,
		agent: `a-${id}`,
		task: "t",
		background: false,
		state: "running",
		startedAt: NOW - 60_000,
		updatedAt: NOW,
		turns: 1,
		toolCalls: 1,
		tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 114_400 },
		cost: 1.234,
		ownerPid: 1,
		activity: "Reading files",
		...over,
	} as unknown as RunRecord;
}

export type FakeSource = FleetSource & {
	records: RunRecord[];
	transcripts: Record<string, TranscriptItem[]>;
	calls: { stop: string[]; send: Array<[string, string]>; detach: number };
	listeners: Array<() => void>;
	foreground: boolean;
	stopOutcome: string;
	sendOutcome: string;
};

export function fakeSource(records: RunRecord[], transcripts: Record<string, TranscriptItem[]> = {}): FakeSource {
	const listeners: Array<() => void> = [];
	const calls = { stop: [] as string[], send: [] as Array<[string, string]>, detach: 0 };
	const s = {
		records,
		transcripts,
		calls,
		listeners,
		foreground: false,
		stopOutcome: "stopping",
		sendOutcome: "queued",
		list: () => s.records,
		readTranscript: (id: string, from: number) => ({
			items: (s.transcripts[id] ?? []).slice(from),
			next: (s.transcripts[id] ?? []).length,
		}),
		stop: (id: string) => {
			calls.stop.push(id);
			return s.stopOutcome;
		},
		send: (id: string, text: string) => {
			calls.send.push([id, text]);
			return s.sendOutcome;
		},
		hasForeground: () => s.foreground,
		detachForeground: () => {
			calls.detach++;
			return 2;
		},
		onChange: (l: () => void) => {
			listeners.push(l);
			return () => {
				listeners.splice(listeners.indexOf(l), 1);
			};
		},
	};
	return s as unknown as FakeSource;
}

export const tree3 = () => [
	rec("a", null, 1, { startedAt: 1 }),
	rec("a1", "a", 2, { startedAt: 2 }),
	rec("a1x", "a1", 3, { startedAt: 3 }),
	rec("a1y", "a1", 3, { startedAt: 4 }),
	rec("a2", "a", 2, { startedAt: 5 }),
	rec("a2x", "a2", 3, { startedAt: 6 }),
	rec("b", null, 1, { startedAt: 7 }),
];

export const K = {
	down: "\x1b[B",
	up: "\x1b[A",
	right: "\x1b[C",
	left: "\x1b[D",
	enter: "\r",
	esc: "\x1b",
	ctrlB: "\x02",
	tab: "\t",
	shiftTab: "\x1b[Z",
	pgUp: "\x1b[5~",
	pgDn: "\x1b[6~",
	home: "\x1b[H",
	end: "\x1b[F",
	bs: "\x7f",
};

export interface FakeComp {
	render(width: number): string[];
	handleInput(data: string): void;
	dispose?(): void;
}

export function fakeCtx(results: Array<(comp: FakeComp) => void>) {
	const calls: unknown[] = [];
	const notes: Array<[string, string?]> = [];
	const comps: FakeComp[] = [];
	const ctx = {
		hasUI: true,
		ui: {
			notify: (m: string, t?: string) => notes.push([m, t]),
			custom: async (factory: (...a: unknown[]) => FakeComp, options: unknown) => {
				calls.push(options);
				const tui = { requestRender() {}, terminal: { rows: 30 } };
				let finish: (v: unknown) => void = () => {};
				const p = new Promise((r) => {
					finish = r;
				});
				const comp = factory(tui, theme, {}, finish);
				comps.push(comp);
				comp.render(80);
				const next = results.shift();
				if (next) next(comp);
				const out = await p;
				comp.dispose?.();
				return out;
			},
		},
	};
	return { ctx: ctx as unknown as ExtensionContext, calls, notes, comps };
}
