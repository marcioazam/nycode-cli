/**
 * 1-hour cache only on the prefix (tools + system) of the main interactive session; messages stay at 5 min.
 *
 * A 5 to 60 min pause expires the 5 min cache and the next call rewrites everything at 1.25x. With the prefix at 1h,
 * the fixed part (~48K tokens) is read at 0.05x and only the conversation is rewritten. 1h costs 2x on write, so it
 * stays out of `-p` runs and subagents, whose prefix is rarely reused after 5 min. The API requires 1h entries before
 * 5 min ones; tools and system come before the messages. Thread continuations do not resend system/tools.
 *
 * `harness.prefixCache1h` (NYCODE_PREFIX_CACHE_1H wins): `auto` (default) is on in interactive sessions only, `true`
 * forces it elsewhere, `false` turns it off. Never inside a subagent (NYCODE_SUBAGENT=1).
 */

import type { ExtensionAPI } from "../../core/extensions/types.ts";
import type { Env } from "../../core/settings-nycode.ts";
import { resolveNycodeSettings } from "../../core/settings-nycode.ts";

type Block = { cache_control?: { type?: string; ttl?: string } };

/** Whether the prefix gets the 1h ttl for this session: the key says on/off/auto, subagents never. */
export function enabled(hasUI: boolean, setting: boolean | "auto", env: Env): boolean {
	if (setting === false || env.NYCODE_SUBAGENT === "1") return false;
	return setting === true || hasUI;
}

/** Sets ttl 1h on the ephemeral markers without ttl in tools and system; returns the payload only if it changed. */
export function prefixTtl1h(payload: unknown): unknown {
	if (!payload || typeof payload !== "object") return undefined;
	const p = payload as { tools?: unknown; system?: unknown };
	let changed = false;
	for (const list of [p.tools, p.system]) {
		if (!Array.isArray(list)) continue;
		for (const b of list as Block[]) {
			if (b?.cache_control?.type === "ephemeral" && !b.cache_control.ttl) {
				b.cache_control = { ...b.cache_control, ttl: "1h" };
				changed = true;
			}
		}
	}
	return changed ? payload : undefined;
}

export default function prefixCache1hExtension(nycode: ExtensionAPI): void {
	nycode.on("before_provider_request", (event, ctx) => {
		const { prefixCache1h } = resolveNycodeSettings(nycode.getSettings(), process.env).harness;
		return enabled(ctx.hasUI, prefixCache1h, process.env) ? prefixTtl1h(event.payload) : undefined;
	});
}
