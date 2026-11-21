// K11: the self-kill pattern match is time-bounded. F5: `pkill -f '(a+)+$'` against a long `aaaa...!` line used to
// freeze the process in catastrophic backtracking; the match now gives up (true = deny) after the vm timeout.
import { describe, expect, it } from "vitest";
import { checkSelfKill, matchesSelf } from "../../../src/core/permissions/guard/bash/self-kill.ts";

describe("matchesSelf", () => {
	it("keeps matching normal patterns", () => {
		expect(matchesSelf("chrome", "pkill -f chrome")).toBe(true);
		expect(matchesSelf("[c]hrome", "pkill -f '[c]hrome'")).toBe(false);
		expect(matchesSelf("(unclosed", "pkill -f '(unclosed'")).toBe(true);
	});

	it("denies a catastrophic pattern within the time budget", () => {
		const cmd = `pkill -f '(a+)+$' ; echo ${"a".repeat(40)}!`;
		const start = Date.now();
		expect(matchesSelf("(a+)+$", cmd)).toBe(true);
		expect(Date.now() - start).toBeLessThan(2000);
	});

	it("denies the F5 command through checkSelfKill", () => {
		const cmd = `pgrep -f '(a+)+$' | xargs kill ; echo ${"a".repeat(40)}!`;
		const start = Date.now();
		expect(checkSelfKill(cmd)).toEqual([["deny", expect.any(String)]]);
		expect(Date.now() - start).toBeLessThan(2000);
	});
});
