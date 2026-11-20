#!/usr/bin/env node

/**
 * Validates coverage-ledger.json and its canonical coverage IDs.
 * Usage: node validate-coverage-ledger.cjs <path-to-coverage-ledger.json>
 */

const { VISIBLE_CONTENT, PATH_FORBIDDEN_CHARACTER, WINDOWS_RESERVED_COMPONENT, UNSAFE_DIAGNOSTIC_CHARACTER, safeQuote, hasVisibleProse, isSafeRelativePath } = require("./shared/safe-text.cjs");
const { LIMITS } = require("./coverage/limits.cjs");
const { canonicalCoverageId, encodeCanonicalRef, isSafeAgentId } = require("./coverage/identity.cjs");
const { preflightJsonText } = require("./coverage/preflight.cjs");
const { validateDocument } = require("./coverage/document.cjs");
const { JsonStructureError, SafeInputError, readFileWithinLimit: readSafeInput } = require("./shared/safe-input.cjs");
const readFileWithinLimit = (file) => readSafeInput(file, LIMITS.inputBytes);

function run(file) {
  if (!file) {
    console.error("Usage: node validate-coverage-ledger.cjs <path-to-coverage-ledger.json>");
    return 1;
  }

  let contents;
  try {
    contents = readFileWithinLimit(file);
  } catch (error) {
    const reason = error instanceof SafeInputError ? error.message : "input could not be opened or read safely";
    console.error(`Failed to read coverage ledger: ${reason}`);
    return 1;
  }

  let ledger;
  try {
    preflightJsonText(contents);
  } catch (error) {
    const reason = error instanceof JsonStructureError ? error.message : "invalid JSON structure";
    console.error(`Failed to parse coverage ledger: ${reason}`);
    return 1;
  }
  try {
    ledger = JSON.parse(contents);
  } catch {
    console.error("Failed to parse coverage ledger: invalid JSON syntax");
    return 1;
  }

  let errors;
  try {
    errors = validateDocument(ledger);
  } catch {
    console.error("Failed to validate coverage ledger: unexpected validation error");
    return 1;
  }
  for (const message of errors) console.error("ERROR:", message);
  if (errors.length > 0) {
    const cap = errors.length === LIMITS.validationErrors ? `; output capped at ${LIMITS.validationErrors}` : "";
    console.error(`FAIL: ${errors.length} validation error(s)${cap}`);
    return 1;
  }
  console.log(`PASS: ${ledger.length} coverage units valid`);
  return 0;
}

module.exports = {
  LIMITS,
  PATH_FORBIDDEN_CHARACTER,
  UNSAFE_DIAGNOSTIC_CHARACTER,
  VISIBLE_CONTENT,
  WINDOWS_RESERVED_COMPONENT,
  canonicalCoverageId,
  encodeCanonicalRef,
  hasVisibleProse,
  isSafeAgentId,
  isSafeRelativePath,
  preflightJsonText,
  readFileWithinLimit,
  safeQuote,
  validateDocument,
};

if (require.main === module) process.exit(run(process.argv[2]));

