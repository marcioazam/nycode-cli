const { assert, test, HAS_SAFE_INPUT_OPEN, unit, errorsFor, runCli, cliOutput, TERMINAL_CONTROL_PAYLOAD, assertNoInjectedControlBytes, sourceCheck, canonicalCoverageId, encodeCanonicalRef, isSafeAgentId } = require("./fixtures.cjs");

test("accepts an empty ledger and complete units", () => {
  assert.deepEqual(errorsFor([]), []);
  assert.deepEqual(errorsFor([unit()]), []);

  const missingAttempts = unit();
  delete missingAttempts.attempts;
  assert(errorsFor([missingAttempts]).some((error) => error.includes('missing required field "attempts"')));

  const covered = unit({
    status: "covered",
    agent_id: "hunter-1",
    reviewed_paths: ["src/router.ts"],
    local_checks: [sourceCheck()],
  });
  assert.deepEqual(errorsFor([covered]), []);
});

test("derives collision-free canonical IDs from exact UTF-8 references", () => {
  assert.equal(encodeCanonicalRef("route:POST /users"), "route%3APOST%20%2Fusers");
  assert.notEqual(encodeCanonicalRef("route name"), encodeCanonicalRef("route-name"));
  assert.equal(
    canonicalCoverageId({ surface: "a", boundary: "b", subsystem: "c", attack_class: "d", lifecycle: "retry" }),
    "a::b::c::d::retry",
  );
  assert.throws(() => encodeCanonicalRef("e\u0301"), /invalid canonical reference/);
  assert.throws(() => encodeCanonicalRef("bad\u0000ref"), /invalid canonical reference/);
  assert.throws(() => encodeCanonicalRef("hidden\u200bref"), /invalid canonical reference/);
});

test("rejects noncanonical, duplicate, and colliding IDs", () => {
  const wrong = unit({ coverage_id: "display-label-slug" });
  assert(errorsFor([wrong]).some((error) => error.includes("expected canonical ID")));

  const duplicate = unit();
  assert(errorsFor([duplicate, unit()]).some((error) => error.includes("duplicate coverage ID")));

  const collision = unit();
  const differentMeaning = unit({ surface: "Delete-user route" });
  assert(errorsFor([collision, differentMeaning]).some((error) => error.includes("canonical identity collision")));
});

test("requires canonical references to be own properties", () => {
  const inherited = Object.create(unit().canonical_refs);
  const value = unit();
  value.canonical_refs = inherited;
  assert(errorsFor([value]).some((error) => error.includes("missing required field")));
});

test("rejects aliases for one semantic tuple", () => {
  const first = unit();
  const refs = { ...first.canonical_refs, surface: "src/alias.ts#updateUser" };
  const alias = unit({ canonical_refs: refs });
  const ledger = [first, alias].sort((left, right) => left.coverage_id.localeCompare(right.coverage_id));
  assert(errorsFor(ledger).some((error) => error.includes("semantic tuple already uses coverage ID")));
});

test("requires lexicographic order", () => {
  const secondRefs = {
    surface: "zzz",
    boundary: "src/authz.ts#requireOwner",
    subsystem: "packages/api",
    attack_class: "ATTACK-CLASSES.md#Access control",
  };
  assert(errorsFor([unit({ canonical_refs: secondRefs }), unit()])
    .some((error) => error.includes("sorted lexicographically")));
});

test("requires canonical lowercase filesystem-safe agent IDs", () => {
  for (const value of ["hunter-1", "verifier_2", "a0"]) assert.equal(isSafeAgentId(value), true, value);
  for (const value of ["Hunter-1", "hunter.1", "hunter-1.", "hunter ", "con", "prn", "aux", "nul", "com1", "lpt9", "../hunter"]) {
    assert.equal(isSafeAgentId(value), false, value);
  }

  const caseAlias = unit({ status: "in_progress", agent_id: "Hunter-1" });
  assert(errorsFor([caseAlias]).some((error) => error.includes("canonical lowercase agent ID")));
});

test("rejects format, default-ignorable, and invalid-scalar prose", () => {
  for (const invisible of ["\u200b", "\u034f", "\ufe0f", "\ud800"]) {
    assert(errorsFor([unit({ surface: invisible })]).some((error) => error.includes("surface")), JSON.stringify(invisible));
    assert(errorsFor([unit({
      excluded_blocks: [{ block: "ATTACK-CLASSES.md#Access control", reason: invisible }],
    })]).some((error) => error.includes("reason")), JSON.stringify(invisible));
  }
});

test("quotes input-derived controls in direct validation errors", () => {
  const invalidStatus = `invalid-${TERMINAL_CONTROL_PAYLOAD}`;
  const invalidPath = `src/${TERMINAL_CONTROL_PAYLOAD}.js`;
  const value = unit({
    status: invalidStatus,
    agent_id: "hunter-1",
    reviewed_paths: [invalidPath],
    local_checks: [sourceCheck()],
    result_fingerprints: ["force-state-error"],
  });
  const output = errorsFor([value]).join("\n");

  assert.match(output, /\$\[0\]\.status/);
  assert.match(output, /\$\[0\]\.reviewed_paths/);
  assert.match(output, /\\u001b/);
  assert.match(output, /\\u0007/);
  assert.match(output, /\\u0085/);
  assert.match(output, /\\u202e/);
  assertNoInjectedControlBytes(output);
});

test("accepts a canonical ID derived from near-maximum multibyte references", () => {
  const canonicalRefs = {
    surface: "\u6f22".repeat(1024),
    boundary: "\u00e9".repeat(1024),
    subsystem: "packages/api",
    attack_class: "\u6f22".repeat(1023) + "\u00e9",
  };
  const value = unit({ canonical_refs: canonicalRefs });
  assert(value.coverage_id.length > 16384, `coverage_id length ${value.coverage_id.length}`);
  assert(value.coverage_id.length <= 65536, `coverage_id length ${value.coverage_id.length}`);
  assert.deepEqual(errorsFor([value]), []);

  if (HAS_SAFE_INPUT_OPEN) {
    const result = runCli(JSON.stringify([value]));
    assert.equal(result.status, 0, cliOutput(result));
  }
});
