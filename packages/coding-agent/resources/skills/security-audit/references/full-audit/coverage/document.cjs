const { hasOwn, safeQuote, createBoundedErrors } = require("../shared/safe-text.cjs");
const { LIMITS, MAX_UNITS, REQUIRED_FIELDS, REF_FIELDS, STATUSES, PRIOR_STATUSES } = require("./limits.cjs");
const createErrorList = () => createBoundedErrors(LIMITS.validationErrors);
const { isObject, isVisibleText, isCanonicalRef, canonicalCoverageId, isSafeAgentId, semanticKey, hasValidSemanticFields } = require("./identity.cjs");
const { validateStringArray, validateChecks, validateReviewedPathOwnership, validateExcludedBlocks } = require("./evidence.cjs");
const { validateStateInvariants, validateAttempts } = require("./state.cjs");
const { preflightDocument } = require("./preflight.cjs");

function collectUnitErrors(unit, index) {
  const errors = createErrorList();
  const base = `$[${index}]`;
  if (!isObject(unit)) return [`${base}: expected object`];

  for (const field of REQUIRED_FIELDS) {
    if (!hasOwn(unit, field)) errors.push(`${base}: missing required field ${safeQuote(field)}`);
  }
  for (const field of ["surface", "boundary", "subsystem", "attack_class"]) {
    if (!isVisibleText(unit[field])) errors.push(`${base}.${field}: invalid text`);
  }
  if (hasOwn(unit, "lifecycle") && !isVisibleText(unit.lifecycle)) errors.push(`${base}.lifecycle: invalid text`);

  let expectedId = null;
  if (!isObject(unit.canonical_refs)) {
    errors.push(`${base}.canonical_refs: expected object`);
  } else {
    const expectedFields = hasOwn(unit.canonical_refs, "lifecycle") ? [...REF_FIELDS, "lifecycle"] : REF_FIELDS;
    for (const field of expectedFields) {
      if (!hasOwn(unit.canonical_refs, field)) {
        errors.push(`${base}.canonical_refs: missing required field ${safeQuote(field)}`);
      } else if (!isCanonicalRef(unit.canonical_refs[field])) {
        errors.push(`${base}.canonical_refs.${field}: invalid canonical reference`);
      }
    }
    if (Object.keys(unit.canonical_refs).some((field) => !expectedFields.includes(field))) {
      errors.push(`${base}.canonical_refs: contains unexpected fields`);
    }
    if (hasOwn(unit, "lifecycle") !== hasOwn(unit.canonical_refs, "lifecycle")) {
      errors.push(`${base}: lifecycle and canonical_refs.lifecycle must appear together`);
    }
    try {
      expectedId = canonicalCoverageId(unit.canonical_refs);
    } catch {
      // The specific reference errors above are more useful.
    }
  }
  if (!isVisibleText(unit.coverage_id, 65536)) {
    errors.push(`${base}.coverage_id: invalid text`);
  } else if (expectedId !== null && unit.coverage_id !== expectedId) {
    errors.push(`${base}.coverage_id: expected canonical ID ${safeQuote(expectedId)}`);
  }

  validateStringArray(unit.starting_paths, `${base}.starting_paths`, errors, { allowEmpty: false, pathValue: true });
  if (unit.ordinary_attack_class_block !== null && !isVisibleText(unit.ordinary_attack_class_block)) {
    errors.push(`${base}.ordinary_attack_class_block: expected null or non-empty text`);
  }
  validateStringArray(unit.selected_companion_blocks, `${base}.selected_companion_blocks`, errors);
  validateExcludedBlocks(unit.excluded_blocks, `${base}.excluded_blocks`, errors);
  if (Array.isArray(unit.selected_companion_blocks) && Array.isArray(unit.excluded_blocks)) {
    const selected = new Set(unit.selected_companion_blocks);
    unit.excluded_blocks.forEach((entry, blockIndex) => {
      if (isObject(entry) && selected.has(entry.block)) {
        errors.push(`${base}.excluded_blocks[${blockIndex}].block: block is also selected`);
      }
    });
  }

  if (!PRIOR_STATUSES.has(unit.prior_status)) errors.push(`${base}.prior_status: invalid value ${safeQuote(unit.prior_status)}`);
  if (!STATUSES.has(unit.status)) errors.push(`${base}.status: invalid value ${safeQuote(unit.status)}`);
  if (!Number.isInteger(unit.wave) || unit.wave < 1) errors.push(`${base}.wave: expected a positive integer`);
  if (unit.agent_id !== null && !isSafeAgentId(unit.agent_id)) errors.push(`${base}.agent_id: expected null or a safe agent ID`);

  validateAttempts(unit.attempts, unit, base, errors);
  validateStringArray(unit.reviewed_paths, `${base}.reviewed_paths`, errors, { pathValue: true });
  validateChecks(unit.local_checks, `${base}.local_checks`, errors);
  validateReviewedPathOwnership(unit, base, errors);
  validateStringArray(unit.result_fingerprints, `${base}.result_fingerprints`, errors, { fingerprint: true });
  validateStringArray(unit.unresolved, `${base}.unresolved`, errors);

  validateStateInvariants(unit, base, errors);

  return errors;
}

function validateDocument(ledger) {
  const errors = createErrorList();
  if (!Array.isArray(ledger)) {
    errors.push("$: expected a top-level array");
    return errors;
  }
  if (ledger.length > MAX_UNITS) {
    errors.push(`$: exceeds ${MAX_UNITS} coverage units`);
    return errors;
  }

  errors.push(...preflightDocument(ledger));
  if (errors.length > 0) return errors;

  const ids = new Map();
  const semantics = new Map();
  let previousId = null;
  for (let index = 0; index < ledger.length && errors.length < LIMITS.validationErrors; index++) {
    const unit = ledger[index];
    errors.push(...collectUnitErrors(unit, index));
    if (errors.length >= LIMITS.validationErrors) break;
    if (!isObject(unit) || typeof unit.coverage_id !== "string") continue;

    const key = hasValidSemanticFields(unit) ? semanticKey(unit) : null;
    if (ids.has(unit.coverage_id)) {
      const previous = ids.get(unit.coverage_id);
      const qualifier = key !== null && previous.key !== null && previous.key !== key
        ? "canonical identity collision with different semantic fields"
        : "duplicate coverage ID";
      errors.push(`$[${index}].coverage_id: ${qualifier} at $[${previous.index}]`);
    } else {
      ids.set(unit.coverage_id, { index, key });
    }
    if (key !== null && semantics.has(key) && semantics.get(key).id !== unit.coverage_id) {
      const previous = semantics.get(key);
      errors.push(`$[${index}].canonical_refs: semantic tuple already uses coverage ID ${safeQuote(previous.id)} at $[${previous.index}]`);
    } else if (key !== null) {
      semantics.set(key, { id: unit.coverage_id, index });
    }
    if (previousId !== null && previousId > unit.coverage_id) {
      errors.push(`$[${index}].coverage_id: units must be sorted lexicographically`);
    }
    previousId = unit.coverage_id;
  }
  return errors;
}


module.exports = { validateDocument };
