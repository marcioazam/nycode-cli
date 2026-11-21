// PATCH local (vendor): texto automático pós-edit enxuto (só erros).
// Por quê: em 111 sessões, ≈77% do texto pós-edit era ruído (avisos de configuração repetidos,
// "no diagnostics", warnings/hints). A consulta explícita (`lsp_diagnostics`) segue completa.
// Reverter: desfazer os trechos "PATCH local (vendor)" em index.ts e apagar post-edit.ts e post-edit.test.ts.
import path from "node:path";
import type { Diagnostic } from "vscode-languageserver-protocol";

const MAX_ERRORS = 10;

// Inline de `formatDiagnostic` (_shared/output.ts importa "./paths" sem extensão e não carrega em strip-types).
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
