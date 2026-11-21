// Converted from no-context-files.test.ts (the removed no-context-files-covers-claude-md extension, D-10). That extension
// armed CLAUDE_CODE_DISABLE_CLAUDE_MDS so pi-code's own CLAUDE.md/rules injection stayed out of the context. The embedded
// claude-rules honors that switch where a rule would be delivered; these cases prove it against the built-in, and that
// without the switch a rule reaches the prompt once, never duplicated. Not ported: omitClaudeMd frontmatter and the
// child's `--system-prompt` name lookup (core's child.ts passes --no-context-files for the Explore/Plan built-ins only).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "../../../../src/core/extensions/types.ts";
import claudeRulesExtension from "../../../../src/extensions/claude-rules/index.ts";

const DISABLE = "CLAUDE_CODE_DISABLE_CLAUDE_MDS";
const RULE_BODY = "Always answer in short sentences.";

interface PromptEvent {
	systemPrompt: string;
	systemPromptOptions: { contextFiles: Array<{ path: string; content: string }> };
}

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

let home: string;
let savedHome: string | undefined;
let savedDisable: string | undefined;

beforeEach(() => {
	savedHome = process.env.HOME;
	savedDisable = process.env[DISABLE];
	home = mkdtempSync(join(tmpdir(), "ctxfiles-"));
	mkdirSync(join(home, ".claude", "rules"), { recursive: true });
	writeFileSync(join(home, ".claude", "rules", "style.md"), `${RULE_BODY}\n`);
	process.env.HOME = home; // read when the factory runs, not at import
	delete process.env[DISABLE];
});

afterEach(() => {
	if (savedHome === undefined) delete process.env.HOME;
	else process.env.HOME = savedHome;
	if (savedDisable === undefined) delete process.env[DISABLE];
	else process.env[DISABLE] = savedDisable;
	rmSync(home, { recursive: true });
});

/** Starts a session with the extension and returns the notify spy and the turn handler. */
async function startSession() {
	const handlers = new Map<string, Handler>();
	const api = { on: (name: string, fn: Handler) => handlers.set(name, fn), events: { emit: () => {} } };
	claudeRulesExtension(api as unknown as ExtensionAPI);
	const notify = vi.fn();
	const ctx = {
		cwd: home,
		hasUI: false,
		isProjectTrusted: () => false,
		ui: { notify },
	} as unknown as ExtensionContext;
	await handlers.get("session_start")?.({}, ctx);
	const turn = (event: PromptEvent) => handlers.get("before_agent_start")?.(event, ctx);
	return { notify, turn };
}

const freshEvent = (): PromptEvent => ({
	systemPrompt: "base prompt",
	systemPromptOptions: { contextFiles: [{ path: "/proj/CLAUDE.md", content: "project memory" }] },
});

describe("claude-rules keeps CLAUDE.md out of the context when disabled", () => {
	it("a rule reaches the prompt once and the native context files are left as they were", async () => {
		const { notify, turn } = await startSession();
		const event = freshEvent();
		const result = (await turn(event)) as { systemPrompt: string } | undefined;
		expect(result?.systemPrompt.split(RULE_BODY)).toHaveLength(2); // exactly once
		expect(event.systemPromptOptions.contextFiles).toEqual(freshEvent().systemPromptOptions.contextFiles);
		expect(notify).toHaveBeenCalledTimes(1);
	});

	it(`${DISABLE}=1 delivers no rule and shows no notice`, async () => {
		process.env[DISABLE] = "1";
		const { notify, turn } = await startSession();
		const event = freshEvent();
		expect(await turn(event)).toBeUndefined();
		expect(event.systemPromptOptions.contextFiles).toEqual(freshEvent().systemPromptOptions.contextFiles);
		expect(event.systemPrompt).toBe("base prompt");
		expect(notify).not.toHaveBeenCalled();
	});

	it(`${DISABLE} set only after session start still holds the rule back`, async () => {
		const { turn } = await startSession();
		process.env[DISABLE] = "1";
		expect(await turn(freshEvent())).toBeUndefined();
	});
});
