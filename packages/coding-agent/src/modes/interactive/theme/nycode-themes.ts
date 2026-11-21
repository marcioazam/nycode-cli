// The nycode themes shipped next to dark.json and light.json (seam K4): tokyo-night, the default, and mono, which the
// ui extension applies under NO_COLOR.
import * as fs from "node:fs";
import * as path from "node:path";
import { getThemesDir } from "../../../config.ts";
import { stripBom } from "../../../utils/text.ts";
import type { ValidatedThemeJson } from "./theme-schema.ts";

export const NYCODE_THEME_NAMES = ["tokyo-night", "mono"] as const;

/** The nycode themes by name, read from the built-in themes directory. */
export function loadNycodeThemes(): Record<string, ValidatedThemeJson> {
	const themesDir = getThemesDir();
	const themes: Record<string, ValidatedThemeJson> = {};
	for (const name of NYCODE_THEME_NAMES) {
		themes[name] = JSON.parse(stripBom(fs.readFileSync(path.join(themesDir, `${name}.json`), "utf-8")));
	}
	return themes;
}
