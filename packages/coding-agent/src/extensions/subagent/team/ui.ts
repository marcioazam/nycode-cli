/** What the fleet panel and viewer read from the team: the ✉n counts and a run's conversation. Contract: types.ts. */
import { currentFleetDir } from "../fleet/store.ts";
import type { TranscriptItem } from "../fleet/types.ts";
import { readMessages } from "./store.ts";
import { teamEnabled } from "./types.ts";

const counts = new Map<string, { next: number; byRun: Map<string, number> }>();

/** Messages received per run, read incrementally; undefined when team mode is off. */
export function unreadCounts(): ReadonlyMap<string, number> | undefined {
	const dir = teamEnabled() ? currentFleetDir() : undefined;
	if (!dir) return undefined;
	const state = counts.get(dir) ?? { next: 0, byRun: new Map<string, number>() };
	const { items, next } = readMessages(dir, state.next);
	state.next = next;
	for (const m of items) state.byRun.set(m.to, (state.byRun.get(m.to) ?? 0) + 1);
	counts.set(dir, state);
	return state.byRun;
}

/** The messages a run sent or received as viewer items (`tool: 'team'` marks them), from byte offset `from`. */
export function conversationItems(id: string, from: number): { items: TranscriptItem[]; next: number } {
	const dir = teamEnabled() ? currentFleetDir() : undefined;
	if (!dir) return { items: [], next: from };
	const { items, next } = readMessages(dir, from);
	return {
		items: items
			.filter((m) => m.from === id || m.to === id)
			.map((m) => ({
				t: m.t,
				kind: "note" as const,
				tool: "team",
				text: `✉ ${m.fromAgent} → ${m.toAgent} [${m.kind}]: ${m.text}`,
			})),
		next,
	};
}
