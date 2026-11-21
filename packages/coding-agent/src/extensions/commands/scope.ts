import * as path from "node:path";
import { type PathRuleTool, substituteVars } from "../_shared/commands/command-file.ts";
import { findModel } from "../_shared/model/model-lookup.ts";

/** Just enough of pi's Model to match and restore; getAvailable returns these. */
export interface ModelLike {
	id: string;
	name?: string;
	contextWindow?: number;
}

/** Resolve a command's `model:` frontmatter to an available model. Claude accepts a
 * tier alias (sonnet/opus/haiku/fable), a concrete id, or `inherit`; pi matches by
 * exact id first, then a substring of the id or name (the same fuzzy rule the
 * subagent uses). `inherit` and an unresolvable name leave the model unchanged. */
export function resolveCommandModel(
	model: string | undefined,
	available: ReadonlyArray<ModelLike>,
): ModelLike | undefined {
	if (!model || model.toLowerCase() === "inherit") return undefined;
	return findModel(model, available);
}

/** Substitute ${CLAUDE_*} into a path rule. A variable that expands to an absolute
 * path at the anchor position (e.g. Read(${CLAUDE_PROJECT_DIR}/docs/**)) names that
 * exact location, so it is marked with Claude's `//` filesystem-absolute anchor;
 * otherwise resolveRule reads the single leading slash as project-relative and
 * re-anchors it under the project root, where it can never match. */
function substitutePathRule(rule: string, vars: Record<string, string | undefined>): string {
	const substituted = substituteVars(rule, vars);
	return rule.trimStart().startsWith("${CLAUDE_") && path.isAbsolute(substituted) ? `/${substituted}` : substituted;
}

/** One scalar argument scope checked against one call: undefined when the tool is
 * unscoped for this run or the call matches, otherwise a block naming the rules in
 * force and the value that failed them. */
export function scopeVerdict(
	rules: string[] | undefined,
	tool: string,
	subjectLabel: string,
	subject: string,
	matches: (rules: string[]) => boolean,
): { block: true; reason: string } | undefined {
	if (!rules) return undefined;
	if (matches(rules)) return undefined;
	return {
		block: true,
		reason: `allowed-tools: ${tool} is scoped for this command.\nAllowed: ${rules.join(", ")}\n${subjectLabel}: ${subject}`,
	};
}

/** The path rules that survive an allowed-tools intersection: only the tools the
 * grant kept get their scopes, each rule ${CLAUDE_*}-substituted like the body. */
export function scopedPathRules(
	pathRules: Partial<Record<PathRuleTool, string[]>>,
	granted: string[],
	vars: Record<string, string | undefined>,
): Partial<Record<PathRuleTool, string[]>> {
	const result: Partial<Record<PathRuleTool, string[]>> = {};
	for (const [tool, rules] of Object.entries(pathRules)) {
		if (granted.includes(tool)) result[tool as PathRuleTool] = rules.map((rule) => substitutePathRule(rule, vars));
	}
	return result;
}
