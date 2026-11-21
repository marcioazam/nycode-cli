// Footer extension: renders only the extension statuses (sorted, joined by " · ", sanitized, truncated to the width),
// hiding HIDDEN keys and the keys the HUD absorbed through the bridge. Driven with a fake ExtensionAPI.
import { visibleWidth } from "@nycode/tui";
import { describe, expect, it } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "../../../../src/core/extensions/types.ts";
import footerExtension from "../../../../src/extensions/footer/index.ts";

interface Bridge {
	absorbed: Set<string>;
	folded: boolean;
}

type Handler = (event: unknown, ctx: ExtensionContext) => void;
type Built = { render(width: number): string[] };

/** Mounts the footer with the given statuses; `onBridge` runs when the footer publishes on the bridge channel. */
function mount(statuses: Map<string, string>, onBridge?: (bridge: Bridge) => void) {
	let handler: Handler | undefined;
	let built: Built | undefined;
	let channel: string | undefined;
	let published: Bridge | undefined;
	const api = {
		on: (_name: string, fn: Handler) => {
			handler = fn;
		},
		events: {
			emit: (name: string, bridge: Bridge) => {
				channel = name;
				published = bridge;
				onBridge?.(bridge);
			},
		},
	};
	footerExtension(api as unknown as ExtensionAPI);
	const theme = { fg: (_color: string, text: string) => text };
	const footerData = { getExtensionStatuses: () => statuses };
	const ui = {
		setFooter: (factory: (tui: unknown, theme: unknown, data: unknown) => Built) => {
			built = factory(undefined, theme, footerData);
		},
	};
	handler?.({}, { ui } as unknown as ExtensionContext);
	return { footer: built as Built, channel, bridge: published as Bridge };
}

describe("footer extension", () => {
	it("publishes the provider on the footer bridge channel", () => {
		const { channel, bridge } = mount(new Map());
		expect(channel).toBe("pi-code:footer-bridge");
		expect(bridge.absorbed.size).toBe(0);
		expect(bridge.folded).toBe(false);
	});

	it("renders the statuses sorted by key, joined by a dim separator, whitespace collapsed", () => {
		const statuses = new Map([
			["zeta", "last"],
			["alpha", "  first\tone\n"],
			["empty", ""],
		]);
		const { footer } = mount(statuses);
		expect(footer.render(80)).toEqual(["first one · last"]);
	});

	it("hides pi-code-status, ponytail and the keys the HUD absorbed", () => {
		const statuses = new Map([
			["pi-code-status", "turn 3 $0.10"],
			["ponytail", "PONYTAIL"],
			["plan-mode", "📋 3/8"],
			["bypass", "BYPASS"],
		]);
		const { footer, bridge } = mount(statuses, (b) => b.absorbed.add("plan-mode"));
		expect(footer.render(80)).toEqual(["BYPASS"]);
		expect(bridge.absorbed.has("plan-mode")).toBe(true);
	});

	it("renders nothing when no status is visible", () => {
		const { footer } = mount(new Map([["ponytail", "PONYTAIL"]]));
		expect(footer.render(80)).toEqual([]);
	});

	it("truncates to the width", () => {
		const { footer } = mount(new Map([["a", "x".repeat(40)]]));
		const lines = footer.render(10);
		expect(lines).toHaveLength(1);
		expect(visibleWidth(lines[0] ?? "")).toBeLessThanOrEqual(10);
	});
});
