/**
 * Pure, deterministic spawn router (docs/subagent-routing-2026-11-13.md, AC4). Order: (a) the orchestrator's
 * request when the policy allows it, (b) otherwise an automatic pick from the agent's tier hint and a small
 * effort score, (c) a final clamp to the allowlist and to the parent's ceiling (a child never exceeds its
 * parent's model tier or effort). No I/O and no LLM call: O(models).
 */
import { type Effort, effortRank, isEffort, type RoutingPolicy } from "./policy.ts";

export interface CatalogModel {
	/** `provider/id`. */
	key: string;
	/** Output cost per million tokens; unknown = no tier. */
	cost?: number;
}

export interface RouteInput {
	policy: RoutingPolicy;
	catalog: CatalogModel[];
	/** The parent session's model key and effort; unknown = no ceiling on that axis. */
	parent: { model?: string; effort?: string };
	/** Depth of the child being spawned (1 = child of the main session). */
	degree: number;
	agent: { name: string; tools?: string[] /** frontmatter model pin or tier alias, a hint only */; pin?: string };
	brief: string;
	request?: { model?: string; effort?: string };
}

export interface RouteResult {
	model: string;
	effort: Effort;
	source: "orchestrator" | "auto" | "clamped";
	reason: string;
}

const LADDER: readonly Effort[] = ["low", "medium", "high", "xhigh"];
const RISK =
	/(?<![\p{L}\p{N}_])(auth\w*|autentica\w*|secrets?|secur\w+|migrations?|concurren\w+|race|payments?|money|crypto\w*|deadlocks?|data loss|segurança|segredos?|migração|concorrência|pagamentos?|dinheiro|criptografia|perda de dados)(?![\p{L}\p{N}_])/iu;
const REVIEW_ROLE = /review|secur|plan|advers|audit/i;
const WRITE_TOOLS = new Set(["write", "edit"]);

/** Tier = rank of the model's output cost among the distinct costs of the catalog (ties share a tier). */
function tierMap(catalog: CatalogModel[]): (key: string | undefined) => number | undefined {
	const costs = [...new Set(catalog.flatMap((m) => (typeof m.cost === "number" ? [m.cost] : [])))].sort(
		(a, b) => a - b,
	);
	const byKey = new Map(catalog.map((m) => [m.key, m.cost]));
	return (key) => {
		const cost = key === undefined ? undefined : byKey.get(key);
		return typeof cost === "number" ? costs.indexOf(cost) : undefined;
	};
}

/** Tier of the agent's pin (`provider/id`, bare id or alias such as `sonnet`); the cheapest catalog match. */
function hintTier(
	pin: string | undefined,
	catalog: CatalogModel[],
	tier: (k: string) => number | undefined,
): number | undefined {
	if (!pin) return undefined;
	const needle = pin.toLowerCase();
	const tiers = catalog
		.filter((m) => m.key.toLowerCase() === needle || m.key.toLowerCase().includes(needle))
		.flatMap((m) => tier(m.key) ?? []);
	return tiers.length ? Math.min(...tiers) : undefined;
}

/** Effort target from the brief, the role and the depth; clamped to low..xhigh (auto never picks off or max). */
export function autoEffort(input: Pick<RouteInput, "agent" | "brief" | "degree">): { effort: Effort; notes: string[] } {
	let score = 1;
	const notes: string[] = [];
	const bump = (delta: number, note: string): void => {
		score += delta;
		notes.push(`${delta > 0 ? "+" : "-"}${note}`);
	};
	if (RISK.test(input.brief)) bump(1, "risk");
	if (REVIEW_ROLE.test(input.agent.name)) bump(1, "review-role");
	const tools = input.agent.tools;
	if (tools && !tools.some((t) => WRITE_TOOLS.has(t.toLowerCase()))) bump(-1, "read-only");
	if (input.brief.length < 400) bump(-1, "short-brief");
	else if (input.brief.length > 6000) bump(1, "long-brief");
	if (input.degree > 1) bump(-(input.degree - 1), `degree${input.degree}`);
	return { effort: LADDER[Math.min(LADDER.length - 1, Math.max(0, score))]!, notes };
}

/** Highest allowed effort <= ceiling, else the lowest allowed one. */
function clampEffort(allowed: Effort[], target: number, cap: number | undefined): Effort {
	const ceiling = Math.min(target, cap ?? Infinity);
	const sorted = [...allowed].sort((a, b) => effortRank(a) - effortRank(b));
	return [...sorted].reverse().find((e) => effortRank(e) <= ceiling) ?? sorted[0]!;
}

export function hasRisk(brief: string): boolean {
	return RISK.test(brief);
}

export function routeSpawn(input: RouteInput): RouteResult | undefined {
	const { policy, catalog, request } = input;
	const tier = tierMap(catalog);
	const known = new Set(catalog.map((m) => m.key));
	// A model the user can no longer run is skipped; an empty catalog (unknown) skips nothing.
	const allowed = Object.keys(policy.models).filter((key) => known.size === 0 || known.has(key));
	if (allowed.length === 0) return undefined;
	const reasons: string[] = [];
	const capTier = tier(input.parent.model);
	const capEffort = isEffort(input.parent.effort) ? effortRank(input.parent.effort) : undefined;
	const byTier = (a: string, b: string): number => (tier(a) ?? Infinity) - (tier(b) ?? Infinity) || a.localeCompare(b);
	const eligible = allowed.filter((key) => capTier === undefined || (tier(key) ?? Infinity) <= capTier).sort(byTier);
	const nearest = (target: number | undefined): string => {
		if (target === undefined) return eligible[0]!;
		return [...eligible].sort(
			(a, b) => Math.abs((tier(a) ?? Infinity) - target) - Math.abs((tier(b) ?? Infinity) - target) || byTier(a, b),
		)[0]!;
	};
	let clamped = false;
	let unsatisfiable = false;
	let model: string;
	if (eligible.length === 0) {
		// Nothing allowed fits under the parent's tier: the cheapest allowed model at its lowest effort.
		model = [...allowed].sort(byTier)[0]!;
		unsatisfiable = true;
		clamped = true;
		reasons.push("no allowed model within the parent ceiling: cheapest allowed");
	} else if (request?.model) {
		if (eligible.includes(request.model)) model = request.model;
		else {
			clamped = true;
			model = nearest(tier(request.model));
			reasons.push(
				allowed.includes(request.model)
					? `${request.model} above the parent ceiling`
					: `${request.model} not allowed`,
			);
		}
	} else {
		const base = hintTier(input.agent.pin, catalog, (k) => tier(k)) ?? capTier;
		model = nearest(base);
		if (hasRisk(input.brief)) {
			const up = eligible.find((key) => (tier(key) ?? -1) > (tier(model) ?? Infinity));
			if (up) model = up;
		}
	}
	const supported = policy.models[model]!;
	let effort: Effort;
	if (unsatisfiable) effort = clampEffort(supported, -1, undefined);
	else if (request?.effort && isEffort(request.effort)) {
		effort = clampEffort(supported, effortRank(request.effort), capEffort);
		if (effort !== request.effort) {
			clamped = true;
			reasons.push(`effort ${request.effort} -> ${effort}`);
		}
	} else {
		const auto = autoEffort(input);
		effort = clampEffort(supported, effortRank(auto.effort), capEffort);
		if (effort !== auto.effort) reasons.push(`effort ${auto.effort} -> ${effort}`);
		reasons.unshift(`score ${auto.effort}${auto.notes.length ? ` (${auto.notes.join(" ")})` : ""}`);
	}
	if (capEffort !== undefined && effortRank(effort) > capEffort) {
		clamped = true;
		reasons.push("no allowed effort within the parent ceiling: lowest allowed");
	}
	const source = clamped
		? "clamped"
		: request?.model || (request?.effort && isEffort(request.effort))
			? "orchestrator"
			: "auto";
	return { model, effort, source, reason: reasons.join("; ") || "as requested" };
}
