// local.env gate of `migrate from-pi`: owner and mode checked, parsed line by line, never sourced.
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeHome } from "./from-pi-fixture.ts";

describe("migrate from-pi local.env", () => {
	it("refuses a 0644 local.env with a clear message and writes nothing", async () => {
		const h = makeHome();
		chmodSync(join(h.source, "local.env"), 0o644);
		expect(await h.run(["--apply"])).toBe(1);
		const text = [...h.out, ...h.err].join("\n");
		expect(text).toContain("local.env");
		expect(text).toContain("0644");
		expect(text).toContain("chmod 600");
		expect(existsSync(h.agentDir)).toBe(false);
	});

	it("accepts mode 0400", async () => {
		const h = makeHome();
		chmodSync(join(h.source, "local.env"), 0o400);
		expect(await h.run([])).toBe(0);
	});

	it("never evaluates shell syntax and ignores unknown keys without printing their values", async () => {
		const h = makeHome();
		const marker = join(h.home, "pwned");
		chmodSync(join(h.source, "local.env"), 0o600);
		writeFileSync(
			join(h.source, "local.env"),
			`PI_COMPACT_AT=$(touch ${marker})\nPI_BYPASS_PERMISSIONS=1\nOTHER_TOKEN=hunter2hunter2\n`,
		);
		expect(await h.run([])).toBe(0);
		expect(existsSync(marker)).toBe(false);
		const text = [...h.out, ...h.err].join("\n");
		expect(text).toContain("OTHER_TOKEN");
		expect(text).not.toContain("hunter2hunter2");
	});
});
