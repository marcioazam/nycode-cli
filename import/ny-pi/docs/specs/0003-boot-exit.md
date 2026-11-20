# 0003 - boot and exit latency

Status: implemented on `perf/boot-exit`. Measurements are "noisy" (`nice`, outside the bench lock, the Terminal-Bench
holds it); the orchestrator owns the final timing.

## Exit: 0.54 s after the last response

Cause (measured): at quit pi closes every MCP stdio server. `pi-mcp`'s `StdioTransport.close()` ends the server's stdin and
waits `STDIN_CLOSE_GRACE_MS = 500` before SIGTERM. A server that is still booting does not read stdin; the template
`mcp.json.example` starts `npx -y @playwright/mcp` (1.7 s cold start), so every short `pi -p` waited the whole 500 ms.
Probe: a preload logging `child_process.spawn` showed `npx -y @playwright/mcp` alive 0.47 s after `codegraph` closed;
`ProcessWrap` was the only handle left. No timer, hook or `session_shutdown` handler of ny-pi is involved
(`session_shutdown` handlers of ny-pi and pi-code only clear timers). Servers already up exit in 11-24 ms after stdin
closes (measured: codegraph 11 ms, playwright 24 ms).

Fix: `claude-home/patches/pi-core/mcp-close-grace.mjs` (applied by `bin/pi`, same pattern and version pin as
`cache-warm-identity.mjs`) sets the grace to 100 ms; SIGKILL stays 2 s later. Test:
`claude-home/patches/pi-core/mcp-close-grace.test.ts` (red: unpatched close of a silent server takes about 500 ms; green: about
100 ms; plus the patch's idempotence, mismatch and symlink cases). End to end on the fake-SSE meter (noisy): exit_s
0.53 -> 0.126 s.

Limit: the saving exists only when a server is still booting at quit, i.e. runs shorter than the slowest server's start.
A long task finds every server up and pays about 0.

## turn_gap 0.057 vs 0.012 s

Diagnosis only. Per tool call ny-pi runs two hooks in sequence around the tool: `hooks/guard.py` (python3, about 31-33 ms)
and `hooks/dispatch/hook-dispatch.sh` (about 10 ms), plus the Stop-phase hooks (ralph-loop, impeccable gate, about 5 ms).
That is about 43-45 ms per tool call, the whole 45 ms difference. Not changed: guard.py is the safety control.
A long-lived guard process (one python start per session) would cut about 25 ms per call; out of scope here.

## Cold start (new container per task)

jiti transpiles the extensions on a cold cache (`$TMPDIR/jiti`, 161 entries): `pi --help` 1.75 s cold, 0.34 s warm
(`--version` exits before loading them, so the old install step never warmed it). The Harbor agent install now also runs
`pi --help` once, best effort, so the task run starts warm. Any CI or headless user gets the same effect from one
`pi --help >/dev/null` after install, within the same TMPDIR. Not testable without docker: that the install and the run
share `/tmp` in the container.
