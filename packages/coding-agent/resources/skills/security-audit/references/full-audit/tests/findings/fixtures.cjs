const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const schema = require("../../report-schema.json");
const {
  LIMITS,
  collect,
  collectSchemaErrors,
  validateDocument,
} = require("../../validate-findings.cjs");

const validatorPath = path.join(__dirname, "../../validate-findings.cjs");
const CLI_TIMEOUT_MS = 5000;
const HOSTILE_CLI_TIMEOUT_MS = 15000;
const HAS_SAFE_INPUT_OPEN = Number.isInteger(fs.constants.O_NOFOLLOW) &&
  fs.constants.O_NOFOLLOW !== 0 &&
  Number.isInteger(fs.constants.O_NONBLOCK) &&
  fs.constants.O_NONBLOCK !== 0;
const TERMINAL_CONTROL_PAYLOAD = "\u001b\u0007\u0085\u202e\u034f\ufe0f";
const TERMINAL_CONTROL_BYTES = [
  Buffer.from([0x1b]),
  Buffer.from([0x07]),
  Buffer.from("\u0085"),
  Buffer.from("\u202e"),
  Buffer.from("\u034f"),
  Buffer.from("\ufe0f"),
];

function source(kind = "entrypoint", file = "src/handler.c", line = 10) {
  return { kind, file, line, scope: "handle", description: "Attacker data reaches the operation." };
}

function evidence(file = "src/handler.c", line = 10) {
  return { file, line, description: "The source performs the operation without the required check." };
}

function confirmed() {
  return {
    verdict: "confirmed",
    fingerprint: "src-handler-missing-check",
    title: "Missing ownership check",
    description: "An attacker can reach an operation without the intended ownership check.",
    root_cause: "handle omits the ownership check before changing the object.",
    intended_behavior: "Only the object's owner can change it.",
    trace: [source("entrypoint"), source("propagation", "src/model.c", 20), source("sink", "src/store.c", 30)],
    evidence: [evidence()],
    conditions: [],
    execution: {
      attacker_perspective: "An unprivileged remote user with their own account.",
      payloads: ["An object identifier owned by another user."],
      instructions: ["Submit the identifier through the public operation."],
      observed_result: "The other user's object changes.",
    },
    remediation: { strategy: "Check ownership before the state change." },
    severity: {
      likelihood: { score: "medium", reason: "The operation is directly reachable." },
      impact: { score: "medium", reason: "The attacker changes one protected object." },
      overall_severity: "medium",
    },
    confidence: { score: "high", reason: "The source path and result were reproduced." },
  };
}

function needsValidation() {
  return {
    verdict: "needs_validation",
    fingerprint: "src-parser-size-hypothesis",
    title: "Unchecked parsed size",
    description: "A parsed size may reach an allocation without a limit.",
    claimed_root_cause: "parse_size may pass an unbounded value to allocate.",
    trace: [source()],
    evidence: [evidence()],
    blockers: ["The generated parser source is absent from this checkout."],
    validation_plan: {
      local: "Generate the parser and submit the smallest input that exceeds the documented limit.",
      deployment: "In an approved test deployment, confirm the request reaches the generated parser and record the bounded observable result.",
    },
  };
}

function rejected() {
  return {
    verdict: "rejected",
    fingerprint: "src-router-auth-bypass",
    title: "Authorization bypass in router",
    description: "The candidate claimed a route bypassed authorization.",
    claimed_root_cause: "dispatch was claimed to skip the authorization wrapper.",
    trace: [source("sink")],
    evidence: [evidence()],
    reason: "All routes pass through the authorization wrapper before dispatch.",
  };
}

function errorsFor(value) {
  return validateDocument(value, schema);
}

function runCli(contents, options = {}) {
  const { nodeArgs = [], timeout = CLI_TIMEOUT_MS } = options;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "validate-findings-"));
  const findingsPath = path.join(directory, "findings.json");
  try {
    fs.writeFileSync(findingsPath, contents);
    return spawnSync(process.execPath, [...nodeArgs, validatorPath, findingsPath], {
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

function assertNoInjectedControlBytes(output) {
  const bytes = Buffer.isBuffer(output) ? output : Buffer.from(output, "utf8");
  for (const marker of TERMINAL_CONTROL_BYTES) {
    assert.equal(bytes.indexOf(marker), -1, `found raw control bytes ${marker.toString("hex")}`);
  }
}

function producerShapedFindings() {
  const demonstrated = confirmed();
  demonstrated.conditions = [{
    kind: "authentication_level",
    description: "The attacker needs a normal account.",
  }];
  demonstrated.execution.payloads = ["", " \t\r\n", "\u0000\u001f\u007f", "\u034f", "\ufe0f", "\ud800", "\udc00", "[{,}]\\\""];
  demonstrated.remediation.code_changes = [{
    file_name: "src/handler.c",
    fixed_code: "",
  }];

  const blocked = needsValidation();
  delete blocked.validation_plan.deployment;

  return [demonstrated, blocked, rejected()];
}

function rejectMutation(factory, mutate) {
  const value = factory();
  mutate(value);
  assert.notEqual(errorsFor([value]).length, 0);
}


module.exports = { assert, fs, os, path, test, schema, validatorPath, CLI_TIMEOUT_MS, HOSTILE_CLI_TIMEOUT_MS, HAS_SAFE_INPUT_OPEN, TERMINAL_CONTROL_PAYLOAD, TERMINAL_CONTROL_BYTES, source, evidence, confirmed, needsValidation, rejected, errorsFor, runCli, cliOutput, assertNoInjectedControlBytes, producerShapedFindings, rejectMutation, LIMITS, collect, collectSchemaErrors, validateDocument, spawnSync };
