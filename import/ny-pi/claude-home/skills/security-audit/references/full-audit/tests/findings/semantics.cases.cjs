const { assert, test, source, evidence, confirmed, needsValidation, rejected, errorsFor, rejectMutation, LIMITS, collect } = require("./fixtures.cjs");

test("checks pattern and branch invariants", () => {
  rejectMutation(rejected, (finding) => { finding.fingerprint = "not stable"; });
  rejectMutation(needsValidation, (finding) => {
    finding.severity = { impact: { score: "low" }, overall_severity: "low" };
  });
});

test("accepts empty output and each complete branch", () => {
  assert.deepEqual(errorsFor([]), []);
  assert.deepEqual(errorsFor([confirmed(), needsValidation(), rejected()]), []);
  const localOnly = needsValidation();
  delete localOnly.validation_plan.deployment;
  assert.deepEqual(errorsFor([localOnly]), []);
  const deploymentOnly = needsValidation();
  delete deploymentOnly.validation_plan.local;
  assert.deepEqual(errorsFor([deploymentOnly]), []);
});

test("allows a one-line finding trace", () => {
  const finding = confirmed();
  finding.trace = [source("entrypoint")];
  assert.deepEqual(errorsFor([finding]), []);
});

test("rejects line zero", () => {
  rejectMutation(confirmed, (finding) => { finding.trace[0].line = 0; });
  rejectMutation(rejected, (finding) => { finding.evidence[0].line = 0; });
});

test("rejects duplicate fingerprints and unique array entries", () => {
  const first = confirmed();
  const second = rejected();
  second.fingerprint = first.fingerprint;
  assert(errorsFor([first, second]).some((error) => error.includes("duplicate of")));
  rejectMutation(needsValidation, (finding) => { finding.blockers = [finding.blockers[0], finding.blockers[0]]; });
});

test("bounds canonical uniqueness keys and Set storage", () => {
  const oversizedKey = "x".repeat(LIMITS.canonicalKeyBytes + 1);
  assert(collect([oversizedKey], { type: "array", uniqueItems: true })
    .some((error) => error.includes("canonical key exceeds")));

  const itemLength = Math.floor(LIMITS.uniqueSetBytes / 6);
  const largeUniqueItems = Array.from({ length: 6 }, (_, index) => `${index}${"x".repeat(itemLength)}`);
  assert(collect(largeUniqueItems, { type: "array", uniqueItems: true })
    .some((error) => error.includes("canonical uniqueness set exceeds")));
});

test("requires findings to be sorted by fingerprint", () => {
  const first = confirmed();
  const second = rejected();
  assert(errorsFor([second, first]).some((error) => error.includes("sorted lexicographically")));
});

test("rejects severity above demonstrated impact", () => {
  rejectMutation(confirmed, (finding) => {
    finding.severity.overall_severity = "high";
    finding.severity.impact.score = "medium";
  });
});

test("rejects unsafe source paths", () => {
  const badPaths = [
    "/etc/passwd",
    "../src/file.c",
    "src/../file.c",
    "src//file.c",
    "C:\\src\\file.c",
    "src/file:name.c",
    "src/file\nname.c",
    "src/file\u0001name.c",
    "src/file\u0085name.c",
    "src/file\u2028name.c",
    "src/file\u202ename.c",
    "src/file\u2066name.c",
    "src/file\u200dname.c",
    "src/file\u034fname.c",
    "src/file\ufe0fname.c",
    "src/file\ud800name.c",
    "src/file\udc00name.c",
    "CON",
    "src/con.txt",
    "src/PRN",
    "src/AUX.c",
    "src/NUL",
    "src/COM1.log",
    "src/lpt9",
    "src/CONIN$",
    "src/CONOUT$.txt",
    "src/CLOCK$.txt",
    "src/COM\u00b9.log",
    "src/LPT\u00b2.log",
    "src /file.c",
    "src./file.c",
    "src/file.c ",
    "src/file.c.",
  ];
  for (const badPath of badPaths) {
    rejectMutation(confirmed, (finding) => { finding.trace[0].file = badPath; });
  }
  rejectMutation(rejected, (finding) => { finding.evidence[0].file = "NUL.txt"; });
  rejectMutation(confirmed, (finding) => {
    finding.remediation.code_changes = [{ file_name: "src/file:name.c", fixed_code: "replacement" }];
  });
});

test("accepts legitimate Unicode source paths and prose", () => {
  const finding = confirmed();
  finding.title = "Finding \ud83d\ude00 cafe\u0301";
  finding.trace[0].file = "src/日本語/cafe\u0301-\ud83d\ude00.ts";
  finding.evidence[0].file = "src/mañana/файл.ts";
  finding.remediation.code_changes = [{
    file_name: "src/修正/éxito.ts",
    fixed_code: "replacement",
  }];
  assert.deepEqual(errorsFor([finding]), []);
});

