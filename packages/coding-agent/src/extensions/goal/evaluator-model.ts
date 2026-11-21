/** Which model judges the goal, and how much of its context window the transcript may use. */

import type { ExtensionContext } from "../../core/extensions/types.ts";
import { resolveModelOverride } from "../_shared/model/model-lookup.ts";

/** Claude trims the transcript to half the evaluator's context window. */
const TRANSCRIPT_WINDOW_SHARE = 0.5;
const CHARS_PER_TOKEN = 4;
const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Claude evaluates on its small fast model, ANTHROPIC_DEFAULT_HAIKU_MODEL overriding it;
 * pi has no such tier, so the session model stands in unless the override names one of
 * the models this user can run. */
export function evaluatorModel(ctx: ExtensionContext): ExtensionContext["model"] {
	const override = process.env.NYCODE_GOAL_MODEL?.trim() || process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL?.trim();
	if (override) return resolveModelOverride(ctx, override);
	return smallFastModel(ctx) ?? ctx.model;
}

/** Claude's small fast model, found the way Claude names it: the newest Haiku of the
 * session's provider that this user can run (dated snapshots skipped). Undefined when
 * the provider has none, and the session model judges instead. */
function smallFastModel(ctx: ExtensionContext): ExtensionContext["model"] {
	const session = ctx.model;
	if (!session) return undefined;
	const available = (ctx.modelRegistry?.getAvailable?.() ?? []) as NonNullable<ExtensionContext["model"]>[];
	const version = (id: string): number[] => (/(\d+)-(\d+)/.exec(id)?.slice(1) ?? ["0", "0"]).map(Number);
	const candidates = available.filter(
		(m) => m.provider === session.provider && /haiku/i.test(m.id) && !/\d{8}$/.test(m.id),
	);
	candidates.sort((a, b) => {
		const [aMajor, aMinor] = version(a.id);
		const [bMajor, bMinor] = version(b.id);
		return bMajor - aMajor || bMinor - aMinor;
	});
	return candidates[0];
}

export function modelLabel(model: ExtensionContext["model"]): string | undefined {
	return model ? `${model.provider}/${model.id}` : undefined;
}

export function transcriptBudget(model: { contextWindow?: number }): number {
	return Math.floor((model.contextWindow || DEFAULT_CONTEXT_WINDOW) * TRANSCRIPT_WINDOW_SHARE * CHARS_PER_TOKEN);
}
