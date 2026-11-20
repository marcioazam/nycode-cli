/**
 * Raw provider event viewer.
 *
 * Usage: /debug-provider [on|off]
 * With no argument, the command toggles capture. Captured events are persisted
 * as expandable custom entries.
 */

import type { ExtensionAPI } from "@nycode/coding-agent";
import { Box, Text } from "@nycode/tui";

const ENTRY_TYPE = "debug-provider-events";
const STATUS_KEY = "debug-provider";

interface ProviderDebugEntry {
	provider: string;
	api: string;
	model: string;
	events: unknown[];
}

export default function (nycode: ExtensionAPI) {
	let enabled = false;
	let activeEvents: unknown[] | undefined;
	let completedEntry: ProviderDebugEntry | undefined;

	nycode.registerEntryRenderer<ProviderDebugEntry>(ENTRY_TYPE, (entry, { expanded, keyHint }, theme) => {
		const data = entry.data;
		if (!data) return new Text(theme.fg("warning", "[provider debug] Missing event data"), 0, 0);

		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		const count = `${data.events.length} event${data.events.length === 1 ? "" : "s"}`;
		const expandHint = expanded ? "" : ` (${keyHint("app.tools.expand", "to view events")})`;
		box.addChild(
			new Text(
				`${theme.fg("accent", "[provider debug]")} ${data.provider}/${data.model} (${data.api}) · ${count}${expandHint}`,
				0,
				0,
			),
		);
		if (expanded) {
			box.addChild(new Text(JSON.stringify(data.events, null, 2), 0, 0));
		}
		return box;
	});

	nycode.registerCommand("debug-provider", {
		description: "Toggle capture of raw provider stream events",
		handler: async (args, ctx) => {
			const requestedState = args.trim().toLowerCase();
			if (requestedState !== "" && requestedState !== "on" && requestedState !== "off") {
				ctx.ui.notify("Usage: /debug-provider [on|off]", "warning");
				return;
			}

			enabled = requestedState === "" ? !enabled : requestedState === "on";
			if (!enabled) {
				activeEvents = undefined;
				completedEntry = undefined;
			}
			ctx.ui.setStatus(STATUS_KEY, enabled ? "provider debug" : undefined);
			ctx.ui.notify(`Provider event capture ${enabled ? "enabled" : "disabled"}`, "info");
		},
	});

	nycode.on("turn_start", () => {
		activeEvents = enabled ? [] : undefined;
	});

	nycode.on("provider_stream_event", (event) => {
		activeEvents?.push(structuredClone(event.data));
	});

	nycode.on("message_end", (event) => {
		if (event.message.role !== "assistant" || !activeEvents) return;
		completedEntry = {
			provider: event.message.provider,
			api: event.message.api,
			model: event.message.model,
			events: activeEvents,
		};
		activeEvents = undefined;
	});

	nycode.on("turn_end", () => {
		if (!completedEntry) return;
		nycode.appendEntry<ProviderDebugEntry>(ENTRY_TYPE, completedEntry);
		completedEntry = undefined;
	});
}
