/** Comandos de desenvolvimento: /copy-code [N] e /keybindings. */

import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { copyCode } from "./copy-code.ts";
import { editKeybindings } from "./keybindings.ts";

export default function devCommandsExtension(nycode: ExtensionAPI) {
	nycode.registerCommand("copy-code", {
		description: "Copia um bloco de código da última resposta: /copy-code [N]",
		handler: async (args, ctx) => copyCode(args ?? "", ctx),
	});
	nycode.registerCommand("keybindings", {
		description: "Edita, valida e recarrega keybindings.json",
		handler: async (_args, ctx) => editKeybindings(ctx),
	});
}
