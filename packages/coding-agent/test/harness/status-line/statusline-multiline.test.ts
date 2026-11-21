// Ported from statusline-multiline.test.ts (statusline-multiline.patch).
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@nycode/tui";
import { describe, expect, it } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "../../../src/core/extensions/types.ts";
import footerExtension from "../../../src/extensions/footer/index.ts";
import { hudFooterBridge, renderStatusRows, statusRows } from "../../../src/extensions/status-line/rows.ts";

const ESC = String.fromCharCode(27);

describe("statusRows", () => {
	it("1 linha vai ao footer, com padding", () => {
		expect(statusRows("  a b \n", 2)).toEqual({ footer: "  a b  ", rows: [] });
	});

	it("3 linhas viram rows do widget, sem footer, vazias descartadas", () => {
		expect(statusRows("one\n\n two \nthree\n", 0)).toEqual({ footer: undefined, rows: ["one", "two", "three"] });
	});

	it("saída vazia limpa tudo", () => {
		expect(statusRows("\n  \n", 1)).toEqual({ footer: undefined, rows: [] });
	});

	it("padding à esquerda nas rows do widget", () => {
		expect(statusRows("a\nb", 2).rows).toEqual(["  a", "  b"]);
	});
});

describe("renderStatusRows", () => {
	it("trunca por largura visível, ciente de ANSI", () => {
		const out = renderStatusRows([`${ESC}[31mabcdefghij${ESC}[0m`, "ok"], 6);
		expect(out).toHaveLength(2);
		expect(out[0]).toContain(`${ESC}[31m`);
		expect(visibleWidth(out[0] ?? "")).toBeLessThanOrEqual(6);
		expect(out[1]).toBe("ok");
	});

	it("status de extensão absorvido vai ao fim da última row (a de tools), separado como o HUD", () => {
		const out = renderStatusRows(["model", "✓ Bash ×12 | ✓ Read ×2"], 80, [`${ESC}[36m📋 0/8${ESC}[0m`]);
		expect(out[0]).toBe("model");
		expect(stripVTControlCharacters(out[1] ?? "")).toBe("✓ Bash ×12 | ✓ Read ×2 | 📋 0/8");
		expect(renderStatusRows(["a", "b"], 80, [])).toEqual(["a", "b"]);
		expect(renderStatusRows([], 80, ["📋 1/2"])).toEqual([]);
		expect(renderStatusRows(["a", "b"], 80, ["", undefined])).toEqual(["a", "b"]);
		expect(visibleWidth(renderStatusRows(["x".repeat(20)], 22, ["📋 1/2"])[0] ?? "")).toBeLessThanOrEqual(22);
	});
});

describe("hudFooterBridge", () => {
	it("a extensão de footer publica o provedor; o HUD lê o status vivo e marca a chave como absorvida", () => {
		const statuses = new Map([
			["plan-mode", "📋 3/8"],
			["bypass", "BYPASS"],
		]);
		const bridge = { footerData: { getExtensionStatuses: () => statuses }, absorbed: new Set<string>() };
		const hud = hudFooterBridge();
		hud.attach(bridge);
		expect(hud.trailers()).toEqual(["📋 3/8"]);
		hud.claim(true);
		expect([...bridge.absorbed]).toEqual(["plan-mode"]);
		statuses.set("plan-mode", "📋 4/8");
		expect(hud.trailers()).toEqual(["📋 4/8"]); // lido na hora do render, sem cópia
		hud.claim(false);
		expect(bridge.absorbed.size).toBe(0); // sem widget o footer volta a mostrar o status
		expect(hudFooterBridge().trailers()).toEqual([]); // sem footer publicado não há trailer
		const bad = hudFooterBridge();
		bad.attach({});
		bad.attach(null);
		expect(bad.trailers()).toEqual([]); // payload inválido é ignorado
		bad.claim(true);
		const late = { footerData: { getExtensionStatuses: () => statuses }, absorbed: new Set<string>() };
		hud.claim(true);
		hud.attach(late);
		expect([...late.absorbed]).toEqual(["plan-mode"]); // footer recriado depois do widget herda a marca
	});

	it("Status Line recolhida faz o footer esconder todos os status; soltar o widget desfaz", () => {
		const bridge: {
			footerData: { getExtensionStatuses: () => Map<string, string> };
			absorbed: Set<string>;
			folded?: boolean;
		} = {
			footerData: { getExtensionStatuses: () => new Map([["bypass-permissions", "BYPASS"]]) },
			absorbed: new Set<string>(),
		};
		const hud = hudFooterBridge();
		hud.attach(bridge);
		hud.claim(true);
		hud.fold(true);
		expect(bridge.folded).toBe(true);
		hud.fold(false);
		expect(bridge.folded).toBe(false);
		hud.fold(true);
		hud.claim(false);
		expect(bridge.folded).toBe(false); // sem widget o footer volta a mostrar tudo
		hudFooterBridge().fold(true); // sem footer publicado: sem efeito, sem erro
	});
});

describe("footer", () => {
	it("os status ficam alinhados à esquerda (sem preenchimento à frente), um fold os esconde", () => {
		let handler: ((event: unknown, ctx: ExtensionContext) => void) | undefined;
		let built: { render(width: number): string[] } | undefined;
		let bridge: { folded: boolean } | undefined;
		const api = {
			on: (_name: string, fn: typeof handler) => {
				handler = fn;
			},
			events: {
				emit: (_channel: string, b: { folded: boolean }) => {
					bridge = b;
				},
			},
		};
		footerExtension(api as unknown as ExtensionAPI);
		const theme = { fg: (_color: string, text: string) => text };
		const data = { getExtensionStatuses: () => new Map([["bypass-permissions", "▲ BYPASS PERMISSIONS ON"]]) };
		const ui = {
			setFooter: (factory: (tui: unknown, theme: unknown, data: unknown) => typeof built) => {
				built = factory(undefined, theme, data);
			},
		};
		handler?.({}, { ui } as unknown as ExtensionContext);
		expect(built?.render(80)).toEqual(["▲ BYPASS PERMISSIONS ON"]);
		if (bridge) bridge.folded = true;
		expect(built?.render(80)).toEqual([]);
	});
});
