/** Addressing and delivery of team messages. Contract: types.ts. */
import { randomUUID } from "node:crypto";
import { appendInbox, appendJsonl, readRecord, readRecords, validRunId } from "../fleet/store.ts";
import type { RunRecord } from "../fleet/types.ts";
import { logMessage, mainInboxFile, spendSend } from "./store.ts";
import { KINDS, LEAD_ID, LIMITS, type MessageKind, type Result, type Self, type TeamMessage } from "./types.ts";

export interface Target {
	id: string;
	agent: string;
}

const running = (dir: string): RunRecord[] => readRecords(dir).filter((r) => r.state === "running");

/** The recipients of `to` for `self`, or why there are none. */
export function resolveTargets(dir: string, self: Self, to: string): Result<{ targets: Target[] }> {
	const live = running(dir);
	const fail = (error: string): Result<{ targets: Target[] }> => ({ ok: false, error });
	const lead: Target = { id: LEAD_ID, agent: "lead" };
	const one = (t: Target): Result<{ targets: Target[] }> =>
		t.id === self.id ? fail("team: cannot send to yourself") : { ok: true, targets: [t] };
	if (to === "lead") return one(lead);
	if (to === "all") {
		// The lead coordinates, so a broadcast from any member reaches it too.
		const targets = [
			...live.filter((r) => r.id !== self.id).map((r) => ({ id: r.id, agent: r.agent })),
			...(self.id === LEAD_ID ? [] : [lead]),
		];
		return targets.length > 0 ? { ok: true, targets } : fail("team: nobody else is running");
	}
	if (to === "parent") {
		const parentId = self.id === LEAD_ID ? undefined : (readRecord(dir, self.id)?.parentId ?? null);
		if (parentId === undefined) return fail("team: the lead has no parent");
		if (parentId === null) return one(lead);
		const parent = live.find((r) => r.id === parentId);
		return parent ? one({ id: parent.id, agent: parent.agent }) : fail(`team: parent ${parentId} is not running`);
	}
	if (validRunId(to)) {
		const rec = readRecord(dir, to);
		if (!rec) return fail(`team: no run ${to}`);
		return rec.state === "running"
			? one({ id: rec.id, agent: rec.agent })
			: fail(`team: run ${to} is not running (${rec.state})`);
	}
	const named = live.filter((r) => r.agent === to && r.id !== self.id);
	if (named.length === 1) return one({ id: named[0]!.id, agent: named[0]!.agent });
	if (named.length > 1) return fail(`team: "${to}" is ambiguous, use a run id: ${named.map((r) => r.id).join(", ")}`);
	return fail(`team: no running agent named "${to}"; use roster`);
}

export function renderMessage(msg: TeamMessage): string {
	return `[team message from ${msg.fromAgent} (${msg.from}) → you, ${msg.kind}]: ${msg.text}\nreply with team send`;
}

export interface SendArgs {
	to: string;
	kind: MessageKind;
	text: string;
}

/** Validates, charges the budgets, writes one inbox entry per recipient and logs it. */
export function sendMessage(dir: string, self: Self, args: SendArgs): Result<{ delivered: Target[] }> {
	if (!KINDS.includes(args.kind)) return { ok: false, error: `team: kind must be one of ${KINDS.join(", ")}` };
	if (typeof args.text !== "string" || args.text.trim() === "") return { ok: false, error: "team: text is empty" };
	if (args.text.length > LIMITS.text)
		return { ok: false, error: `team: text is ${args.text.length} chars, the limit is ${LIMITS.text}` };
	const resolved = resolveTargets(dir, self, String(args.to));
	if (!resolved.ok) return resolved;
	const budget = spendSend(dir, self.id);
	if (budget) return { ok: false, error: budget };
	const t = Date.now();
	for (const target of resolved.targets) {
		const msg: TeamMessage = {
			id: randomUUID().slice(0, 8),
			t,
			from: self.id,
			fromAgent: self.agent,
			to: target.id,
			toAgent: target.agent,
			kind: args.kind,
			text: args.text,
		};
		const entry = { id: msg.id, t, text: renderMessage(msg) };
		if (target.id === LEAD_ID) appendJsonl(mainInboxFile(dir), entry);
		else appendInbox(dir, target.id, entry);
		logMessage(dir, msg);
	}
	return { ok: true, delivered: resolved.targets };
}
