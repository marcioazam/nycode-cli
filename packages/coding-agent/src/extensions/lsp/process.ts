import type { ChildProcess } from "node:child_process";

// Node sets `child.killed` once a signal is *sent*, not when the process exits; a server that
// ignores SIGTERM would never be SIGKILLed. Liveness is exit state. The timer is unref'd: while
// the child lives its stdio pipes hold the event loop, so it still fires; once dead nothing is owed.
const isAlive = (c: ChildProcess): boolean => c.exitCode === null && c.signalCode === null;

export function terminateChild(child: ChildProcess, graceMs = 2_000): void {
  if (!isAlive(child)) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (isAlive(child)) child.kill("SIGKILL");
  }, graceMs).unref();
}
