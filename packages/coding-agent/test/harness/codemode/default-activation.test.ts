// D-39 / D-40: `codemode` is registered inactive; only the MCP rule activates it (`exposure ?? "codemode"` plus
// `autoEnableCodemode`), the same rule ny-pi ran on pi 1.5.2 (mcp/index.ts there, line 61 and 411). A server without an
// `exposure` therefore turns it on, a `deferred` server turns on `tool_search` instead, and with no server neither is
// active. Covered upstream and not repeated here: explicit `codemode` exposure and `autoEnableCodemode: false`
// (test/suite/agent-session-mcp.test.ts, "exposes codemode-only MCP tools..." and "does not activate codemode...").
import { type JsonRpcRequest, LATEST_PROTOCOL_VERSION } from "@nycode/mcp";
import { createInMemoryTransportPair } from "@nycode/mcp/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodemodeExtension } from "../../../src/extensions/codemode/index.ts";
import type { McpServerConfig } from "../../../src/extensions/mcp/config.ts";
import { createMcpExtension } from "../../../src/extensions/mcp/index.ts";
import { createToolSearchExtension } from "../../../src/extensions/tool-search/index.ts";
import { createHarness, createTestUiContext, type Harness } from "../../suite/harness.ts";

/** A stdio-free MCP server over an in-memory transport that lists one tool. */
function fakeTransport() {
	const pair = createInMemoryTransportPair();
	pair.server.onMessage((message) => {
		if (!("id" in message) || !("method" in message)) return;
		const request = message as JsonRpcRequest;
		const result =
			request.method === "initialize"
				? {
						protocolVersion: LATEST_PROTOCOL_VERSION,
						capabilities: { tools: {} },
						serverInfo: { name: "docs", version: "1.0.0" },
					}
				: request.method === "tools/list"
					? {
							tools: [
								{ name: "search", description: "Search.", inputSchema: { type: "object", properties: {} } },
							],
						}
					: {};
		queueMicrotask(() => void pair.server.send({ jsonrpc: "2.0", id: request.id, result }));
	});
	void pair.server.start();
	return pair.client;
}

describe("codemode activation parity with ny-pi", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	/** A session with the built-in codemode, tool_search and mcp extensions and the given servers (none: no mcp.json). */
	async function start(servers: McpServerConfig[]) {
		const harness = await createHarness({
			initialActiveToolNames: [],
			extensionFactories: [
				createCodemodeExtension(),
				createToolSearchExtension(),
				createMcpExtension({
					loadConfig: () => ({
						servers: servers.map((config) => ({ name: "docs", config, source: "test" })),
						errors: [],
					}),
					createTransport: fakeTransport,
				}),
			],
		});
		harnesses.push(harness);
		await harness.session.bindExtensions({ uiContext: createTestUiContext() });
		if (servers.length > 0) {
			await vi.waitFor(() =>
				expect(harness.session.getAllTools().some((tool) => tool.name === "mcp__docs__search")).toBe(true),
			);
		}
		return harness;
	}

	it("keeps codemode and tool_search registered but inactive without MCP servers", async () => {
		const harness = await start([]);
		const registered = harness.session.getAllTools().map((tool) => tool.name);
		expect(registered).toContain("codemode");
		expect(registered).toContain("tool_search");
		expect(harness.session.getActiveToolNames()).toEqual([]);
	});

	it("activates codemode for a server without an exposure", async () => {
		const harness = await start([{ url: "http://unused.invalid" }]);
		expect(harness.session.getActiveToolNames()).toEqual(["codemode"]);
	});

	it("activates tool_search, not codemode, for a deferred server", async () => {
		const harness = await start([{ url: "http://unused.invalid", exposure: "deferred" }]);
		expect(harness.session.getActiveToolNames()).toEqual(["tool_search"]);
	});
});
