function normalizePathForGlob(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\//, "");
}

function escapeRegExpChar(char: string): string {
  return /[|\\{}()[\]^$+?.]/.test(char) ? `\\${char}` : char;
}

export function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePathForGlob(pattern);
  let source = "^";

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (char === "*") {
      if (next === "*") {
        const after = normalized[i + 2];
        if (after === "/") {
          source += "(?:.*\/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExpChar(char);
  }

  source += "$";
  return new RegExp(source);
}

export function matchesGlob(pattern: string, relativePath: string): boolean {
  const normalizedPath = normalizePathForGlob(relativePath);
  return globToRegExp(pattern).test(normalizedPath);
}

export function matchesAnyGlob(patterns: string[] | undefined, relativePath: string): boolean {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((pattern) => matchesGlob(pattern, relativePath));
}

export function isPathIncluded(relativePath: string, include?: string[], exclude?: string[]): boolean {
  const normalizedPath = normalizePathForGlob(relativePath);
  const included = !include || include.length === 0 || matchesAnyGlob(include, normalizedPath);
  if (!included) return false;
  return !matchesAnyGlob(exclude, normalizedPath);
}
