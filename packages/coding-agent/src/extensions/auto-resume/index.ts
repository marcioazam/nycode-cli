/**
 * Auto-resume: resumes the session by itself when the provider fails with a transient error AFTER nycode's internal
 * retries are exhausted (settings retry.maxRetries=10, ~6 min). Reason: the 2026-11-13 503 incidents (Anthropic
 * outage) left sessions stopped mid-work, in the main session and in `subagent` children (NYCODE_SUBAGENT=1), so it
 * applies to both.
 *
 * Mechanism: `agent_before_settle` looks at the last assistant message; if it ended in a retryable error (not a context
 * overflow), it waits 30s/90s/3/5/10 min (abortable) and returns an `auto-resume` `custom_message` with
 * `continue: true`. Limit: 5 consecutive attempts (counted by the `auto-resume` messages after the last reply without
 * error); then it gives up with a warning. `harness.autoResume` (NYCODE_AUTO_RESUME wins) switches it off. Fails open:
 * any exception releases the session.
 *
 * The pattern list is a copy of @nycode/ai's retry.js (isRetryableAssistantError) and overflow.js, kept inline.
 *
 * Account limit: the 429 "would exceed your account's rate limit" is not transient. `message_end` marks the error with
 * "quota exceeded" (a non-retryable pattern), so the 10 internal retries are not spent; the settle waits until the
 * reset (+1 min) and resumes by itself. The time comes from the 429 headers (`anthropic-ratelimit-unified-*reset`,
 * `retry-after`), else from the HUD cache (usage-cache.json, the same source as "resets in 41m"), else 15 min. At most
 * 3 waits in a row. Children (NYCODE_SUBAGENT) and sessions without UI (`-p`, `ctx.hasUI` false) fail fast (give_up,
 * warning on stderr); the main session with a UI waits.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { resolveNycodeSettings } from "../../core/settings-nycode.ts";
import { claudeConfigDir } from "../_shared/settings/config-dir.ts";

type Entry = Record<string, any>;
export type Decision =
	| { action: "none" }
	| { action: "resume"; attempt: number; delayMs: number; message: string; kind?: "limit" }
	| { action: "give_up"; message: string };

// ~20 min beyond the ~6 min of internal retries: covers a long network/provider outage; a failure is not billed.
export const DELAYS_MS = [30_000, 90_000, 180_000, 300_000, 600_000];
const MAX_ERR = 200;

const NON_RETRYABLE =
	/GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing|subscription_sharing_usage_limit_exceeded|subscription_sharing_workplace_individual_usage_limit_exceeded|"code"\s*:\s*"?1308(?![0-9])/i;
// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- fixed literal alternatives joined at load
const RETRYABLE = new RegExp(
	[
		"overloaded",
		"server_busy",
		"servers are currently busy",
		"currently experiencing high demand",
		"model is at capacity",
		"rate.?limit",
		"too many requests",
		"(?<![a-z0-9])(?:429|500|502|503|504|520|524)(?![a-z0-9])",
		"service.?(?:is.?)?(?:temporarily.?)?unavailable",
		"server.?error",
		"internal.?error",
		"provider.?returned.?(?:an.?)?error",
		"exceeded request buffer limit while retrying upstream",
		"unable to forward upstream",
		"upstream.?request.?failed",
		"upstream_stream_read_error",
		"stream was interrupted",
		"http/?2 stream failed",
		"network.?error",
		"connection.?error",
		"connection.?refused",
		"connection.?lost",
		"other side closed",
		"fetch failed",
		"request to \\S+ failed, reason:",
		"getaddrinfo",
		"ENOTFOUND",
		"EAI_AGAIN",
		"upstream.?connect",
		"reset before headers",
		"socket hang up",
		"socket connection was closed",
		"timed? out",
	].join("|"),
	"i",
);
const OVERFLOW =
	/prompt (?:is )?too long|prompt exceeds max length|request_too_large|input is too long for requested model|exceeds the context window|maximum context length|context window exceed|input token count.*exceeds the maximum|maximum prompt length is \d+|reduce the length of the messages|exceeds (?:the )?maximum allowed input length|is longer than the model'?s context length|exceeds the limit of \d+|exceeds the available context size|greater than the context length|exceeded model token limit|too large for model|model_context_window_exceeded|range of input length should be|context[_ ]length[_ ]exceeded|too many tokens|token limit exceeded|^(?:[\w -]+ API error \(413\):|413(?:\s|:|$))/i;

export function retryable(error: string): boolean {
	return !NON_RETRYABLE.test(error) && !OVERFLOW.test(error) && RETRYABLE.test(error);
}

const ACCOUNT_LIMIT = /exceed your account'?s rate limit|hit your (?:usage )?limit|usage limit (?:reached|exceeded)/i;
const LIMIT_MARK = "quota exceeded (account usage limit; auto-resume waits for the reset)";
export const LIMIT_WAITS = 3;
const LIMIT_MARGIN_MS = 60_000;
const LIMIT_UNKNOWN_MS = 15 * 60_000;
// The longest window is 7 days; a later reset is bogus and would overflow setTimeout (fires at once past ~24.8 days).
const LIMIT_MAX_AHEAD_MS = 8 * 86_400_000;

/** The account-limit error rewritten so the retry logic treats it as non-retryable; undefined for anything else. */
export function markLimit(error: string): string | undefined {
	return ACCOUNT_LIMIT.test(error) && !error.startsWith(LIMIT_MARK) ? `${LIMIT_MARK}: ${error}` : undefined;
}

const epochMs = (v: unknown): number | undefined => {
	if (typeof v === "number") return Number.isFinite(v) ? v * 1000 : undefined;
	if (typeof v !== "string" || !v.trim()) return undefined;
	const ms = /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) * 1000 : Date.parse(v);
	return Number.isFinite(ms) ? ms : undefined;
};

/** When the exhausted window resets (epoch ms): 429 headers first, then the HUD's usage cache; future times only. */
export function limitReset(headers: Record<string, string>, cache: any, now: number): number | undefined {
	const future = (xs: Array<number | undefined>) =>
		xs.filter((x): x is number => x !== undefined && x > now && x <= now + LIMIT_MAX_AHEAD_MS);
	const retryAfter = headers["retry-after"]?.trim() ?? "";
	const h = (k: string) => headers[`anthropic-ratelimit-unified-${k}`];
	const windows = ["5h", "7d", "7d_opus", "7d_sonnet"].map((w) => ({
		rejected: h(`${w}-status`) === "rejected",
		at: epochMs(h(`${w}-reset`)),
	}));
	const fromHeaders = [
		future([epochMs(h("reset"))])[0],
		Math.max(...future(windows.filter((w) => w.rejected).map((w) => w.at)), -Infinity),
		future([/^\d+$/.test(retryAfter) ? now + Number(retryAfter) * 1000 : Date.parse(retryAfter)])[0],
		Math.min(...future(windows.map((w) => w.at)), Infinity),
	].find((x) => x !== undefined && Number.isFinite(x));
	if (fromHeaders !== undefined) return fromHeaders;
	const wins = Object.values(cache?.rate_limits ?? {}) as Array<{ used_percentage?: number; resets_at?: number }>;
	const full = future(wins.filter((w) => (w?.used_percentage ?? 0) >= 95).map((w) => epochMs(w?.resets_at)));
	if (full.length > 0) return Math.max(...full);
	const any = future(wins.map((w) => epochMs(w?.resets_at)));
	return any.length > 0 ? Math.min(...any) : undefined;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function decideLimit(
	branch: Entry[],
	last: number,
	error: string,
	env: Record<string, string | undefined>,
	opts: { now: number; resetAt?: number; hasUI?: boolean },
): Decision {
	if (env.NYCODE_SUBAGENT) return { action: "none" };
	// No UI (-p): nobody can see or cancel a long wait (gate #28: 600 s lost to a headless 429); end now.
	if (opts.hasUI === false)
		return {
			action: "give_up",
			message: `Auto-resume: account usage limit reached in a session without a UI; not waiting for the reset ("${error.slice(0, MAX_ERR)}").`,
		};
	let prior = 0;
	for (let i = last; i >= 0; i--) {
		const e = branch[i];
		if (e.type === "message" && e.message?.role === "assistant" && e.message.stopReason !== "error") break;
		if (e.type === "custom_message" && e.customType === "auto-resume-limit") prior++;
	}
	if (prior >= LIMIT_WAITS)
		return {
			action: "give_up",
			message: `Auto-resume gave up after ${prior} waits for the account usage limit ("${error.slice(0, MAX_ERR)}").`,
		};
	const until = opts.resetAt === undefined ? opts.now + LIMIT_UNKNOWN_MS : opts.resetAt + LIMIT_MARGIN_MS;
	return {
		action: "resume",
		kind: "limit",
		attempt: prior + 1,
		delayMs: until - opts.now,
		message:
			`Auto-resume after the account usage limit (wait ${prior + 1}/${LIMIT_WAITS}, resumed at ${clock(until)}${opts.resetAt === undefined ? ", reset time unknown" : ""}). ` +
			"Continue exactly where you stopped; do not repeat completed tool calls or side effects — check current state first if unsure.",
	};
}

export function decideResume(
	branch: Entry[],
	env: Record<string, string | undefined> = process.env,
	opts: { now: number; resetAt?: number; hasUI?: boolean } = { now: Date.now() },
): Decision {
	let last = -1;
	for (let i = branch.length - 1; i >= 0; i--) {
		if (branch[i].type === "message" && branch[i].message?.role === "assistant") {
			last = i;
			break;
		}
	}
	if (last < 0) return { action: "none" };
	const msg = branch[last].message;
	const error = String(msg.errorMessage ?? "");
	if (msg.stopReason === "error" && error.startsWith(LIMIT_MARK)) return decideLimit(branch, last, error, env, opts);
	if (msg.stopReason !== "error" || !retryable(error)) return { action: "none" };

	let prior = 0;
	for (let i = last; i >= 0; i--) {
		const e = branch[i];
		if (e.type === "message" && e.message?.role === "assistant" && e.message.stopReason !== "error") break;
		if (e.type === "custom_message" && e.customType === "auto-resume") prior++;
	}
	if (prior >= DELAYS_MS.length) {
		return {
			action: "give_up",
			message: `Auto-resume gave up after ${prior} attempts; the provider is still failing ("${error.slice(0, MAX_ERR)}").`,
		};
	}
	const attempt = prior + 1;
	return {
		action: "resume",
		attempt,
		delayMs: DELAYS_MS[prior],
		message:
			`Auto-resume ${attempt}/${DELAYS_MS.length}: the previous request failed with a transient provider error ("${error.slice(0, MAX_ERR)}"). ` +
			"Continue exactly where you stopped; do not repeat completed tool calls or side effects — check current state first if unsure.",
	};
}

/** Waits `ms`; returns false if aborted first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
	if (signal?.aborted) return Promise.resolve(false);
	return new Promise((resolve) => {
		const done = (ok: boolean) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve(ok);
		};
		const onAbort = () => done(false);
		const timer = setTimeout(() => done(true), ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function hudCache(): unknown {
	try {
		return JSON.parse(
			readFileSync(join(claudeConfigDir(homedir()), "plugins", "claude-hud", "usage-cache.json"), "utf8"),
		);
	} catch {
		return undefined;
	}
}

export default function autoResumeExtension(
	nycode: ExtensionAPI,
	wait: typeof sleep = sleep,
	now: () => number = Date.now,
) {
	// Headers of the last 429: they carry the reset time; a later 200 does not clear them (the settle reads them),
	// a successful assistant reply does (the limit it described has passed).
	let limitHeaders: Record<string, string> = {};
	nycode.on("after_provider_response", (event: any) => {
		if (event?.status !== 429) return;
		limitHeaders = Object.fromEntries(
			Object.entries(event.headers ?? {})
				.filter(([, v]) => typeof v === "string")
				.map(([k, v]) => [k.toLowerCase(), v as string]),
		);
	});
	nycode.on("message_end", (event: any) => {
		const m = event?.message;
		// Headers only describe the account limit: drop them on a success or on any error that is not that limit.
		if (m?.role === "assistant" && (m.stopReason !== "error" || !ACCOUNT_LIMIT.test(String(m.errorMessage ?? ""))))
			limitHeaders = {};
		const marked =
			m?.role === "assistant" && m.stopReason === "error" ? markLimit(String(m.errorMessage ?? "")) : undefined;
		return marked ? { message: { ...m, errorMessage: marked } } : undefined;
	});
	nycode.on("agent_before_settle", async (event: any, ctx: any) => {
		try {
			if (!resolveNycodeSettings(nycode.getSettings(), process.env).harness.autoResume) return;
			const t = now();
			const d = decideResume(ctx.sessionManager.getBranch() as Entry[], process.env, {
				now: t,
				resetAt: limitReset(limitHeaders, hudCache(), t),
				hasUI: Boolean(ctx.hasUI),
			});
			if (d.action === "none") return;
			if (d.action === "give_up") {
				if (ctx.ui?.notify) ctx.ui.notify(d.message, "warning");
				else process.stderr.write(`${d.message}\n`);
				return;
			}
			if (d.kind === "limit") {
				limitHeaders = {}; // consumed by this wait, resumed or cancelled; a new 429 brings fresh ones
				const at = clock(t + d.delayMs);
				ctx.ui?.notify?.(
					`Account usage limit reached: no retries; the chat resumes by itself at ${at} (Esc cancels).`,
					"warning",
				);
				ctx.ui?.setStatus?.("auto-resume", `⏸ usage limit · resumes ${at}`);
			} else
				ctx.ui?.setStatus?.(
					"auto-resume",
					`auto-resume ${d.attempt}/${DELAYS_MS.length} in ${Math.round(d.delayMs / 1000)}s`,
				);
			let ok: boolean;
			try {
				ok = await wait(d.delayMs, ctx.signal);
			} finally {
				ctx.ui?.setStatus?.("auto-resume", undefined);
			}
			if (!ok) return;
			const entries = [
				...event.entries,
				{
					type: "custom_message",
					customType: d.kind === "limit" ? "auto-resume-limit" : "auto-resume",
					content: d.message,
					display: true,
				},
			];
			return { entries, continue: true };
		} catch {
			return; // fail open: never traps the session
		}
	});
}
