// The nycode themes shipped next to dark.json and light.json (seam K4): tokyo-night, the default, and mono, which the
// ui extension applies under NO_COLOR.
import * as fs from "node:fs";
import * as path from "node:path";
import { getThemesDir } from "../../../config.ts";
import { stripBom } from "../../../utils/text.ts";
import type { ValidatedThemeJson } from "./theme-schema.ts";

export const NYCODE_THEME_NAMES = ["tokyo-night", "mono"] as const;

export const DEFAULT_THEME = "tokyo-night";

/**
 * The theme setting a session starts with: `--theme` wins, then the saved setting (undefined here, so the controller
 * reads it), then tokyo-night. The default is the controller's session-only setting, so nothing is written to settings.json.
 */
export function initialThemeSetting(requested: string | undefined, saved: string | undefined): string | undefined {
	return requested ?? (saved === undefined ? DEFAULT_THEME : undefined);
}

/** The nycode themes by name, read from the built-in themes directory. */
export function loadNycodeThemes(): Record<string, ValidatedThemeJson> {
	const themesDir = getThemesDir();
	const themes: Record<string, ValidatedThemeJson> = {};
	for (const name of NYCODE_THEME_NAMES) {
		themes[name] = JSON.parse(stripBom(fs.readFileSync(path.join(themesDir, `${name}.json`), "utf-8")));
	}
	return themes;
}
