/**
 * Última mensagem do usuário fixa no topo do transcript (como no Claude Code), pedido do usuário 2026-11-12.
 * Só no modo fullscreen: quando o início do prompt mais recente acima da janela some ao rolar, uma linha flutuante
 * mostra o texto; clicar nela rola até o prompt. Lê o layout pela API pública do @nycode/tui (K10); fora do
 * fullscreen não há área de rolagem e a extensão fica sem efeito.
 * Reverter: apagar este diretório.
 */
import {
	getPrimaryScrollSnapshot,
	isSelectionPressActive,
	type OverlayOptions,
	type PrimaryScrollSnapshot,
	stripTerminalSequences,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@nycode/tui";
import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import { findSticky, type Sticky, stickyLine, stickyStyle, userMatcher } from "./sticky.ts";

function attach(tui: TUI, style: (s: string) => string, isUser: () => (zone: string) => boolean): () => void {
	const opts: OverlayOptions = { row: 0, col: 0, width: 1, nonCapturing: true };
	let current: Sticky | undefined;
	let snapshot: PrimaryScrollSnapshot | undefined;
	opts.visible = () => {
		current = undefined;
		if (isSelectionPressActive(tui)) return false; // some durante a seleção para o arraste rolar o transcript
		snapshot = getPrimaryScrollSnapshot(tui);
		if (!snapshot) return false;
		current = findSticky(snapshot.contentLines, snapshot.scrollTop, isUser(), stripTerminalSequences);
		opts.row = snapshot.rect.y;
		opts.col = snapshot.rect.x;
		opts.width = Math.max(1, snapshot.rect.width - 1); // deixa a coluna da barra de rolagem livre
		return current !== undefined;
	};
	const component = {
		render: (width: number) =>
			current ? [stickyLine(current.text, width, truncateToWidth, visibleWidth, style)] : [],
		invalidate: () => {},
		handleMouse: (e: { button: string; type: string }) => {
			if (e.button !== "left") return undefined;
			if (e.type === "click" && current && snapshot) {
				snapshot.scrollTo(current.row, { disableFollow: true });
				tui.requestRender();
			}
			return { handled: true };
		},
	};
	const handle = tui.showOverlay(component, opts);
	return () => handle.hide();
}

function userTexts(ctx: ExtensionContext): string[] {
	const out: string[] = [];
	for (const e of ctx.sessionManager.getBranch()) {
		const m = e.type === "message" ? e.message : undefined;
		if (m?.role !== "user") continue;
		out.push(
			typeof m.content === "string"
				? m.content
				: m.content
						.filter((c) => c.type === "text")
						.map((c) => c.text)
						.join(" "),
		);
	}
	return out;
}

export default function stickyPromptExtension(nycode: ExtensionAPI) {
	let matcher = userMatcher([]);
	const refresh = (_e: unknown, ctx: ExtensionContext) => {
		matcher = userMatcher(userTexts(ctx));
	};
	nycode.on("message_end", refresh);
	nycode.on("session_tree", refresh);
	nycode.on("session_start", (e, ctx) => {
		refresh(e, ctx);
		if (!ctx.hasUI) return;
		ctx.ui.setWidget("sticky-prompt", (tui, theme) => {
			const dispose = attach(tui, stickyStyle(theme), () => matcher);
			return { render: () => [], invalidate: () => {}, dispose };
		});
	});
}
