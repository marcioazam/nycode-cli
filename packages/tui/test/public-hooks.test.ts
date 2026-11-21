import assert from "node:assert";
import type { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { Text } from "../src/components/text.ts";
import { getPrimaryScrollSnapshot, isSelectionPressActive, observeTerminalInput } from "../src/public-hooks.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

const content = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");

describe("public hooks (seam K10)", () => {
	it("reads the primary scroll area of the last frame and scrolls it", async () => {
		const terminal = new VirtualTerminal(20, 5);
		const tui = new TuiAltScreen(terminal);
		try {
			tui.addChild(new Text(content, 0, 0));
			assert.strictEqual(getPrimaryScrollSnapshot(tui), undefined, "no frame yet");
			tui.start();
			await terminal.waitForRender();
			const snapshot = getPrimaryScrollSnapshot(tui);
			assert.ok(snapshot);
			assert.strictEqual(snapshot.contentLines.length, 30);
			assert.deepStrictEqual(snapshot.rect, { x: 0, y: 0, width: 20, height: 5 });
			assert.strictEqual(snapshot.scrollTop, 25, "follows the end of the content");

			snapshot.scrollTo(3, { disableFollow: true });
			await terminal.waitForRender();
			assert.strictEqual(getPrimaryScrollSnapshot(tui)?.scrollTop, 3);
		} finally {
			tui.stop();
		}
	});

	it("has no scroll snapshot and no selection outside fullscreen mode", async () => {
		const terminal = new VirtualTerminal(20, 5);
		const tui = new TuiMainScreen(terminal);
		try {
			tui.addChild(new Text(content, 0, 0));
			tui.start();
			await terminal.waitForRender();
			assert.strictEqual(getPrimaryScrollSnapshot(tui), undefined);
			assert.strictEqual(isSelectionPressActive(tui), false);
		} finally {
			tui.stop();
		}
	});

	it("reports a mouse press as an active selection until the release", async () => {
		const terminal = new VirtualTerminal(20, 5);
		const tui = new TuiAltScreen(terminal);
		try {
			tui.addChild(new Text(content, 0, 0));
			tui.start();
			await terminal.waitForRender();
			assert.strictEqual(isSelectionPressActive(tui), false);
			terminal.sendInput("\x1b[<0;3;2M");
			assert.strictEqual(isSelectionPressActive(tui), true);
			terminal.sendInput("\x1b[<0;3;2m");
			assert.strictEqual(isSelectionPressActive(tui), false);
		} finally {
			tui.stop();
		}
	});

	it("observes raw stdin chunks until unsubscribed, without consuming them", () => {
		const seen: string[] = [];
		const stdin = process.stdin as unknown as EventEmitter;
		const before = stdin.listenerCount("data");
		const off = observeTerminalInput((chunk) => seen.push(chunk));
		stdin.emit("data", Buffer.from("\x1b[I"));
		stdin.emit("data", "abc");
		assert.deepStrictEqual(seen, ["\x1b[I", "abc"]);
		off();
		stdin.emit("data", "later");
		assert.deepStrictEqual(seen, ["\x1b[I", "abc"]);
		assert.strictEqual(stdin.listenerCount("data"), before);
		process.stdin.pause(); // a data listener put stdin in flowing mode, which would keep the test process alive
	});
});
