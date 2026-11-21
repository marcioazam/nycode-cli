/** Controle visual do nycode: indicador de trabalho, cabeçalho e renderizadores de ferramentas. */

import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { resolveNycodeSettings } from "../../core/settings-nycode.ts";
import header from "./header.ts";
import { setIconPrefs } from "./icons.ts";
import tools from "./tools.ts";
import working from "./working.ts";

export default function (nycode: ExtensionAPI) {
	// Antes das partes: os ícones do cabeçalho e do indicador saem dessas preferências.
	nycode.on("session_start", () => {
		const { nerdFont, asciiIcons } = resolveNycodeSettings(nycode.getSettings(), process.env).terminal;
		setIconPrefs({ nerdFont, asciiIcons });
	});
	for (const part of [working, header, tools]) part(nycode);
}
