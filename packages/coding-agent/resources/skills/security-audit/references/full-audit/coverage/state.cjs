const { hasOwn, safeQuote } = require("../shared/safe-text.cjs");
const { MAX_LIST_ITEMS, ATTEMPT_STATUSES, ATTEMPT_FIELDS } = require("./limits.cjs");
const { isObject, isVisibleText, isSafeAgentId } = require("./identity.cjs");
const { validateStringArray, validateChecks, validateReviewedPathOwnership } = require("./evidence.cjs");

function requireEmptyArray(unit, field, base, errors) {
  if (Array.isArray(unit[field]) && unit[field].length > 0) {
    errors.push(`${base}.${field}: unit with status ${safeQuote(unit.status)} must keep this array empty`);
  }
}

function requireNonemptyArray(unit, field, base, errors) {
  if (!Array.isArray(unit[field]) || unit[field].length === 0) {
    errors.push(`${base}.${field}: unit with status ${safeQuote(unit.status)} requires entries`);
  }
}

function validateStateInvariants(unit, base, errors) {
  const emptyEvidence = () => {
    requireEmptyArray(unit, "reviewed_paths", base, errors);
    requireEmptyArray(unit, "local_checks", base, errors);
  };
  const requireOwner = () => {
    if (!isSafeAgentId(unit.agent_id)) errors.push(`${base}.agent_id: unit with status ${safeQuote(unit.status)} requires a canonical lowercase agent ID`);
  };

  if (unit.status !== "candidate") requireEmptyArray(unit, "result_fingerprints", base, errors);

  switch (unit.status) {
    case "planned":
      if (unit.agent_id !== null) errors.push(`${base}.agent_id: planned unit must be unassigned`);
      emptyEvidence();
      requireEmptyArray(unit, "unresolved", base, errors);
      break;
    case "not_applicable":
    case "out_of_scope":
    case "deferred":
      if (unit.agent_id !== null) errors.push(`${base}.agent_id: unit with status ${safeQuote(unit.status)} must be unassigned`);
      emptyEvidence();
      requireNonemptyArray(unit, "unresolved", base, errors);
      break;
    case "in_progress":
      requireOwner();
      emptyEvidence();
      requireEmptyArray(unit, "unresolved", base, errors);
      break;
    case "blocked":
      requireOwner();
      requireNonemptyArray(unit, "reviewed_paths", base, errors);
      requireNonemptyArray(unit, "local_checks", base, errors);
      requireNonemptyArray(unit, "unresolved", base, errors);
      break;
    case "covered":
      requireOwner();
      requireNonemptyArray(unit, "reviewed_paths", base, errors);
      requireNonemptyArray(unit, "local_checks", base, errors);
      requireEmptyArray(unit, "unresolved", base, errors);
      break;
    case "candidate":
      requireOwner();
      requireNonemptyArray(unit, "reviewed_paths", base, errors);
      requireNonemptyArray(unit, "local_checks", base, errors);
      requireNonemptyArray(unit, "result_fingerprints", base, errors);
      break;
  }
}

function validateAttempts(value, unit, base, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${base}.attempts: expected array`);
    return;
  }
  if (value.length > MAX_LIST_ITEMS) errors.push(`${base}.attempts: exceeds ${MAX_LIST_ITEMS} entries`);

  const priorOwners = new Set();
  const priorArtifacts = new Set();
  let previousWave = 0;
  value.slice(0, MAX_LIST_ITEMS).forEach((attempt, index) => {
    const attemptBase = `${base}.attempts[${index}]`;
    if (!isObject(attempt)) {
      errors.push(`${attemptBase}: expected object`);
      return;
    }
    for (const field of ATTEMPT_FIELDS) {
      if (!hasOwn(attempt, field)) errors.push(`${attemptBase}: missing required field ${safeQuote(field)}`);
    }
    if (!Number.isInteger(attempt.wave) || attempt.wave < 1) {
      errors.push(`${attemptBase}.wave: expected a positive integer`);
    } else {
      if (attempt.wave <= previousWave) errors.push(`${attemptBase}.wave: archived attempt waves must be strictly increasing`);
      if (Number.isInteger(unit.wave) && attempt.wave >= unit.wave) {
        errors.push(`${attemptBase}.wave: archived attempt wave must precede current wave ${safeQuote(unit.wave)}`);
      }
      previousWave = attempt.wave;
    }
    if (!ATTEMPT_STATUSES.has(attempt.status)) {
      errors.push(`${attemptBase}.status: expected "covered", "candidate", or "blocked"`);
    }
    let hasFreshOwner = false;
    if (!isSafeAgentId(attempt.agent_id)) {
      errors.push(`${attemptBase}.agent_id: archived attempt requires a canonical lowercase agent ID`);
    } else if (priorOwners.has(attempt.agent_id)) {
      errors.push(`${attemptBase}.agent_id: assignment owner must be fresh for each attempt`);
    } else {
      hasFreshOwner = true;
    }
    validateStringArray(attempt.reviewed_paths, `${attemptBase}.reviewed_paths`, errors, { pathValue: true });
    validateChecks(attempt.local_checks, `${attemptBase}.local_checks`, errors);
    validateReviewedPathOwnership(attempt, attemptBase, errors);
    validateStringArray(attempt.result_fingerprints, `${attemptBase}.result_fingerprints`, errors, { fingerprint: true });
    validateStringArray(attempt.unresolved, `${attemptBase}.unresolved`, errors);
    if (!isVisibleText(attempt.reassignment_reason)) errors.push(`${attemptBase}.reassignment_reason: invalid text`);
    validateStateInvariants(attempt, attemptBase, errors);

    if (Array.isArray(attempt.local_checks)) {
      attempt.local_checks.forEach((check, checkIndex) => {
        if (!isObject(check)) return;
        if (priorOwners.has(check.agent_id)) {
          errors.push(`${attemptBase}.local_checks[${checkIndex}].agent_id: prior assignment owner evidence must remain in its earlier attempt`);
        }
        if (typeof check.artifact === "string" && priorArtifacts.has(check.artifact)) {
          errors.push(`${attemptBase}.local_checks[${checkIndex}].artifact: artifact from an earlier attempt cannot be reused`);
        }
        if (check.method === "local" && typeof check.artifact === "string") priorArtifacts.add(check.artifact);
      });
    }
    if (hasFreshOwner) priorOwners.add(attempt.agent_id);
  });

  if (isSafeAgentId(unit.agent_id) && priorOwners.has(unit.agent_id)) {
    errors.push(`${base}.agent_id: current assignment owner must be fresh after reassignment`);
  }
  if (Array.isArray(unit.local_checks)) {
    unit.local_checks.forEach((check, index) => {
      if (!isObject(check)) return;
      if (priorOwners.has(check.agent_id)) {
        errors.push(`${base}.local_checks[${index}].agent_id: prior assignment owner evidence must remain in its archived attempt`);
      }
      if (typeof check.artifact === "string" && priorArtifacts.has(check.artifact)) {
        errors.push(`${base}.local_checks[${index}].artifact: artifact from an archived attempt cannot be reused`);
      }
    });
  }
}


module.exports = { validateStateInvariants, validateAttempts };
