/**
 * Per-spawn capability narrowing (docs/subagent-routing-2026-11-13.md, AC6/AC7): the agent's frontmatter stays
 * the source of tools and skills; a spawn may only narrow them, never widen. Plus the `agents:` allowlist a
 * child carries to its own spawns, and the depth ceiling that removes the `subagent` tool.
 */
import type { AgentConfig } from "../registry/agents.ts";

export const ALLOWED_AGENTS_ENV = "NYCODE_SUBAGENT_ALLOWED_AGENTS";

const fold = (name: string): string => name.toLowerCase().replaceAll("-", "_");
const strings = (value: unknown): string[] | undefined =>
	Array.isArray(value)
		? value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim())
		: undefined;

/** Does the agent's grant `entry` (an exact name or a `prefix*` pattern) cover the requested name? */
const covers = (entry: string, name: string): boolean =>
	entry.endsWith("*") ? fold(name).startsWith(fold(entry.slice(0, -1))) : fold(entry) === fold(name);

export interface Narrowed {
	value: string[] | undefined;
	ignored: string[];
}

/** Narrow `own` (undefined = unrestricted) by `requested`. A request that leaves nothing is ignored whole. */
export function narrowList(own: string[] | undefined, requestedRaw: unknown): Narrowed {
	const requested = strings(requestedRaw);
	if (!requested || requested.length === 0) return { value: own, ignored: [] };
	if (own === undefined) return { value: requested, ignored: [] };
	// An exact grant is emitted in the agent's own spelling; a `prefix*` grant yields the narrower requested name.
	const kept = new Set<string>();
	const ignored: string[] = [];
	for (const name of requested) {
		const entry = own.find((e) => covers(e, name));
		if (entry === undefined) ignored.push(name);
		else kept.add(entry.endsWith("*") ? name : entry);
	}
	if (kept.size === 0) return { value: own, ignored: requested };
	return { value: [...kept], ignored };
}

/** Skills a child may preload: only the agent's own, narrowed by the request (it can never add one). */
export function narrowSkills(own: string[] | undefined, requestedRaw: unknown): Narrowed {
	const requested = strings(requestedRaw);
	if (!requested || requested.length === 0) return { value: own, ignored: [] };
	const owned = own ?? [];
	const kept = requested.filter((name) => owned.includes(name));
	return { value: kept.length > 0 ? kept : own, ignored: requested.filter((name) => !kept.includes(name)) };
}

/** The `agents:` allowlist a child inherits (JSON array) = the agent's own ∩ the one this process inherited; empty string = unrestricted. */
export function childAllowedAgents(
	agent: Pick<AgentConfig, "agents">,
	env: Record<string, string | undefined> = process.env,
): string {
	const inherited = allowedAgents(env);
	const own = agent.agents;
	const effective = own && inherited ? own.filter((name) => inherited.includes(name)) : (own ?? inherited);
	return effective ? JSON.stringify(effective) : "";
}

/** The names this session may spawn, from the env its parent set; undefined = all. A malformed value restricts nothing. */
export function allowedAgents(env: Record<string, string | undefined> = process.env): string[] | undefined {
	const raw = env[ALLOWED_AGENTS_ENV];
	if (!raw) return undefined;
	try {
		return strings(JSON.parse(raw));
	} catch {
		return undefined;
	}
}

/** Keep only the agents this session may spawn. */
export const filterAllowed = <T extends { name: string }>(
	agents: T[],
	env: Record<string, string | undefined> = process.env,
): T[] => {
	const allowed = allowedAgents(env);
	return allowed ? agents.filter((a) => allowed.includes(a.name)) : agents;
};
