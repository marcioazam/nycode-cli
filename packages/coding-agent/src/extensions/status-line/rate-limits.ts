interface RateLimitWindow {
	used_percentage: number;
	/** Unix epoch seconds when the window resets, per Claude's documented field. */
	resets_at?: number;
}
export interface RateLimitSnapshot {
	five_hour?: RateLimitWindow;
	seven_day?: RateLimitWindow;
}

/** Lowercase every header name (HTTP names are case-insensitive) and drop null
 * values, so a single lookup shape works regardless of how the provider cased
 * them. ProviderHeaders values are string | null. */
export function normalizeHeaders(raw: Record<string, string | null> | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw ?? {})) {
		if (typeof value === "string") out[key.toLowerCase()] = value;
	}
	return out;
}

function toNumber(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === "") return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** One rate-limit window from the `anthropic-ratelimit-<prefix>-*` header family,
 * taking `-utilization` when present, else computing the percentage from `-limit` and
 * `-remaining`. `-utilization` is a 0 to 1 fraction, while Claude documents
 * used_percentage as "from 0 to 100": it is scaled and rounded to one decimal, as
 * Claude Code does (Math.round(utilization * 1000) / 10). resets_at comes from `-reset`
 * when the header is set. Header names vary, so only what is present is read. */
function readRateLimitWindow(headers: Record<string, string>, prefix: string): RateLimitWindow | undefined {
	const base = `anthropic-ratelimit-${prefix}`;
	const utilization = toNumber(headers[`${base}-utilization`]);
	let usedPercentage = utilization === undefined ? undefined : Math.round(utilization * 1000) / 10;
	if (usedPercentage === undefined) {
		const limit = toNumber(headers[`${base}-limit`]);
		const remaining = toNumber(headers[`${base}-remaining`]);
		if (limit !== undefined && limit > 0 && remaining !== undefined) {
			usedPercentage = ((limit - remaining) / limit) * 100;
		}
	}
	if (usedPercentage === undefined) return undefined;
	// A provider can report a utilization above 100 (or a remaining above the limit, making
	// the computed value negative); clamp so the payload never carries a nonsense percentage.
	const window: RateLimitWindow = { used_percentage: Math.max(0, Math.min(100, usedPercentage)) };
	const resetsAt = headers[`${base}-reset`] ?? headers[`${base}-resets-at`];
	if (resetsAt) {
		// Claude documents resets_at as Unix epoch seconds; the header carries an ISO
		// timestamp (or, from some providers, a bare epoch number already).
		const epoch = /^\d+$/.test(resetsAt.trim()) ? Number(resetsAt.trim()) : Math.floor(Date.parse(resetsAt) / 1000);
		if (Number.isFinite(epoch)) window.resets_at = epoch;
	}
	return window;
}

/** The snapshot with expired windows dropped, so a window whose reset time has
 * passed never lingers in the payload; undefined when nothing remains. */
export function liveRateLimits(snapshot: RateLimitSnapshot): RateLimitSnapshot | undefined {
	const nowSeconds = Date.now() / 1000;
	const keep = (window?: RateLimitWindow): RateLimitWindow | undefined =>
		window && (window.resets_at === undefined || window.resets_at > nowSeconds) ? window : undefined;
	const fiveHour = keep(snapshot.five_hour);
	const sevenDay = keep(snapshot.seven_day);
	if (!fiveHour && !sevenDay) return undefined;
	return { ...(fiveHour ? { five_hour: fiveHour } : {}), ...(sevenDay ? { seven_day: sevenDay } : {}) };
}

/** The five-hour and seven-day utilization windows Claude's statusline reports,
 * from the unified rate-limit response headers. Undefined when neither is present
 * so a response without them never clobbers an earlier snapshot. */
export function parseRateLimits(headers: Record<string, string>): RateLimitSnapshot | undefined {
	const fiveHour = readRateLimitWindow(headers, "unified-5h");
	const sevenDay = readRateLimitWindow(headers, "unified-7d");
	if (!fiveHour && !sevenDay) return undefined;
	const snapshot: RateLimitSnapshot = {};
	if (fiveHour) snapshot.five_hour = fiveHour;
	if (sevenDay) snapshot.seven_day = sevenDay;
	return snapshot;
}
