/**
 * Docs pointer: replaces the system prompt's `docs` section (~1.3 KB) with a one-line pointer outside work on
 * nycode itself. `/docs-pointer on|off|auto` switches it for the session (`on` = full section). The core applies
 * `sections.docs` over its default section, so the prefix cache stays valid. Rules live in pointer.ts.
 */

import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { docsPointerLine, getDocsPointerMode, setDocsPointerMode, wantsFullDocs } from "./pointer.ts";

export default function docsPointerExtension(nycode: ExtensionAPI): void {
	let weSet = false; // only delete a section this extension put there

	nycode.on("before_agent_start", (event, ctx) => {
		const options = event.systemPromptOptions;
		if (options.customPrompt) return undefined;
		if (wantsFullDocs(getDocsPointerMode(), ctx.cwd)) {
			if (weSet) delete options.sections.docs;
			weSet = false;
			return undefined;
		}
		options.sections.docs = docsPointerLine();
		weSet = true;
		return undefined;
	});

	nycode.registerCommand("docs-pointer", {
		description: "Nycode docs in the system prompt: on (full) | off (compact) | auto",
		handler: async (args, ctx) => {
			const a = args.trim();
			if (a === "on" || a === "off" || a === "auto") setDocsPointerMode(a);
			else if (a) return ctx.ui.notify("Usage: /docs-pointer on|off|auto", "warning");
			const mode = getDocsPointerMode();
			const full = wantsFullDocs(mode, ctx.cwd);
			ctx.ui.notify(`docs-pointer: ${mode} (${full ? "full docs section" : "compact pointer"})`, "info");
		},
	});
}
