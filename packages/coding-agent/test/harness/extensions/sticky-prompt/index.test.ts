// Behavior of the sticky-prompt extension: widget wiring, floating line visibility and click-to-scroll.
// The two scroll hooks of the public @nycode/tui API (K10) are replaced by typed fakes: the real ones only answer
// for a fullscreen TUI instance.
import type * as Tui from "@nycode/tui";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "../../../../src/core/extensions/types.ts";
import stickyPromptExtension from "../../../../src/extensions/sticky-prompt/index.ts";

const hooks = vi.hoisted(() => ({
	snapshot: vi.fn(),
	selecting: vi.fn(),
}));

vi.mock("@nycode/tui", async (importOriginal) => ({
	...(await importOriginal<typeof Tui>()),
	getPrimaryScrollSnapshot: hooks.snapshot,
	isSelectionPressActive: hooks.selecting,
}));

const A = "\x1b]133;A\x07";
const BC = "\x1b]133;B\x07\x1b]133;C\x07";
const content = [`${A}pedido antigo`, `${BC}`, "resposta", "mais", "fim"];

type Handler = (event: unknown, ctx: ExtensionContext) => void;
type Component = {
	render(width: number): string[];
	handleMouse(e: { button: string; type: string }): { handled: boolean } | undefined;
};
type Overlay = { row: number; col: number; width: number; visible?: () => boolean };

function setup(opts: { hasUI?: boolean; users?: string[] } = {}) {
	const handlers = new Map<string, Handler>();
	extension(handlers);
	const hide = vi.fn();
	const overlay: { component?: Component; options?: Overlay } = {};
	const requestRender = vi.fn();
	const tui = {
		requestRender,
		showOverlay: (component: Component, options: Overlay) => {
			overlay.component = component;
			overlay.options = options;
			return { hide };
		},
	};
	let widget: ((tui: unknown, theme: unknown) => { dispose(): void }) | undefined;
	const ctx = {
		hasUI: opts.hasUI ?? true,
		ui: {
			setWidget: (_key: string, factory: typeof widget) => {
				widget = factory;
			},
		},
		sessionManager: {
			getBranch: () => [
				...(opts.users ?? ["pedido antigo"]).map((text) => ({
					type: "message",
					message: { role: "user", content: text },
				})),
				{ type: "message", message: { role: "assistant", content: "resposta" } },
				{ type: "label" },
			],
		},
	} as unknown as ExtensionContext;
	const theme = { getFgAnsi: () => "", getBgAnsi: () => "" };
	return { handlers, ctx, overlay, hide, requestRender, mount: () => widget?.(tui, theme), getWidget: () => widget };
}

function extension(handlers: Map<string, Handler>) {
	stickyPromptExtension({ on: (name: string, fn: Handler) => handlers.set(name, fn) } as unknown as ExtensionAPI);
}

describe("sticky-prompt extension", () => {
	it("mounts the widget on session_start and hides the overlay on dispose", () => {
		const s = setup();
		s.handlers.get("session_start")?.({}, s.ctx);
		const widget = s.mount();
		expect(widget).toBeDefined();
		expect(s.overlay.component).toBeDefined();
		widget?.dispose();
		expect(s.hide).toHaveBeenCalledTimes(1);
	});

	it("mounts nothing without a UI", () => {
		const s = setup({ hasUI: false });
		s.handlers.get("session_start")?.({}, s.ctx);
		expect(s.getWidget()).toBeUndefined();
	});

	it("shows the latest user prompt scrolled above the window, at the scroll area rect", () => {
		const s = setup();
		s.handlers.get("session_start")?.({}, s.ctx);
		s.mount();
		hooks.selecting.mockReturnValue(false);
		hooks.snapshot.mockReturnValue({
			scrollTop: 4,
			contentLines: content,
			rect: { x: 2, y: 3, width: 40, height: 10 },
			scrollTo: vi.fn(),
		});
		const o = s.overlay.options as Overlay;
		expect(o.visible?.()).toBe(true);
		expect([o.row, o.col, o.width]).toEqual([3, 2, 39]);
		expect(s.overlay.component?.render(30)[0]).toContain("pedido antigo");
	});

	it("is hidden while a selection press is active, outside fullscreen and with no prompt above", () => {
		const s = setup();
		s.handlers.get("session_start")?.({}, s.ctx);
		s.mount();
		const o = s.overlay.options as Overlay;
		hooks.selecting.mockReturnValue(true);
		expect(o.visible?.()).toBe(false);
		hooks.selecting.mockReturnValue(false);
		hooks.snapshot.mockReturnValue(undefined);
		expect(o.visible?.()).toBe(false);
		hooks.snapshot.mockReturnValue({
			scrollTop: 0,
			contentLines: content,
			rect: { x: 0, y: 0, width: 1, height: 5 },
			scrollTo: vi.fn(),
		});
		expect(o.visible?.()).toBe(false);
		expect(o.width).toBe(1); // never below one column
		expect(s.overlay.component?.render(30)).toEqual([]);
	});

	it("ignores prompts that are not from the user (assistant text)", () => {
		const s = setup({ users: [] });
		s.handlers.get("session_start")?.({}, s.ctx);
		s.mount();
		hooks.selecting.mockReturnValue(false);
		hooks.snapshot.mockReturnValue({
			scrollTop: 4,
			contentLines: content,
			rect: { x: 0, y: 0, width: 40, height: 5 },
			scrollTo: vi.fn(),
		});
		expect((s.overlay.options as Overlay).visible?.()).toBe(false);
	});

	it("left click scrolls to the prompt without following; other buttons are not handled", () => {
		const s = setup();
		s.handlers.get("session_start")?.({}, s.ctx);
		s.mount();
		const scrollTo = vi.fn();
		hooks.selecting.mockReturnValue(false);
		hooks.snapshot.mockReturnValue({
			scrollTop: 4,
			contentLines: content,
			rect: { x: 0, y: 0, width: 40, height: 5 },
			scrollTo,
		});
		(s.overlay.options as Overlay).visible?.();
		const c = s.overlay.component as Component;
		expect(c.handleMouse({ button: "right", type: "click" })).toBeUndefined();
		expect(scrollTo).not.toHaveBeenCalled();
		expect(c.handleMouse({ button: "left", type: "move" })).toEqual({ handled: true });
		expect(scrollTo).not.toHaveBeenCalled();
		expect(c.handleMouse({ button: "left", type: "click" })).toEqual({ handled: true });
		expect(scrollTo).toHaveBeenCalledWith(0, { disableFollow: true });
		expect(s.requestRender).toHaveBeenCalledTimes(1);
	});

	it("refreshes the matcher on message_end and session_tree with array content", () => {
		const s = setup({ users: [] });
		s.handlers.get("session_start")?.({}, s.ctx);
		s.mount();
		const withParts = {
			...s.ctx,
			sessionManager: {
				getBranch: () => [
					{
						type: "message",
						message: {
							role: "user",
							content: [{ type: "text", text: "pedido" }, { type: "text", text: "antigo" }, { type: "image" }],
						},
					},
				],
			},
		} as unknown as ExtensionContext;
		hooks.selecting.mockReturnValue(false);
		hooks.snapshot.mockReturnValue({
			scrollTop: 4,
			contentLines: content,
			rect: { x: 0, y: 0, width: 40, height: 5 },
			scrollTo: vi.fn(),
		});
		const o = s.overlay.options as Overlay;
		expect(o.visible?.()).toBe(false);
		s.handlers.get("message_end")?.({}, withParts);
		expect(o.visible?.()).toBe(true);
		s.handlers.get("session_tree")?.({}, s.ctx);
		expect(o.visible?.()).toBe(false);
	});
});
