/** UI do nycode: editor (nome, ?, vim), acessibilidade, título/foco, /diff e /btw. Painel de subagentes: fleet-ui do subagent. */

import type { ExtensionAPI } from "../../core/extensions/types.ts";
import a11y from "./a11y.ts";
import btw from "./btw.ts";
import diff from "./diff.ts";
import editor from "./editor.ts";
import terminal from "./terminal.ts";

export default function (nycode: ExtensionAPI) {
	for (const part of [editor, a11y, terminal, diff, btw]) part(nycode);
}
