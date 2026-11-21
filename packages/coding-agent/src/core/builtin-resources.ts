/**
 * Built-in resources shipped with the package (K6): instructions, rules, skills, commands and agents under
 * `<package>/resources/`. The scope is the lowest precedence of all (built-in < global < project, 02 section 6): a
 * user, project or package resource with the same name replaces the built-in one. A missing directory means nothing is
 * embedded and is not an error.
 *
 * Root: `getPackageDir()/resources`, so it is found next to the sources, next to `dist/` and from a package installed
 * by npm. The standalone binary resolves it next to the executable (`dirname(execPath)/resources`); F11 copies the
 * directory there (`copy-binary-assets`), as it already does for `theme/` and `builtin-agents/`.
 */

import { existsSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { getPackageDir } from "../config.ts";
import type { ResourceDiagnostic } from "./diagnostics.ts";
import { type LoadSkillsOptions, type LoadSkillsResult, loadSkills } from "./skills.ts";

export type BuiltinResourceKind = "instructions" | "rules" | "skills" | "commands" | "agents";

/** Marker the embedded texts use for the resources root; resolved by the loader, never a literal path. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: the marker is literal text, not a template
export const RESOURCES_MARKER = "${NYCODE_RESOURCES}";

/** The root directory of the built-in resources (it may not exist). */
export function getBuiltinResourcesRoot(): string {
	return join(getPackageDir(), "resources");
}

/** The built-in directory of `kind`, or undefined when it does not exist. */
export function builtinResourceDir(kind: BuiltinResourceKind, root = getBuiltinResourcesRoot()): string | undefined {
	const dir = join(root, kind);
	return existsSync(dir) && statSync(dir).isDirectory() ? dir : undefined;
}

/** `text` with every `${NYCODE_RESOURCES}` replaced by the resources root. */
export function resolveResourcesMarker(text: string, root = getBuiltinResourcesRoot()): string {
	// split/join: the root is data, so `$&` and friends in a path are not replacement patterns
	return text.split(RESOURCES_MARKER).join(root);
}

/**
 * `loadSkills` with the built-in skills added after every other path, so any same-named skill wins. The collision this
 * creates is the intended override, so it is not reported. `includeBuiltin: false` (`--no-skills`) loads only the paths.
 */
export function loadSkillsWithBuiltin(options: LoadSkillsOptions, includeBuiltin: boolean): LoadSkillsResult {
	const dir = includeBuiltin ? builtinResourceDir("skills") : undefined;
	if (!dir) return loadSkills(options);
	const result = loadSkills({ ...options, skillPaths: [...options.skillPaths, dir] });
	const isOverridden = (d: ResourceDiagnostic): boolean =>
		d.collision?.resourceType === "skill" && d.collision.loserPath.startsWith(dir + sep);
	return { ...result, diagnostics: result.diagnostics.filter((d) => !isOverridden(d)) };
}
