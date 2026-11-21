import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { terminateChild } from "../../../src/extensions/lsp/process.ts";

test("terminateChild SIGKILLs a child that ignores SIGTERM", async () => {
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});process.stdin.resume();console.log('up')"], { stdio: ["pipe", "pipe", "inherit"] });
  await new Promise((r) => child.stdout.once("data", r));
  const exited = new Promise<string | null>((r) => child.once("exit", (_c, sig) => r(sig)));
  terminateChild(child, 300);
  const sig = await Promise.race([exited, new Promise<string>((r) => setTimeout(() => r("STILL_ALIVE"), 3_000))]);
  if (sig === "STILL_ALIVE") child.kill("SIGKILL");
  assert.equal(sig, "SIGKILL");
});
