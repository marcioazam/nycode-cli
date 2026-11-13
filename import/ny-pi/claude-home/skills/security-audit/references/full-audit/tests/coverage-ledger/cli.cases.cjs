const { assert, fs, os, path, test, validatorPath, CLI_TIMEOUT_MS, HAS_SAFE_INPUT_OPEN, unit, runCli, cliOutput, TERMINAL_CONTROL_PAYLOAD, assertNoInjectedControlBytes, spawnSync } = require("./fixtures.cjs");

test("accepts a complete ledger through the CLI", { skip: !HAS_SAFE_INPUT_OPEN }, () => {
  const result = runCli(JSON.stringify([unit()]));
  assert.equal(result.status, 0, cliOutput(result));
  assert.match(result.stdout, /PASS: 1 coverage units valid/);
});

test("quotes input-derived controls in CLI validation errors", { skip: !HAS_SAFE_INPUT_OPEN }, () => {
  const value = unit({
    status: `invalid-${TERMINAL_CONTROL_PAYLOAD}`,
    result_fingerprints: ["force-state-error"],
  });
  const result = runCli(JSON.stringify([value]));

  assert.equal(result.status, 1, cliOutput(result));
  assert.match(result.stderr, /\$\[0\]\.status/);
  assert.match(result.stderr, /\\u001b/);
  assertNoInjectedControlBytes(result.stderr);
});

test("returns a generic syntax error without parser-supplied controls", { skip: !HAS_SAFE_INPUT_OPEN }, () => {
  const malformed = Buffer.concat([
    Buffer.from("["),
    Buffer.from(TERMINAL_CONTROL_PAYLOAD),
    Buffer.from("]"),
  ]);
  const result = runCli(malformed);

  assert.equal(result.status, 1, cliOutput(result));
  assert.equal(result.stderr, "Failed to parse coverage ledger: invalid JSON syntax\n");
  assertNoInjectedControlBytes(result.stderr);
});

test("does not reflect controls from a failed CLI input path", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "validate-coverage-ledger-path-"));
  const missingPath = path.join(directory, `missing-${TERMINAL_CONTROL_PAYLOAD}.json`);
  try {
    const result = spawnSync(process.execPath, [validatorPath, missingPath], {
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
    });
    assert.equal(result.status, 1, cliOutput(result));
    assert.match(result.stderr, /Failed to read coverage ledger:/);
    assertNoInjectedControlBytes(result.stderr);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects invalid UTF-8 through the CLI", { skip: !HAS_SAFE_INPUT_OPEN }, () => {
  const encoded = Buffer.from(JSON.stringify([unit()]));
  const marker = Buffer.from("Update-user route");
  const markerOffset = encoded.indexOf(marker);
  assert.notEqual(markerOffset, -1);
  const malformed = Buffer.concat([
    encoded.subarray(0, markerOffset),
    Buffer.from([0x80]),
    encoded.subarray(markerOffset + marker.length),
  ]);

  const result = runCli(malformed);
  const output = cliOutput(result);
  assert.equal(result.status, 1, output);
  assert.match(output, /input is not valid UTF-8/);
  assert.doesNotMatch(output, /TypeError|stack|at validate-coverage-ledger/i);
});

test("rejects a FIFO through the CLI without blocking", { skip: process.platform === "win32" || !HAS_SAFE_INPUT_OPEN }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "validate-coverage-ledger-fifo-"));
  const fifoPath = path.join(directory, "coverage-ledger.json");
  try {
    const created = spawnSync("mkfifo", [fifoPath], { encoding: "utf8", timeout: CLI_TIMEOUT_MS });
    assert.equal(created.status, 0, cliOutput(created));

    const result = spawnSync(process.execPath, [validatorPath, fifoPath], {
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
    });
    const output = cliOutput(result);
    assert.notEqual(result.error && result.error.code, "ETIMEDOUT", output);
    assert.equal(result.status, 1, output);
    assert.match(output, /input must be a regular file/);
    assert.doesNotMatch(output, /stack|at validate-coverage-ledger/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects a symlink through the CLI", { skip: process.platform === "win32" || !HAS_SAFE_INPUT_OPEN }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "validate-coverage-ledger-symlink-"));
  const targetPath = path.join(directory, "target.json");
  const symlinkPath = path.join(directory, "coverage-ledger.json");
  try {
    fs.writeFileSync(targetPath, JSON.stringify([unit()]));
    fs.symlinkSync(targetPath, symlinkPath);
    const result = spawnSync(process.execPath, [validatorPath, symlinkPath], {
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
    });
    const output = cliOutput(result);
    assert.notEqual(result.error && result.error.code, "ETIMEDOUT", output);
    assert.equal(result.status, 1, output);
    assert.match(output, /input must not be a symlink/);
    assert.doesNotMatch(output, /stack|at validate-coverage-ledger/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

