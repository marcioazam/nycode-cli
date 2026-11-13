const { assert, path, test, unit, errorsFor, sourceCheck, localCheck, isSafeRelativePath } = require("./fixtures.cjs");

test("validates assignment block maps", () => {
  const overlap = unit({
    selected_companion_blocks: ["AI-AND-LLM.md#Tool calls"],
    excluded_blocks: [{ block: "AI-AND-LLM.md#Tool calls", reason: "Claimed irrelevant." }],
  });
  assert(errorsFor([overlap]).some((error) => error.includes("also selected")));

  const noReason = unit({ excluded_blocks: [{ block: "AI-AND-LLM.md#Tool calls", reason: "" }] });
  assert(errorsFor([noReason]).some((error) => error.includes("reason")));
});

test("requires owned artifacts for local checks and null artifacts for source checks", () => {
  const local = unit({
    status: "covered",
    agent_id: "hunter-1",
    reviewed_paths: ["src/router.ts"],
    local_checks: [localCheck()],
  });
  assert.deepEqual(errorsFor([local]), []);

  const independentlyVerified = unit({
    status: "covered",
    agent_id: "hunter-1",
    reviewed_paths: ["src/router.ts", "src/authz.ts"],
    local_checks: [sourceCheck(), localCheck("verifier-1", { reviewed_paths: ["src/authz.ts"] })],
  });
  assert.deepEqual(errorsFor([independentlyVerified]), []);

  const unownedPath = unit({
    status: "covered",
    agent_id: "hunter-1",
    reviewed_paths: ["src/router.ts", "src/authz.ts"],
    local_checks: [sourceCheck()],
  });
  assert(errorsFor([unownedPath]).some((error) => error.includes("has no check owner")));

  for (const [checkAgentId, artifact] of [
    [null, "agents/hunter-1/artifacts/result.txt"],
    ["hunter-1", null],
    ["hunter-1", "result.txt"],
    ["hunter-1", "agents/hunter-2/artifacts/result.txt"],
    ["../hunter", "agents/../hunter/artifacts/result.txt"],
  ]) {
    const value = unit({
      status: "covered",
      agent_id: "hunter-1",
      reviewed_paths: ["src/router.ts"],
      local_checks: [localCheck(checkAgentId, { artifact })],
    });
    assert.notEqual(errorsFor([value]).length, 0, `${checkAgentId}: ${artifact}`);
  }

  const unownedSource = unit({
    status: "blocked",
    reviewed_paths: ["src/router.ts"],
    local_checks: [sourceCheck()],
    unresolved: ["The boundary behavior is not source-visible."],
  });
  assert(errorsFor([unownedSource]).some((error) => error.includes("unit with status \"blocked\" requires a canonical lowercase agent ID")));

  const sourceWithArtifact = unit({
    status: "covered",
    agent_id: "hunter-1",
    reviewed_paths: ["src/router.ts"],
    local_checks: [sourceCheck("hunter-1", { artifact: "agents/hunter-1/artifacts/source.txt" })],
  });
  assert(errorsFor([sourceWithArtifact]).some((error) => error.includes("source-only check must use null")));
});

test("rejects unsafe paths and malformed fingerprints", () => {
  for (const value of [
    "/etc/passwd",
    "../src/file.js",
    "src/../file.js",
    "src/con.txt",
    "src/PRN",
    "src/AUX.c",
    "src/NUL",
    "src/CLOCK$.txt",
    "src/conin$.txt",
    "src/conout$",
    "src/COM1.log",
    "src/lpt9",
    "src/COM\u00b9.log",
    "src/COM\u00b2.log",
    "src/COM\u00b3.log",
    "src/lpt\u00b9",
    "src/lpt\u00b2",
    "src/lpt\u00b3",
    "src/file.js.",
    "C:/src/file.js",
    "src/file\n.js",
    "src/file\u0085.js",
    "src/file\u2028.js",
    "src/file\u200b.js",
    "src/file\u034f.js",
    "src/file\ufe0f.js",
  ]) {
    assert.equal(isSafeRelativePath(value), false, value);
  }
  assert.equal(isSafeRelativePath("src/handler.js"), true);
  assert.equal(isSafeRelativePath("src/caf\u00e9/handler.js"), true);
  assert(errorsFor([unit({ starting_paths: ["../src/router.ts"] })]).some((error) => error.includes("repository-relative path")));
  assert(errorsFor([unit({
    status: "candidate",
    agent_id: "hunter-1",
    reviewed_paths: ["src/router.ts"],
    local_checks: [sourceCheck("hunter-1", { invariant: "Ownership is required.", result: "No check exists." })],
    result_fingerprints: ["not stable"],
  })]).some((error) => error.includes("invalid fingerprint")));
});

