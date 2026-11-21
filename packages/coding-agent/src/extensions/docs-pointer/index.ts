/**
 * Docs pointer: `/docs-pointer on|off|auto` switches the system prompt's docs section for the session
 * (`on` = full section, `off` = one-line pointer, `auto` = full only for work on nycode itself).
 * The section itself is assembled in core/docs-pointer.ts.
 */

import { getDocsPointerMode, setDocsPointerMode, wantsFullDocs } from "../../core/docs-pointer.ts";
import type { ExtensionAPI } from "../../core/extensions/types.ts";

export default function docsPointerExtension(nycode: ExtensionAPI): void {
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
