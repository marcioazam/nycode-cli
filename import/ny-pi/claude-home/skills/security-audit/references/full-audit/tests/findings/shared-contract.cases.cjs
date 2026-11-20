const { assert, path, test, source, LIMITS } = require("./fixtures.cjs");

test("keeps shared helpers aligned with the coverage-ledger validator", () => {
  const findingsModule = require("../../validate-findings.cjs");
  const ledgerModule = require("../../validate-coverage-ledger.cjs");

  for (const name of [
    "VISIBLE_CONTENT",
    "PATH_FORBIDDEN_CHARACTER",
    "WINDOWS_RESERVED_COMPONENT",
    "UNSAFE_DIAGNOSTIC_CHARACTER",
  ]) {
    assert.equal(findingsModule[name].source, ledgerModule[name].source, `${name} source`);
    assert.equal(findingsModule[name].flags, ledgerModule[name].flags, `${name} flags`);
  }

  const sharedLimitKeys = Object.keys(findingsModule.LIMITS)
    .filter((key) => Object.prototype.hasOwnProperty.call(ledgerModule.LIMITS, key))
    .sort();
  assert.deepEqual(sharedLimitKeys, ["inputBytes", "nestingDepth", "validationErrors"]);
  for (const key of sharedLimitKeys) {
    assert.equal(findingsModule.LIMITS[key], ledgerModule.LIMITS[key], `LIMITS.${key}`);
  }

  const pathCorpus = [
    "src/handler.js",
    "src/caf\u00e9/handler.js",
    "src/\u65e5\u672c\u8a9e/\u0444\u0430\u0439\u043b.ts",
    "src/cloc\u212a$.txt",
    "src/CLOCK$.txt",
    "src/con.txt",
    "CON",
    "src/COM\u00b9.log",
    "src/lpt\u00b3",
    "/etc/passwd",
    "../src/file.c",
    "src/../file.c",
    "src//file.c",
    "src\\file.c",
    "src/file:name.c",
    "~home/file.c",
    "C:/file.c",
    "src/file.c ",
    "src/file.c.",
    "src/file\u202ename.c",
    "src/file\u200b.js",
    "src/file\u034f.js",
    "src/file\ufe0f.js",
    "src/file\ud800name.c",
    "src/file\udc00name.c",
  ];
  for (const value of pathCorpus) {
    assert.equal(
      findingsModule.isSafeRelativeSourcePath(value),
      ledgerModule.isSafeRelativePath(value),
      `path verdict diverges for ${JSON.stringify(value)}`,
    );
  }
  assert.equal(findingsModule.isSafeRelativeSourcePath("src/cloc\u212a$.txt"), false);
  assert.equal(ledgerModule.isSafeRelativePath("src/cloc\u212a$.txt"), false);

  const proseCorpus = [
    "Valid prose.",
    "caf\u00e9",
    "",
    " \t\r\n",
    "\u200b",
    "\u034f",
    "\ufe0f",
    "\ud800",
    "\udc00",
    "visible\ud800",
  ];
  for (const value of proseCorpus) {
    assert.equal(
      findingsModule.hasVisibleProse(value),
      ledgerModule.hasVisibleProse(value),
      `prose verdict diverges for ${JSON.stringify(value)}`,
    );
  }
});
