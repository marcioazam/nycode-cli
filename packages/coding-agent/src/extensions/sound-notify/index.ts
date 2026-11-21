/**
 * Plays a local sound when the nycode turn finally ends (port of ~/.claude/hooks/sound-notify.py, itself from
 * ~/.codex/bin/codex-sound-notify).
 *
 * `agent_settled` is the real end: after retries, compaction and continuations (/goal, plan gate), so a turn plays
 * once. Only in the main interactive session: nothing in subagents (NYCODE_SUBAGENT=1) nor without UI (`-p`), so evals
 * and lanes do not play in series. Player order: canberra-gtk-play, pw-play with the freedesktop sound, TTY bell.
 * Switched by `notify.sound` (NYCODE_SOUND_NOTIFY wins), on by default. Complements the notify extension (terminal
 * notification only when "away").
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { resolveNycodeSettings } from "../../core/settings-nycode.ts";

const COMPLETE_SOUND = "/usr/share/sounds/freedesktop/stereo/complete.oga";

function onPath(bin: string): boolean {
	return (process.env.PATH ?? "").split(":").some((dir) => dir && fs.existsSync(`${dir}/${bin}`));
}

export function playerCommand(
	exists: (bin: string) => boolean = onPath,
	hasSound: boolean = fs.existsSync(COMPLETE_SOUND),
): string[] | undefined {
	if (exists("canberra-gtk-play")) return ["canberra-gtk-play", "-i", "complete", "-d", "nycode turn complete"];
	if (hasSound && exists("pw-play")) return ["pw-play", COMPLETE_SOUND];
	return undefined;
}

function play(): void {
	const command = playerCommand();
	if (command) {
		try {
			spawn(command[0], command.slice(1), { stdio: "ignore", detached: true }).unref();
			return;
		} catch {
			// falls back to the bell
		}
	}
	try {
		fs.writeFileSync("/dev/tty", "\x07");
	} catch {
		// no TTY: nothing to do
	}
}

export default function soundNotifyExtension(nycode: ExtensionAPI): void {
	if (process.env.NYCODE_SUBAGENT === "1") return;
	nycode.on("agent_settled", async (_event, ctx) => {
		if (ctx.hasUI && resolveNycodeSettings(nycode.getSettings(), process.env).notify.sound) play();
	});
}
