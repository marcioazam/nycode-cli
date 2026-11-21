// Ported from zzzzzzzz-statusline-provider/provider.test.ts (docs/hud-provider-usage.md). Drives the extension with a
// fake ExtensionAPI and a settings statusLine command that dumps the stdin payload to a file. HOME and the managed
// settings path are set before the factory runs; neither is read when the module loads.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../../../src/core/extensions/types.ts";
import { setManagedSettingsPath } from "../../../src/extensions/_shared/settings/managed-settings.ts";
import statusLine from "../../../src/extensions/status-line/index.ts";

interface ModelInfo {
	id: string;
	name: string;
	provider: string;
}
type Handler = (event: unknown, ctx: unknown) => void;
interface Payload {
	model: Record<string, unknown>;
	rate_limits?: { five_hour: { used_percentage: number } };
}

const ANTHROPIC: ModelInfo = { id: "claude-sonnet-5-5", name: "Sonnet 5.5", provider: "anthropic" };
const GPT: ModelInfo = { id: "gpt-5.6", name: "GPT 5.6", provider: "openai-codex" };

const tmp = mkdtempSync(join(tmpdir(), "nycode-statusline-provider-"));
const home = join(tmp, "home");
const cwd = join(tmp, "cwd");
const out = join(tmp, "payload.json");
const savedHome = process.env.HOME;
const handlers = new Map<string, Handler[]>();
let model: ModelInfo | undefined = ANTHROPIC;

const ctx = {
	cwd,
	get model() {
		return model;
	},
	thinkingLevel: "medium",
	ui: {
		theme: { fg: (_c: string, s: string) => s, bold: (s: string) => s },
		setStatus() {},
		setWidget() {},
		notify() {},
	},
	sessionManager: {
		getSessionId: () => "s1",
		getSessionFile: () => undefined,
		getSessionName: () => undefined,
		getBranch: () => [],
	},
	getContextUsage: () => undefined,
	isProjectTrusted: () => false,
};

const fire = (name: string, event: unknown = {}): void => {
	for (const handler of handlers.get(name) ?? []) handler(event, ctx);
};

beforeAll(() => {
	mkdirSync(cwd, { recursive: true });
	mkdirSync(join(home, ".claude"), { recursive: true });
	writeFileSync(
		join(home, ".claude", "settings.json"),
		JSON.stringify({ statusLine: { type: "command", command: `cat > '${out}'` } }),
	);
	process.env.HOME = home; // not vi.stubEnv: the vitest config unstubs envs before every test
	setManagedSettingsPath(join(tmp, "no-managed-settings.json"));
	const api = {
		on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		events: { on: () => () => {} },
		getSettings: () => ({}),
	};
	statusLine(api as unknown as ExtensionAPI); // the fake carries only what the extension calls
});

afterAll(() => {
	fire("session_shutdown");
	if (savedHome === undefined) delete process.env.HOME;
	else process.env.HOME = savedHome;
	setManagedSettingsPath(undefined);
	rmSync(tmp, { recursive: true, force: true });
});

/** Fires the trigger and waits for the command (300 ms debounce) to write the new payload. */
async function payloadAfter(trigger: () => void): Promise<Payload> {
	rmSync(out, { force: true });
	trigger();
	for (let i = 0; i < 100; i++) {
		await new Promise((resolve) => setTimeout(resolve, 50));
		if (existsSync(out)) {
			const text = readFileSync(out, "utf8");
			if (text.trim().endsWith("}")) return JSON.parse(text) as Payload;
		}
	}
	throw new Error("o status line não gravou o payload");
}

const headers = {
	"anthropic-ratelimit-unified-5h-utilization": "0.42",
	"anthropic-ratelimit-unified-5h-reset": new Date(Date.now() + 3_600_000).toISOString(),
};
const respond = (): void => {
	fire("after_provider_response", { status: 200, headers });
	fire("thinking_level_select"); // the response only schedules the refresh later (message_end); this event triggers it
};

describe("status-line provider payload", () => {
	it("payload.model leva id, display_name e provider", async () => {
		model = ANTHROPIC;
		const payload = await payloadAfter(() => fire("session_start"));
		expect(payload.model).toEqual({ id: "claude-sonnet-5-5", display_name: "Sonnet 5.5", provider: "anthropic" });
	});

	it("sem modelo ativo o payload não inventa provider", async () => {
		model = undefined;
		const payload = await payloadAfter(() => fire("model_select"));
		expect(payload.model).toEqual({ id: "", display_name: "" });
		model = ANTHROPIC;
	});

	it("model_select limpa o snapshot velho: Anthropic→GPT→Anthropic não ressuscita rate_limits", async () => {
		model = ANTHROPIC;
		const withLimits = await payloadAfter(respond);
		expect(withLimits.rate_limits?.five_hour.used_percentage).toBe(42);
		model = GPT;
		const gpt = await payloadAfter(() => fire("model_select"));
		expect(gpt.model.provider).toBe("openai-codex");
		expect("rate_limits" in gpt).toBe(false);
		model = ANTHROPIC;
		const back = await payloadAfter(() => fire("model_select"));
		expect(back.model.provider).toBe("anthropic");
		expect("rate_limits" in back).toBe(false); // the first pass's snapshot does not come back
		const fresh = await payloadAfter(respond);
		expect(fresh.rate_limits?.five_hour.used_percentage).toBe(42); // the next response restores it
	});

	it("preserva o footer bridge e o evento thinking_level_select", () => {
		expect(handlers.has("thinking_level_select")).toBe(true);
		expect(handlers.has("model_select")).toBe(true);
		const source = readFileSync(new URL("../../../src/extensions/status-line/index.ts", import.meta.url), "utf8");
		expect(source).toContain("FOOTER_BRIDGE_CHANNEL");
	});
});
