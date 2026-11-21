/** Tool-description text for the saved routing policy: the allowlist and short scaling rules (<= 600 chars). */
import type { RoutingPolicy } from "./policy.ts";

export const ROUTING_NOTE_MAX = 600;

const RULES =
	"Omit model/effort and the router picks; a child never exceeds its parent model tier or effort. Effort: low for lookups and read-only mapping, medium for specified edits, high for security, concurrency, migrations and reviews. tools/skills only narrow the agent's own.";

export function routingDescription(policy: RoutingPolicy): string {
	const head = "Allowed model[efforts]: ";
	const budget = ROUTING_NOTE_MAX - head.length - RULES.length - 2;
	const items = Object.entries(policy.models).map(([model, efforts]) => `${model}[${efforts.join(",")}]`);
	let list = items.join(" ");
	if (list.length > budget) list = `${list.slice(0, Math.max(0, budget - 1))}…`;
	return `${head}${list}. ${RULES}`;
}
