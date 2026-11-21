// Ports import/ny-pi/extensions/ui-visual/test/index.test.ts to vitest.
import assert from "node:assert/strict";
import { test } from "vitest";
import type { ExtensionAPI } from "../../../../src/core/extensions/types.ts";
import index from "../../../../src/extensions/ui-visual/index.ts";

test("index liga indicador, cabeçalho e renderizadores, sem registerTool", () => {
	const saved = process.env.NYCODE_SUBAGENT;
	delete process.env.NYCODE_SUBAGENT;
	const events: string[] = [];
	const calls: string[] = [];
	index({
		on: (name: string) => events.push(name),
		registerToolRenderer: () => calls.push("registerToolRenderer"),
		registerTool: () => calls.push("registerTool"),
	} as unknown as ExtensionAPI);
	if (saved !== undefined) process.env.NYCODE_SUBAGENT = saved;
	assert.deepEqual(calls, ["registerToolRenderer"]);
	for (const e of ["session_start", "agent_start", "agent_settled", "tool_execution_start", "tool_execution_end"])
		assert.ok(events.includes(e), e);
});
