const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  LIMITS,
  canonicalCoverageId,
  encodeCanonicalRef,
  isSafeAgentId,
  isSafeRelativePath,
  preflightJsonText,
  validateDocument,
} = require("../../validate-coverage-ledger.cjs");

const validatorPath = path.join(__dirname, "../../validate-coverage-ledger.cjs");
const CLI_TIMEOUT_MS = 5000;
const HOSTILE_CLI_TIMEOUT_MS = 15000;
const HAS_SAFE_INPUT_OPEN = Number.isInteger(fs.constants.O_NOFOLLOW) &&
  fs.constants.O_NOFOLLOW !== 0 &&
  Number.isInteger(fs.constants.O_NONBLOCK) &&
  fs.constants.O_NONBLOCK !== 0;

function unit(overrides = {}) {
  const canonicalRefs = overrides.canonical_refs || {
    surface: "src/router.ts#POST /users/:id",
    boundary: "src/authz.ts#requireOwner",
    subsystem: "packages/api",
    attack_class: "ATTACK-CLASSES.md#Access control",
  };
  const value = {
    coverage_id: canonicalCoverageId(canonicalRefs),
    canonical_refs: canonicalRefs,
    surface: "Update-user route",
    boundary: "Object ownership",
    subsystem: "API",
    attack_class: "Access control",
    starting_paths: ["src/router.ts", "src/authz.ts"],
    ordinary_attack_class_block: "ATTACK-CLASSES.md#Access control",
    selected_companion_blocks: [],
    excluded_blocks: [{ block: "WEB-PROTOCOL-AND-AUTH.md#Cache behavior", reason: "The route is not cached." }],
    prior_status: "new",
    attempts: [],
    wave: 1,
    status: "planned",
    agent_id: null,
    reviewed_paths: [],
    local_checks: [],
    result_fingerprints: [],
    unresolved: [],
  };
  return Object.assign(value, overrides, { canonical_refs: canonicalRefs });
}

function errorsFor(value) {
  return validateDocument(value);
}

function runCli(contents, options = {}) {
  const { nodeArgs = [], timeout = CLI_TIMEOUT_MS } = options;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "validate-coverage-ledger-"));
  const ledgerPath = path.join(directory, "coverage-ledger.json");
  try {
    fs.writeFileSync(ledgerPath, contents);
    return spawnSync(process.execPath, [...nodeArgs, validatorPath, ledgerPath], {
      encoding: "utf8",
      timeout,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function cliOutput(result) {
  return `${result.stdout}${result.stderr}`;
}

const TERMINAL_CONTROL_PAYLOAD = "\u001b\u0007\u0085\u202e";
const TERMINAL_CONTROL_BYTES = [
  Buffer.from([0x1b]),
  Buffer.from([0x07]),
  Buffer.from("\u0085"),
  Buffer.from("\u202e"),
];

function assertNoInjectedControlBytes(output) {
  const bytes = Buffer.isBuffer(output) ? output : Buffer.from(output, "utf8");
  for (const marker of TERMINAL_CONTROL_BYTES) {
    assert.equal(bytes.indexOf(marker), -1, `found raw control bytes ${marker.toString("hex")}`);
  }
}

function sourceCheck(agentId = "hunter-1", overrides = {}) {
  return {
    agent_id: agentId,
    reviewed_paths: ["src/router.ts"],
    invariant: "The route checks object ownership.",
    method: "source",
    result: "The owner check applies before the update.",
    artifact: null,
    ...overrides,
  };
}

function localCheck(agentId = "hunter-1", overrides = {}) {
  return sourceCheck(agentId, {
    method: "local",
    result: "The bounded fixture accepted the other owner's object.",
    artifact: `agents/${agentId}/artifacts/result.txt`,
    ...overrides,
  });
}

function archivedAttempt(overrides = {}) {
  const value = {
    wave: 1,
    status: "blocked",
    agent_id: "hunter-1",
    reviewed_paths: ["src/router.ts"],
    local_checks: [sourceCheck()],
    result_fingerprints: [],
    unresolved: ["The deployed policy is unavailable."],
    reassignment_reason: "The critic found an unchecked parallel path.",
  };
  return Object.assign(value, overrides);
}


module.exports = { assert, fs, os, path, test, validatorPath, CLI_TIMEOUT_MS, HOSTILE_CLI_TIMEOUT_MS, HAS_SAFE_INPUT_OPEN, unit, errorsFor, runCli, cliOutput, TERMINAL_CONTROL_PAYLOAD, TERMINAL_CONTROL_BYTES, assertNoInjectedControlBytes, sourceCheck, localCheck, archivedAttempt, LIMITS, canonicalCoverageId, encodeCanonicalRef, isSafeAgentId, isSafeRelativePath, preflightJsonText, validateDocument, spawnSync };
