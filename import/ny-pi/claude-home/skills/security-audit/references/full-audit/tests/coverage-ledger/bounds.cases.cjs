const { assert, test, HOSTILE_CLI_TIMEOUT_MS, HAS_SAFE_INPUT_OPEN, unit, errorsFor, runCli, cliOutput, LIMITS, preflightJsonText } = require("./fixtures.cjs");

test("text preflight ignores structural characters and escapes inside strings", () => {
  const value = unit({
    surface: "Route \\ slash [list] {object}, colon: quoted \"value\"",
    excluded_blocks: [{
      block: "COMPANION.md#Literal [brackets] {braces}",
      reason: "The text contains a backslash \\ before an escaped \"quote\".",
    }],
  });
  const contents = JSON.stringify([value]);
  assert.doesNotThrow(() => preflightJsonText(contents));
  assert.deepEqual(JSON.parse(contents), [value]);
  if (HAS_SAFE_INPUT_OPEN) {
    const result = runCli(contents);
    assert.equal(result.status, 0, cliOutput(result));
  }
});

test("text preflight enforces structural cardinality limits", () => {
  const depthLimit = LIMITS.nestingDepth;
  assert.doesNotThrow(() => preflightJsonText(`${"[".repeat(depthLimit)}0${"]".repeat(depthLimit)}`));
  assert.throws(
    () => preflightJsonText(`${"[".repeat(depthLimit + 1)}0${"]".repeat(depthLimit + 1)}`),
    /exceeds nesting depth limit 64/,
  );

  const tooManyUnits = `[${"null,".repeat(LIMITS.units)}null]`;
  assert.throws(() => preflightJsonText(tooManyUnits), /exceeds 10000 top-level unit limit/);

  const tooManyItems = `[[${"null,".repeat(LIMITS.collectionItems)}null]]`;
  assert.throws(() => preflightJsonText(tooManyItems), /exceeds 1000 item array limit/);

  const objectFields = Array.from(
    { length: LIMITS.objectFields + 1 },
    (_, index) => `"field${index}":null`,
  ).join(",");
  assert.throws(() => preflightJsonText(`[{${objectFields}}]`), /exceeds 1000 field object limit/);

  const fullArray = `[${"null,".repeat(LIMITS.collectionItems - 1)}null]`;
  const arraysNeeded = Math.floor(LIMITS.preflightValues / (LIMITS.collectionItems + 1)) + 1;
  const tooManyValues = `[${Array.from({ length: arraysNeeded }, () => fullArray).join(",")}]`;
  assert.throws(() => preflightJsonText(tooManyValues), /exceeds 500000 total value limit/);
});

test("text preflight rejects malformed structural truncation cleanly", () => {
  assert.throws(() => preflightJsonText("["), /truncated JSON structure/);
  assert.throws(() => preflightJsonText("[\"unterminated"), /unterminated JSON string/);
  assert.throws(() => preflightJsonText("[{\"field\":1]"), /mismatched JSON containers/);
});

test("rejects deeply nested input without recursion failure", () => {
  let nested = 0;
  for (let depth = 0; depth < 20000; depth++) nested = [nested];
  assert(errorsFor(nested).some((error) => error.includes("exceeds nesting depth limit 64")));
  if (!HAS_SAFE_INPUT_OPEN) return;

  const result = runCli(`${"[".repeat(20000)}0${"]".repeat(20000)}`);
  const output = cliOutput(result);
  assert.notEqual(result.error && result.error.code, "ETIMEDOUT", output);
  assert.equal(result.status, 1, output);
  assert.match(output, /exceeds nesting depth limit 64/);
  assert.doesNotMatch(output, /RangeError|Maximum call stack|stack|at validate-coverage-ledger/i);
});

test("rejects multi-megabyte nesting under a constrained Node heap", { skip: !HAS_SAFE_INPUT_OPEN }, () => {
  const openContainers = "[".repeat(2000000);
  const cases = [
    openContainers,
    `${openContainers}0${"]".repeat(2000000)}`,
  ];
  for (const contents of cases) {
    const result = runCli(contents, {
      nodeArgs: ["--max-old-space-size=64"],
      timeout: HOSTILE_CLI_TIMEOUT_MS,
    });
    const output = cliOutput(result);
    assert.notEqual(result.error && result.error.code, "ETIMEDOUT", output);
    assert.equal(result.status, 1, output);
    assert.match(output, /exceeds nesting depth limit 64/);
    assert.doesNotMatch(output, /heap out of memory|allocation failed|RangeError|Maximum call stack|stack|at validate-coverage-ledger/i);
  }
});

test("caps malformed 10000-unit validation output", () => {
  assert.equal(errorsFor(Array.from({ length: LIMITS.units }, () => null)).length, LIMITS.validationErrors);
  if (!HAS_SAFE_INPUT_OPEN) return;

  const result = runCli(JSON.stringify(Array.from({ length: LIMITS.units }, () => null)));
  const output = cliOutput(result);
  assert.notEqual(result.error && result.error.code, "ETIMEDOUT", output);
  assert.equal(result.status, 1, output);
  assert.match(output, /output capped at 100/);
  assert(output.length < 20000, `unexpected output length ${output.length}`);
  assert.doesNotMatch(output, /RangeError|Maximum call stack|stack|at validate-coverage-ledger/i);
});

test("rejects malformed top-level data and excessive unit counts", () => {
  assert.deepEqual(errorsFor({ units: [] }), ["$: expected a top-level array"]);
  const tooMany = Array.from({ length: 10001 }, () => null);
  const errors = errorsFor(tooMany);
  assert.deepEqual(errors, ["$: exceeds 10000 coverage units"]);

  const oversizedCollection = unit({ extra: Array.from({ length: LIMITS.collectionItems + 1 }, () => null) });
  assert(errorsFor([oversizedCollection]).some((error) => error.includes("exceeds 1000 entries")));
});

