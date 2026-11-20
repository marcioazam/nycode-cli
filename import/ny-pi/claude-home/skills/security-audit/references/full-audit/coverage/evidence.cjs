const { hasOwn, safeQuote, isSafeRelativePath } = require("../shared/safe-text.cjs");
const { MAX_LIST_ITEMS, FINGERPRINT_PATTERN } = require("./limits.cjs");
const { isObject, isVisibleText, isSafeAgentId, isOwnedArtifactPath } = require("./identity.cjs");

function validateStringArray(value, location, errors, options = {}) {
  const { allowEmpty = true, fingerprint = false, pathValue = false } = options;
  if (!Array.isArray(value)) {
    errors.push(`${location}: expected array`);
    return;
  }
  if (!allowEmpty && value.length === 0) errors.push(`${location}: must not be empty`);
  if (value.length > MAX_LIST_ITEMS) errors.push(`${location}: exceeds ${MAX_LIST_ITEMS} entries`);
  const seen = new Set();
  value.slice(0, MAX_LIST_ITEMS).forEach((entry, index) => {
    const entryLocation = `${location}[${index}]`;
    const valid = pathValue ? isSafeRelativePath(entry) : isVisibleText(entry);
    if (!valid) errors.push(`${entryLocation}: invalid ${pathValue ? "repository-relative path" : "text"}`);
    if (fingerprint && typeof entry === "string" && !FINGERPRINT_PATTERN.test(entry)) {
      errors.push(`${entryLocation}: invalid fingerprint`);
    }
    if (typeof entry === "string" && seen.has(entry)) errors.push(`${entryLocation}: duplicate entry`);
    if (typeof entry === "string") seen.add(entry);
  });
}

function validateChecks(value, location, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${location}: expected array`);
    return;
  }
  if (value.length > MAX_LIST_ITEMS) errors.push(`${location}: exceeds ${MAX_LIST_ITEMS} entries`);
  value.slice(0, MAX_LIST_ITEMS).forEach((check, index) => {
    const base = `${location}[${index}]`;
    if (!isObject(check)) {
      errors.push(`${base}: expected object`);
      return;
    }
    for (const field of ["agent_id", "reviewed_paths", "invariant", "method", "result", "artifact"]) {
      if (!hasOwn(check, field)) errors.push(`${base}: missing required field ${safeQuote(field)}`);
    }
    if (!isSafeAgentId(check.agent_id)) errors.push(`${base}.agent_id: expected a canonical lowercase agent ID`);
    validateStringArray(check.reviewed_paths, `${base}.reviewed_paths`, errors, { allowEmpty: false, pathValue: true });
    if (!isVisibleText(check.invariant)) errors.push(`${base}.invariant: invalid text`);
    if (check.method !== "source" && check.method !== "local") errors.push(`${base}.method: expected "source" or "local"`);
    if (!isVisibleText(check.result)) errors.push(`${base}.result: invalid text`);
    if (check.method === "source" && check.artifact !== null) {
      errors.push(`${base}.artifact: source-only check must use null`);
    } else if (check.method === "local") {
      if (!isOwnedArtifactPath(check.artifact, check.agent_id)) {
        errors.push(`${base}.artifact: local check requires an artifact owned by agent ${safeQuote(isSafeAgentId(check.agent_id) ? check.agent_id : "<agent-id>")}`);
      }
    } else if (check.method !== "source" && check.method !== "local" && check.artifact !== null && !isSafeRelativePath(check.artifact)) {
      errors.push(`${base}.artifact: expected null or a safe output-relative path`);
    }
  });
}

function validateReviewedPathOwnership(unit, base, errors) {
  if (!Array.isArray(unit.reviewed_paths) || !Array.isArray(unit.local_checks)) return;
  const aggregatePaths = new Set(unit.reviewed_paths.filter((value) => typeof value === "string"));
  const ownedPaths = new Set();
  for (const check of unit.local_checks) {
    if (!isObject(check) || !Array.isArray(check.reviewed_paths)) continue;
    for (const reviewedPath of check.reviewed_paths) {
      if (typeof reviewedPath === "string") ownedPaths.add(reviewedPath);
    }
  }
  for (const reviewedPath of aggregatePaths) {
    if (!ownedPaths.has(reviewedPath)) errors.push(`${base}.reviewed_paths: ${safeQuote(reviewedPath)} has no check owner`);
  }
  for (const reviewedPath of ownedPaths) {
    if (!aggregatePaths.has(reviewedPath)) errors.push(`${base}.local_checks: owned path ${safeQuote(reviewedPath)} is absent from aggregate reviewed_paths`);
  }
}

function validateExcludedBlocks(value, location, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${location}: expected array`);
    return;
  }
  if (value.length > MAX_LIST_ITEMS) errors.push(`${location}: exceeds ${MAX_LIST_ITEMS} entries`);
  const seen = new Set();
  value.slice(0, MAX_LIST_ITEMS).forEach((entry, index) => {
    const base = `${location}[${index}]`;
    if (!isObject(entry)) {
      errors.push(`${base}: expected object`);
      return;
    }
    if (!isVisibleText(entry.block)) errors.push(`${base}.block: invalid text`);
    if (!isVisibleText(entry.reason)) errors.push(`${base}.reason: invalid text`);
    if (typeof entry.block === "string" && seen.has(entry.block)) errors.push(`${base}.block: duplicate entry`);
    if (typeof entry.block === "string") seen.add(entry.block);
  });
}


module.exports = { validateStringArray, validateChecks, validateReviewedPathOwnership, validateExcludedBlocks };
