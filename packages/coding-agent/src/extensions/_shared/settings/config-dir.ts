/**
 * The home-scope Claude config directory. nycode does not read Claude Code's config-directory override (D-09: that
 * variable is converted once by `nycode migrate from-pi`), so every consumer sees `<home>/.claude`. A project's own
 * `.claude/` directory is unaffected.
 */

import * as path from "node:path";

/** The home-scope Claude config directory: always `<home>/.claude`. */
export function claudeConfigDir(home: string): string {
	return path.join(home, ".claude");
}
