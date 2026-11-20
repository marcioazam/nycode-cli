const { assert, test, unit, errorsFor, sourceCheck, localCheck, archivedAttempt } = require("./fixtures.cjs");

test("enforces state evidence", () => {
  assert(errorsFor([unit({ status: "in_progress" })]).some((error) => error.includes("unit with status \"in_progress\" requires")));
  assert(errorsFor([unit({ status: "blocked" })]).some((error) => error.includes("unresolved")));
  assert(errorsFor([unit({ status: "candidate" })]).some((error) => error.includes("reviewed_paths")));

  assert.deepEqual(errorsFor([unit({ status: "in_progress", agent_id: "hunter-1" })]), []);
  const inProgressEvidence = unit({
    status: "in_progress",
    agent_id: "hunter-1",
    reviewed_paths: ["src/router.ts"],
    local_checks: [sourceCheck()],
  });
  assert(errorsFor([inProgressEvidence]).some((error) => error.includes("must keep this array empty")));

  const assignedPlanned = unit({
    agent_id: "hunter-1",
    reviewed_paths: ["src/router.ts"],
    local_checks: [sourceCheck()],
  });
  assert(errorsFor([assignedPlanned]).some((error) => error.includes("planned unit must be unassigned")));

  const candidate = unit({
    status: "candidate",
    agent_id: "hunter-1",
    reviewed_paths: ["src/router.ts"],
    local_checks: [sourceCheck("hunter-1", { invariant: "Ownership is required.", result: "No check exists." })],
    result_fingerprints: ["src-router-missing-owner-check"],
    unresolved: ["validation_budget_exhausted"],
  });
  assert.deepEqual(errorsFor([candidate]), []);

  const blocked = unit({
    status: "blocked",
    agent_id: "hunter-1",
    reviewed_paths: ["src/router.ts"],
    local_checks: [sourceCheck()],
    unresolved: ["The deployed policy is unavailable."],
  });
  assert.deepEqual(errorsFor([blocked]), []);
  const blockedFingerprint = { ...blocked, result_fingerprints: ["forbidden-fingerprint"] };
  assert(errorsFor([blockedFingerprint]).some((error) => error.includes("result_fingerprints")));

  for (const status of ["not_applicable", "out_of_scope", "deferred"]) {
    assert.deepEqual(errorsFor([unit({ status, unresolved: ["Reason recorded."] })]), []);
    const invalid = unit({
      status,
      agent_id: "hunter-1",
      reviewed_paths: ["src/router.ts"],
      local_checks: [sourceCheck()],
      result_fingerprints: ["forbidden-fingerprint"],
      unresolved: ["Reason recorded."],
    });
    const errors = errorsFor([invalid]);
    assert(errors.some((error) => error.includes("must be unassigned")), status);
    assert(errors.some((error) => error.includes("reviewed_paths")), status);
    assert(errors.some((error) => error.includes("result_fingerprints")), status);
  }

  const coveredFingerprint = unit({
    status: "covered",
    agent_id: "hunter-1",
    reviewed_paths: ["src/router.ts"],
    local_checks: [sourceCheck()],
    result_fingerprints: ["forbidden-fingerprint"],
  });
  assert(errorsFor([coveredFingerprint]).some((error) => error.includes("result_fingerprints")));

  const coveredUnresolved = unit({
    status: "covered",
    agent_id: "hunter-1",
    reviewed_paths: ["src/router.ts"],
    local_checks: [sourceCheck()],
    unresolved: ["Unexpected unresolved claim."],
  });
  assert(errorsFor([coveredUnresolved]).some((error) => error.includes("unresolved")));
});

test("archives prior evidence when a critic assigns a fresh owner", () => {
  const reassigned = unit({
    attempts: [archivedAttempt()],
    wave: 2,
    status: "in_progress",
    agent_id: "hunter-2",
  });
  assert.deepEqual(errorsFor([reassigned]), []);

  const finalClosure = unit({
    attempts: [archivedAttempt()],
    wave: 2,
    status: "covered",
    agent_id: "hunter-2",
    reviewed_paths: ["src/authz.ts"],
    local_checks: [sourceCheck("hunter-2", { reviewed_paths: ["src/authz.ts"] })],
  });
  assert.deepEqual(errorsFor([finalClosure]), []);
});

test("preserves candidate provenance when reassignment must be deferred", () => {
  const candidateAttempt = archivedAttempt({
    status: "candidate",
    result_fingerprints: ["src-router-missing-owner-check"],
    unresolved: ["validation_budget_exhausted"],
  });
  const deferred = unit({
    attempts: [candidateAttempt],
    wave: 2,
    status: "deferred",
    unresolved: ["quick_profile_final_critic"],
  });
  assert.deepEqual(errorsFor([deferred]), []);
});

test("rejects reassignment owner reuse and evidence mixing", () => {
  const reusedOwner = unit({
    attempts: [archivedAttempt()],
    wave: 2,
    status: "in_progress",
    agent_id: "hunter-1",
  });
  assert(errorsFor([reusedOwner]).some((error) => error.includes("current assignment owner must be fresh")));

  const mixedEvidence = unit({
    attempts: [archivedAttempt({ local_checks: [localCheck()] })],
    wave: 2,
    status: "covered",
    agent_id: "hunter-2",
    reviewed_paths: ["src/router.ts"],
    local_checks: [localCheck()],
  });
  const errors = errorsFor([mixedEvidence]);
  assert(errors.some((error) => error.includes("prior assignment owner evidence must remain")));
  assert(errors.some((error) => error.includes("artifact from an archived attempt cannot be reused")));

  const mixedHistory = unit({
    attempts: [
      archivedAttempt({ local_checks: [localCheck()] }),
      archivedAttempt({
        wave: 2,
        agent_id: "hunter-2",
        local_checks: [localCheck()],
      }),
    ],
    wave: 3,
    status: "in_progress",
    agent_id: "hunter-3",
  });
  const historyErrors = errorsFor([mixedHistory]);
  assert(historyErrors.some((error) => error.includes("prior assignment owner evidence must remain in its earlier attempt")));
  assert(historyErrors.some((error) => error.includes("artifact from an earlier attempt cannot be reused")));

  const unordered = unit({
    attempts: [archivedAttempt(), archivedAttempt({
      wave: 1,
      agent_id: "hunter-2",
      local_checks: [sourceCheck("hunter-2")],
    })],
    wave: 3,
    status: "in_progress",
    agent_id: "hunter-3",
  });
  assert(errorsFor([unordered]).some((error) => error.includes("strictly increasing")));
});

