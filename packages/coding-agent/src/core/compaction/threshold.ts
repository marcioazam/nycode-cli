// nycode: K9 absolute-size compaction rule, called once from agent-session.ts when the session settles
// Absolute-size compaction safety net (K9): once the session settles, compact when the context passed the limit.
// Covers models without a compaction.modelOverrides entry. Awaited by the caller so `-p` does not exit mid-compaction.
// The limit is `compaction.maxContextTokens` (env NYCODE_COMPACT_AT), resolved by settings-nycode.ts.
import type { Env } from "../settings-nycode.ts";

/** The slice of ExtensionContext this rule uses. */
export interface CompactThresholdContext {
	hasUI: boolean;
	ui: { notify: (message: string, type: "info" | "error") => void };
}

/** Sizes in the unit tokens, as the session reports them. */
export interface CompactThresholdInput {
	aborted: boolean;
	isCompacting: boolean;
	/** Context window of the model in use; undefined when there is no model. */
	contextWindow: number | undefined;
	/** Lazy: the session projects its messages on each call. */
	getTokens: () => number | null | undefined;
	limit: number;
	/** Lazy: only built when the rule compacts or notifies. */
	getContext: () => CompactThresholdContext;
	compact: () => Promise<unknown>;
}

let warnedInvalidEnv = false;

/** Warns once when NYCODE_COMPACT_AT is set but is not a positive integer (the resolver then skips it silently). */
export function warnInvalidCompactAt(env: Env, limit: number, warn: (message: string) => void = console.error): void {
	const raw = env.NYCODE_COMPACT_AT;
	if (raw === undefined || warnedInvalidEnv) return;
	const n = Number(raw);
	if (raw.trim() !== "" && Number.isSafeInteger(n) && n > 0) return;
	warnedInvalidEnv = true;
	warn(`NYCODE_COMPACT_AT="${raw}" recusado (esperado inteiro positivo); usando ${limit}`);
}

/** Reports a failed compaction: a notification with UI, stderr without. */
export function reportCompactError(
	ctx: CompactThresholdContext,
	error: Error,
	warn: (message: string) => void = console.error,
): void {
	if (ctx.hasUI) ctx.ui.notify(`Compactação falhou: ${error.message}`, "error");
	else warn(`Compactação falhou: ${error.message}`);
}

/** Compacts and waits when the settled session holds `limit` tokens or more. Never throws. */
export async function compactWhenOverLimit(input: CompactThresholdInput): Promise<void> {
	const { limit, contextWindow } = input;
	if (input.aborted || input.isCompacting) return;
	// A window below the limit never reaches it (usage is unknown without a model or window); native overflow compaction covers it.
	if (contextWindow === undefined || contextWindow <= 0 || contextWindow < limit) return;
	const tokens = input.getTokens();
	if (tokens == null || tokens < limit) return;
	const ctx = input.getContext();
	if (ctx.hasUI) ctx.ui.notify(`Contexto em ${Math.round(tokens / 1000)}k ≥ ${limit / 1000}k: compactando`, "info");
	try {
		await input.compact();
	} catch (error) {
		reportCompactError(ctx, error instanceof Error ? error : new Error(String(error)));
	}
}
