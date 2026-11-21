import assert from "node:assert/strict";
import { test } from "node:test";
import type { Diagnostic } from "vscode-languageserver-protocol";
import { formatPostEdit, oncePerSession } from "../../../src/extensions/lsp/post-edit.ts";

const diag = (severity: number | undefined, message = "m", extra: Partial<Diagnostic> = {}): Diagnostic =>
  ({ range: { start: { line: 2, character: 4 }, end: { line: 2, character: 5 } }, severity, message, ...extra }) as Diagnostic;

test("keeps only errors, capped at 10 with remainder", () => {
  const out = formatPostEdit("ts", "/r/a.ts", Array.from({ length: 12 }, (_, i) => diag(1, `e${i}`)), "/r");
  const lines = out.split("\n");
  assert.equal(lines[0], "⚠️ ts:");
  assert.equal(lines.length, 12);
  assert.equal(lines[11], "… 2 more errors");
});

test("filters warnings, info and hints", () => {
  const out = formatPostEdit("ts", "/r/a.ts", [diag(2, "w"), diag(3, "i"), diag(4, "h"), diag(1, "boom")], "/r");
  assert.ok(out.includes("boom"));
  assert.ok(!/\bw\b|\bi\b|\bh\b/.test(out.split("\n").slice(1).join(" ").replace("boom", "")));
});

test("undefined severity is kept", () => {
  assert.ok(formatPostEdit("ts", "/r/a.ts", [diag(undefined, "x")], "/r").includes("x"));
});

test("empty and warnings-only give empty string", () => {
  assert.equal(formatPostEdit("ts", "/r/a.ts", [], "/r"), "");
  assert.equal(formatPostEdit("ts", "/r/a.ts", [diag(2), diag(4)], "/r"), "");
});

test("line format with relative path, source and code", () => {
  const out = formatPostEdit("ts", "/r/src/a.ts", [diag(1, "bad", { source: "tsc", code: 2322 })], "/r");
  assert.equal(out, "⚠️ ts:\nsrc/a.ts:3:5 - error: tsc: bad [2322]");
});

test("basename when file is the root; absolute path without root", () => {
  assert.ok(formatPostEdit("ts", "/r/a.ts", [diag(1)], "/r/a.ts").includes("\na.ts:3:5"));
  assert.ok(formatPostEdit("ts", "/r/a.ts", [diag(1)]).includes("\n/r/a.ts:3:5"));
});

test("oncePerSession true then false", () => {
  const seen = new Set<string>();
  assert.equal(oncePerSession(seen, "a"), true);
  assert.equal(oncePerSession(seen, "a"), false);
  assert.equal(oncePerSession(seen, "b"), true);
});
