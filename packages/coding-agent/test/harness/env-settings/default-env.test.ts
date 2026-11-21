// The `env` nycode applies by default (settings-defaults.ts) and the settings.json entry that overrides it.
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "../../../src/core/extensions/types.ts";
import envSettingsExtension from "../../../src/extensions/env-settings/index.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

const saved = process.env.EIO_BACKEND;
afterEach(() => {
	if (saved === undefined) delete process.env.EIO_BACKEND;
	else process.env.EIO_BACKEND = saved;
});

function load(settings: { env?: Record<string, string> }) {
	const handlers = new Map<string, Handler>();
	const api = { on: (name: string, fn: Handler) => handlers.set(name, fn), getSettings: () => settings };
	envSettingsExtension(api as unknown as ExtensionAPI);
	const ctx = { cwd: process.cwd(), isProjectTrusted: () => false } as unknown as ExtensionContext;
	return {
		start: () => handlers.get("session_start")?.({}, ctx),
		stop: () => handlers.get("session_shutdown")?.({}, ctx),
	};
}

describe("default env", () => {
	it("exports EIO_BACKEND=posix when the extension loads, and hands the shell's value back at shutdown", () => {
		process.env.EIO_BACKEND = "epoll";
		const session = load({});
		expect(process.env.EIO_BACKEND).toBe("posix");
		session.start();
		expect(process.env.EIO_BACKEND).toBe("posix");
		session.stop();
		expect(process.env.EIO_BACKEND).toBe("epoll");
	});

	it("a settings.json env entry overrides the default once the session starts", () => {
		const session = load({ env: { EIO_BACKEND: "linux-aio" } });
		session.start();
		expect(process.env.EIO_BACKEND).toBe("linux-aio");
		session.stop();
	});
});
