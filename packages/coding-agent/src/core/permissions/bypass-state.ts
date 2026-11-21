// The Bypass Permissions state of the running process. The environment variable is the state: guard.py reads it, the
// subagents started later inherit it, and the `/bypass` command and the native permission gate go through here.
const VAR = "NYCODE_BYPASS_PERMISSIONS";

/** Whether permission prompts are auto-approved now. */
export function isBypassOn(): boolean {
	// The same spellings guard.py accepts.
	return ["1", "true", "on", "yes"].includes((process.env[VAR] ?? "").toLowerCase());
}

/** Sets Bypass Permissions for this process (startup flag, `/bypass`, plan execution). */
export function setBypassState(on: boolean): void {
	process.env[VAR] = on ? "1" : "0";
}
