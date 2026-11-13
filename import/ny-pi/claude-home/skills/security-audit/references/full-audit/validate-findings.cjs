#!/usr/bin/env node

/**
 * Validates findings.json against report-schema.json.
 * Usage: node validate-findings.cjs <path-to-findings.json>
 *
 * This is a dependency-free interpreter for the JSON Schema keywords used by
 * report-schema.json, plus finding-specific checks that are clearer in code.
 */

const path = require("node:path");
const { VISIBLE_CONTENT, PATH_FORBIDDEN_CHARACTER, WINDOWS_RESERVED_COMPONENT, UNSAFE_DIAGNOSTIC_CHARACTER, escapeUnsafeDiagnosticCharacters, hasVisibleProse } = require("./shared/safe-text.cjs");
const { LIMITS } = require("./findings/limits.cjs");
const { collect, collectSchemaErrors } = require("./findings/schema.cjs");
const { collectFindingSemanticErrors, isSafeRelativeSourcePath } = require("./findings/semantics.cjs");
const { validateDocument, loadSchema } = require("./findings/document.cjs");
const { enforceJsonTextLimits } = require("./findings/json-text.cjs");
const { JsonStructureError, SafeInputError, readFileWithinLimit: readSafeInput } = require("./shared/safe-input.cjs");
const readFileWithinLimit = (file) => readSafeInput(file, LIMITS.inputBytes);

function run(file) {
  if (!file) {
    console.error("Usage: node validate-findings.cjs <path-to-findings.json>");
    return 1;
  }

  let schema;
  try {
    schema = loadSchema(path.join(__dirname, "report-schema.json"));
  } catch (error) {
    console.error("Failed to load report-schema.json:", error.message);
    return 1;
  }

  let contents;
  try {
    contents = readFileWithinLimit(file);
  } catch (error) {
    const reason = error instanceof SafeInputError ? error.message : "input could not be opened or read safely";
    console.error(`Failed to read findings JSON: ${reason}`);
    return 1;
  }

  try {
    enforceJsonTextLimits(contents);
  } catch (error) {
    const reason = error instanceof JsonStructureError ? error.message : "invalid JSON structure";
    console.error(`Failed to parse findings JSON: ${reason}`);
    return 1;
  }

  let findings;
  try {
    findings = JSON.parse(contents);
  } catch {
    console.error("Failed to parse findings JSON: invalid JSON syntax");
    return 1;
  }

  let errors;
  try {
    errors = validateDocument(findings, schema);
  } catch {
    console.error("Failed to validate findings JSON: unexpected validation error");
    return 1;
  }
  for (const message of errors) console.error("ERROR:", escapeUnsafeDiagnosticCharacters(message));
  if (errors.length > 0) {
    const cap = errors.length === LIMITS.validationErrors ? `; output capped at ${LIMITS.validationErrors}` : "";
    console.error(`FAIL: ${errors.length} validation error(s)${cap}`);
    return 1;
  }
  console.log(`PASS: ${findings.length} findings valid`);
  return 0;
}

module.exports = {
  LIMITS,
  PATH_FORBIDDEN_CHARACTER,
  UNSAFE_DIAGNOSTIC_CHARACTER,
  VISIBLE_CONTENT,
  WINDOWS_RESERVED_COMPONENT,
  collect,
  collectFindingSemanticErrors,
  collectSchemaErrors,
  hasVisibleProse,
  isSafeRelativeSourcePath,
  validateDocument,
};

if (require.main === module) process.exit(run(process.argv[2]));

