/**
 * Applies the saved routing policy to one spawn (docs/subagent-routing-2026-11-13.md, AC5-AC7): the routed
 * model and effort replace the agent's pin, a spawn's `tools`/`skills` only narrow the agent's own, the child
 * runs without the skill catalog, and the child's env carries the parent ceiling and its `agents:` allowlist.
 * With no policy the agent is returned untouched. A spawn is never refused for a policy problem.
 */

import { maxSubagentDepth, subagentDepth } from "../nesting/index.ts";
import type { AgentConfig } from "../registry/agents.ts";
import { ALLOWED_AGENTS_ENV, childAllowedAgents, narrowList, narrowSkills } from "./capabilities.ts";
import { loadPolicy } from "./policy.ts";
import { type CatalogModel, routeSpawn } from "./route.ts";

export const PARENT_MODEL_ENV = "NYCODE_SUBAGENT_PARENT_MODEL";
export const PARENT_EFFORT_ENV = "NYCODE_SUBAGENT_PARENT_EFFORT";
/** Read by skills.ts: a child with this set receives no skill paths from resources_discover. */
export const NO_SKILLS_ENV = "NYCODE_SUBAGENT_NO_SKILLS";

type Env = Record<string, string | undefined>;

/** What the orchestrator may ask for, per spawn. */
export interface SpawnRequest {
	model?: string;
	effort?: string;
	tools?: string[];
	skills?: string[];
}

export interface RoutingSession {
	catalog: CatalogModel[];
	/** The session's own model key and thinking level (the parent of a depth-1 spawn). */
	model?: string;
	effort?: string;
}

export interface ResolvedSpawn {
	agent: AgentConfig;
	env: Record<string, string>;
	args: string[];
	/** `route: ...` line for the result text; absent when nothing was routed. */
	note?: string;
}

let session: RoutingSession = { catalog: [] };
export function setRoutingSession(next: RoutingSession): void {
	session = next;
}

export function routingNote(
	route: { model: string; effort: string; source: string; reason: string },
	ignored: string[],
): string {
	return `route: ${route.model} · ${route.effort} (${route.source}: ${route.reason}${ignored.length ? `; ignored ${ignored.join("; ")}` : ""})`;
}

export function resolveSpawn(
	agent: AgentConfig,
	request: SpawnRequest | undefined,
	brief: string,
	env: Env = process.env,
): ResolvedSpawn {
	const base: ResolvedSpawn = { agent, env: { [ALLOWED_AGENTS_ENV]: childAllowedAgents(agent, env) }, args: [] };
	if (base.env[ALLOWED_AGENTS_ENV] === "") delete base.env[ALLOWED_AGENTS_ENV];
	try {
		const policy = loadPolicy(env);
		if (!policy) return base;
		const degree = subagentDepth(env) + 1;
		const route = routeSpawn({
			policy,
			catalog: session.catalog,
			parent: { model: env[PARENT_MODEL_ENV] ?? session.model, effort: env[PARENT_EFFORT_ENV] ?? session.effort },
			degree,
			agent: { name: agent.name, tools: agent.tools, pin: agent.model ?? agent.modelAlias },
			brief,
			request,
		});
		const tools = narrowList(agent.tools, request?.tools);
		const skills = narrowSkills(agent.skills, request?.skills);
		const atCeiling = degree >= maxSubagentDepth(env);
		const routed: AgentConfig = {
			...agent,
			...(route ? { model: route.model, modelAlias: undefined, effort: route.effort } : {}),
			...(tools.value ? { tools: tools.value } : {}),
			...(skills.value ? { skills: skills.value } : {}),
			...(atCeiling ? { disallowedTools: [...(agent.disallowedTools ?? []), "subagent"] } : {}),
		};
		const ignored = [
			...(tools.ignored.length ? [`tools ${tools.ignored.join(",")}`] : []),
			...(skills.ignored.length ? [`skills ${skills.ignored.join(",")}`] : []),
		];
		return {
			agent: routed,
			env: {
				...base.env,
				...(route ? { [PARENT_MODEL_ENV]: route.model, [PARENT_EFFORT_ENV]: route.effort } : {}),
				[NO_SKILLS_ENV]: "1",
			},
			args: ["--no-skills"],
			note: route
				? routingNote(route, ignored)
				: `route: no allowed model available, agent pin kept${ignored.length ? `; ignored ${ignored.join("; ")}` : ""}`,
		};
	} catch (error) {
		return { ...base, note: `route: skipped (${(error as Error).message})` };
	}
}
