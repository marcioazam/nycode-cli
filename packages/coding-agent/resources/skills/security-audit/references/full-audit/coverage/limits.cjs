
// Conservative bounds apply before JSON.parse and again to the parsed document.
const LIMITS = Object.freeze({
  inputBytes: 5 * 1024 * 1024,
  units: 10000,
  collectionItems: 1000,
  objectFields: 1000,
  nestingDepth: 64,
  preflightValues: 500000,
  validationErrors: 100,
});
const MAX_INPUT_BYTES = LIMITS.inputBytes;
const MAX_UNITS = LIMITS.units;
const MAX_LIST_ITEMS = LIMITS.collectionItems;
const MAX_TEXT_LENGTH = 4096;
const REQUIRED_FIELDS = [
  "coverage_id",
  "canonical_refs",
  "surface",
  "boundary",
  "subsystem",
  "attack_class",
  "starting_paths",
  "ordinary_attack_class_block",
  "selected_companion_blocks",
  "excluded_blocks",
  "prior_status",
  "attempts",
  "wave",
  "status",
  "agent_id",
  "reviewed_paths",
  "local_checks",
  "result_fingerprints",
  "unresolved",
];
const REF_FIELDS = ["surface", "boundary", "subsystem", "attack_class"];
const STATUSES = new Set([
  "planned",
  "not_applicable",
  "out_of_scope",
  "in_progress",
  "covered",
  "candidate",
  "blocked",
  "deferred",
]);
const ATTEMPT_STATUSES = new Set(["covered", "candidate", "blocked"]);
const ATTEMPT_FIELDS = [
  "wave",
  "status",
  "agent_id",
  "reviewed_paths",
  "local_checks",
  "result_fingerprints",
  "unresolved",
  "reassignment_reason",
];
const PRIOR_STATUSES = new Set([
  "new",
  "prior_confirmed_same_source",
  "prior_confirmed_changed_source",
  "prior_needs_validation",
  "prior_deferred",
  "prior_blocked",
  "prior_out_of_scope",
  "prior_covered_same_source",
  "prior_covered_changed_source",
  "prior_rejected_claim_changed",
  "none",
]);
const FINGERPRINT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;
const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const WINDOWS_RESERVED_AGENT_ID = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

module.exports = { LIMITS, MAX_INPUT_BYTES, MAX_UNITS, MAX_LIST_ITEMS, MAX_TEXT_LENGTH, REQUIRED_FIELDS, REF_FIELDS, STATUSES, ATTEMPT_STATUSES, ATTEMPT_FIELDS, PRIOR_STATUSES, FINGERPRINT_PATTERN, AGENT_ID_PATTERN, WINDOWS_RESERVED_AGENT_ID };
