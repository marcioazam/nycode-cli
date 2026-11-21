// Lean automatic post-edit text (errors only).
// Why: in 111 sessions about 77% of the post-edit text was noise (repeated config warnings, "no diagnostics",
// warnings and hints). The explicit `lsp_diagnostics` query stays complete.
import path from "node:path";
import type { Diagnostic } from "vscode-languageserver-protocol";

const MAX_ERRORS = 10;

// Errors-only variant of `formatDiagnostic` in _shared/output.ts.
function formatError(file: string, d: Diagnostic, root?: string): string {
  const rel = root ? path.relative(root, file) || path.basename(file) : file;
  const source = d.source ? `${d.source}: ` : "";
  const code = d.code === undefined ? "" : ` [${String(d.code)}]`;
  return `${rel}:${d.range.start.line + 1}:${d.range.start.character + 1} - error: ${source}${d.message}${code}`;
}

export function formatPostEdit(serverId: string, file: string, diagnostics: Diagnostic[], root?: string): string {
  const errors = diagnostics.filter((d) => d.severity === undefined || d.severity === 1);
  if (errors.length === 0) return "";
  const lines = errors.slice(0, MAX_ERRORS).map((d) => formatError(file, d, root));
  if (errors.length > MAX_ERRORS) lines.push(`… ${errors.length - MAX_ERRORS} more errors`);
  return `⚠️ ${serverId}:\n${lines.join("\n")}`;
}

export function oncePerSession(seen: Set<string>, msg: string): boolean {
  if (seen.has(msg)) return false;
  seen.add(msg);
  return true;
}
