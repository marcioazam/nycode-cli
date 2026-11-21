// The guard's verdict for one tool call: a TypeScript port of guard.py's `decide`, same verdicts and same reasons for
// every input. guard.py stays the oracle (test/harness/permissions runs both on one corpus).
import { checkBash } from "./bash/rules.ts";
import { checkFile, checkRead } from "./file-rules.ts";
import { abspath } from "./py-path.ts";

/** What the guard decides: let the call run, ask the user, or block it. */
export type GuardVerdict = { kind: "allow" } | { kind: "ask"; reason: string } | { kind: "deny"; reason: string };

/** A tool call in Claude's vocabulary (`Bash`, `Edit`, `Write`, `MultiEdit`, `Read`), as guard.py reads it. */
export interface GuardCall {
	tool: string;
	input: Record<string, unknown>;
	cwd: string;
	/** The project root (CLAUDE_PROJECT_DIR for the script); the cwd when empty. */
	project: string;
	/** Bypass Permissions: every ask becomes allow, denies stay. */
	bypass: boolean;
}

/** Python `x or ""` on a tool input field: falsy is empty, text stays, anything else is a malformed call. */
function text(value: unknown): string {
	if (!value) return "";
	if (typeof value !== "string") throw new TypeError(`tool input field is ${typeof value}, expected text`);
	return value;
}

const unique = (reasons: string[]): string => [...new Set(reasons)].join("; ");

/** The guard's verdict for `call`. Throws on a malformed input; the caller fails closed. */
export function decide(call: GuardCall): GuardVerdict {
	const cwd = call.cwd || process.cwd();
	const project = call.project || cwd;
	let found: ReturnType<typeof checkBash>;
	if (call.tool === "Bash") {
		found = checkBash(text(call.input.command), abspath(cwd));
	} else if (call.tool === "Edit" || call.tool === "Write" || call.tool === "MultiEdit") {
		found = checkFile(text(call.input.file_path), abspath(cwd), abspath(project));
	} else if (call.tool === "Read") {
		found = checkRead(text(call.input.file_path), abspath(cwd));
	} else {
		return { kind: "allow" };
	}
	const denies = found.filter(([level]) => level === "deny").map(([, reason]) => reason);
	if (denies.length > 0) return { kind: "deny", reason: `Bloqueado pelo guard: ${unique(denies)}` };
	const asks = found.filter(([level]) => level === "ask").map(([, reason]) => reason);
	if (asks.length > 0 && !call.bypass) return { kind: "ask", reason: `Confirmação necessária: ${unique(asks)}` };
	return { kind: "allow" };
}
