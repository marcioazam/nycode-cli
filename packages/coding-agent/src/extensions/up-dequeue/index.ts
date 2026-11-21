/**
 * Arrow up also restores queued messages (steering/follow-up) into the editor. Acts only with an empty editor and a
 * non-empty queue: then it rewrites Up as Alt+Up (app.message.dequeue). Otherwise Up behaves normally (cursor and
 * history). Alt+Up keeps working.
 */
import type { ExtensionAPI } from "../../core/extensions/types.ts";

const UP = new Set(["\x1b[A", "\x1bOA"]);
const ALT_UP = "\x1b[1;3A";

export function rewrite(data: string, editorEmpty: boolean, pending: boolean): string | undefined {
	return UP.has(data) && editorEmpty && pending ? ALT_UP : undefined;
}

export default function upDequeueExtension(nycode: ExtensionAPI): void {
	nycode.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.onTerminalInput((data) => {
			const out = rewrite(data, ctx.ui.getEditorText().trim() === "", ctx.hasPendingMessages());
			return out ? { data: out } : undefined;
		});
	});
}
