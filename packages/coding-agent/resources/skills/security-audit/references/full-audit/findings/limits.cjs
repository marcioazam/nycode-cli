const { escapeUnsafeDiagnosticCharacters, propertyPath } = require("../shared/safe-text.cjs");

const LIMITS = Object.freeze({
  inputBytes: 5 * 1024 * 1024,
  nestingDepth: 64,
  arrayItems: 1000,
  canonicalKeyBytes: 1024 * 1024,
  uniqueSetBytes: 5 * 1024 * 1024,
  validationErrors: 100,
});
function collectDataLimitErrors(value, location = "$data") {
  const stack = [{ value, location, depth: value !== null && typeof value === "object" ? 1 : 0 }];
  const seen = new WeakSet();

  while (stack.length > 0) {
    const current = stack.pop();
    if (current.value === null || typeof current.value !== "object") continue;
    if (current.depth > LIMITS.nestingDepth) {
      return [escapeUnsafeDiagnosticCharacters(`${current.location}: exceeds ${LIMITS.nestingDepth} level nesting depth limit`)];
    }
    if (seen.has(current.value)) {
      return [escapeUnsafeDiagnosticCharacters(`${current.location}: input must not contain repeated or cyclic object references`)];
    }
    seen.add(current.value);

    if (Array.isArray(current.value)) {
      if (current.value.length > LIMITS.arrayItems) {
        return [escapeUnsafeDiagnosticCharacters(`${current.location}: exceeds ${LIMITS.arrayItems} item array limit`)];
      }
      for (let index = current.value.length - 1; index >= 0; index--) {
        const child = current.value[index];
        if (child !== null && typeof child === "object") {
          stack.push({ value: child, location: `${current.location}[${index}]`, depth: current.depth + 1 });
        }
      }
    } else {
      const keys = Object.keys(current.value);
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index];
        const child = current.value[key];
        if (child !== null && typeof child === "object") {
          stack.push({ value: child, location: propertyPath(current.location, key), depth: current.depth + 1 });
        }
      }
    }
  }

  return [];
}


module.exports = { LIMITS, collectDataLimitErrors };
