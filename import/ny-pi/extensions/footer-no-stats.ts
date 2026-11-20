/**
 * Footer só com os status das extensões, pedidos do usuário 2026-11-12: sem a linha de estatísticas
 * (↑↓ R W CH $ contexto modelo) e sem a linha "pasta (branch) • nome da sessão" (o nome já aparece na
 * borda do editor, extensions/rename.ts). Também esconde os status de HIDDEN: "turn N $x" do pi-code
 * e o indicador do ponytail. O HUD do status-line é um widget à parte e não é afetado.
 * Ponte (pedido 2026-11-13): publica o provedor de status em FOOTER_BRIDGE_CHANNEL; o HUD (status-line do
 * pi-code) mostra na linha de tools as chaves que marca em `absorbed` (o 📋 do plano) e o footer as omite.
 * Os status são separados por " · " em dim.
 * Espelha dist/modes/interactive/components/footer.js do pi 1.5.2; custo e contexto seguem em /session e no HUD.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const HIDDEN = new Set(["pi-code-status", "ponytail"]);
/** Mesmo nome de FOOTER_BRIDGE_CHANNEL em pi-code/extensions/status-line.ts (sem import entre pacotes). */
const FOOTER_BRIDGE_CHANNEL = "pi-code:footer-bridge";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setFooter((_tui, theme, footerData) => {
			const absorbed = new Set<string>();
			pi.events.emit(FOOTER_BRIDGE_CHANNEL, { footerData, absorbed });
			return {
				dispose() {},
				invalidate() {},
				render(width: number): string[] {
					const lines: string[] = [];
					const statuses = [...footerData.getExtensionStatuses().entries()].filter(([k, t]) => !HIDDEN.has(k) && !absorbed.has(k) && t);
					if (statuses.length > 0) {
						const text = statuses
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, t]) => t.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim())
							.join(theme.fg("dim", " · "));
						lines.push(truncateToWidth(text, width, theme.fg("dim", "...")));
					}
					return lines;
				},
			};
		});
	});
}
