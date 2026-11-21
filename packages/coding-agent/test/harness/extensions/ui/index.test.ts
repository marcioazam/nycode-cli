// The ui extension wires its five parts (editor, a11y, terminal, diff, btw) into one registration.
import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../../../../src/core/extensions/types.ts";
import ui from "../../../../src/extensions/ui/index.ts";

type Recorder = { events: string[]; commands: string[]; api: ExtensionAPI };

// Records registrations; every other API member is a no-op so each part can load.
function recorder(): Recorder {
	const events: string[] = [];
	const commands: string[] = [];
	const target = {
		on: (name: string) => events.push(name),
		registerCommand: (name: string) => commands.push(name),
		getSettings: () => ({}),
	};
	const api = new Proxy(target, {
		get: (t, key) => (key in t ? t[key as keyof typeof t] : () => undefined),
	}) as unknown as ExtensionAPI;
	return { events, commands, api };
}

describe("ui extension", () => {
	it("registers the /diff and /btw commands and the session handlers of its parts", () => {
		const { events, commands, api } = recorder();
		ui(api);
		expect(commands).toEqual(expect.arrayContaining(["diff", "btw"]));
		expect(events).toContain("session_start");
	});

	it("loads each part once per registration", () => {
		const first = recorder();
		const second = recorder();
		ui(first.api);
		ui(second.api);
		expect(second.commands).toEqual(first.commands);
		expect(new Set(first.commands).size).toBe(first.commands.length);
	});
});
