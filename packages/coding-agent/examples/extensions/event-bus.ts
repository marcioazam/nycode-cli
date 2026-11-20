/**
 * Inter-extension event bus example.
 *
 * Shows nycode.events for communication between extensions. One extension
 * can emit events that other extensions listen to.
 *
 * Usage: /emit [event-name] [data] - emit an event on the bus
 */

import type { ExtensionAPI, ExtensionContext } from "@nycode/coding-agent";

export default function (nycode: ExtensionAPI) {
	// Store ctx for use in event handler
	let currentCtx: ExtensionContext | undefined;

	nycode.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
	});

	// Listen for events from other extensions
	nycode.events.on("my:notification", (data) => {
		const { message, from } = data as { message: string; from: string };
		currentCtx?.ui.notify(`Event from ${from}: ${message}`, "info");
	});

	// Command to emit events (emits "my:notification" which the listener above receives)
	nycode.registerCommand("emit", {
		description: "Emit my:notification event (usage: /emit message)",
		handler: async (args, _ctx) => {
			const message = args.trim() || "hello";
			nycode.events.emit("my:notification", { message, from: "/emit command" });
			// Listener above will show the notification
		},
	});

	// Example: emit on session start
	nycode.on("session_start", async () => {
		nycode.events.emit("my:notification", {
			message: "Session started",
			from: "event-bus-example",
		});
	});
}
