// File rules of the guard: Edit/Write on sensitive files or outside the project ask; Read of secrets is denied.
// Port of `check_file` and `check_read` of guard.py.
import type { Finding } from "./bash/parse.ts";
import { abspath, basename, expanduser, isabs, join, realpath, tempDir } from "./py-path.ts";

const ENV_SAFE_SUFFIXES = [".example", ".sample", ".template", ".dist"];
const KEY_FILE_SUFFIXES = [".pem", ".key", ".p12", ".pfx"];
const KEY_NAME_RE = /^id_(rsa|ed25519|ecdsa|dsa)/;
// Python's `$` also matches before a final newline; `\n?$` keeps that on paths and names.
const READ_DENY_ENV_RE = /^\.env(\.local|\.production|\.[^\n]+\.local)?\n?$/;
const SENSITIVE_DIR_NAMES = [".ssh", ".aws", ".gnupg", ".config/gh", ".kube", ".docker"];
const SENSITIVE_FILE_NAMES = [
	...[".nycode/agent/settings.json", ".nycode/agent/auth.json", ".local/bin/nycode"],
	...[
		".zshrc",
		".zshenv",
		".zprofile",
		".bashrc",
		".bash_profile",
		".profile",
		".netrc",
		".npmrc",
		".git-credentials",
	],
];
const READ_DENY_DIR_NAMES = [".ssh", ".config/claude-secrets"];
const READ_DENY_FILE_NAMES = [
	...[".codex/auth.json", ".config/mcp/secrets.env", ".nycode/agent/auth.json"],
	...[".nycode/agent/mcp-auth.json", ".nycode/agent/.credentials.json"],
];

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function inside(path: string, root: string): boolean {
	return root !== "" && (path === root || path.startsWith(`${root.replace(/\/+$/, "")}/`));
}

/** The absolute, normalized path a tool input names, resolved against cwd like the guard does. */
function resolvePath(path: string, cwd: string): string {
	return abspath(expanduser(isabs(path) || path.startsWith("~") ? path : join(cwd || process.cwd(), path)));
}

/** Findings for writing `path`: sensitive files ask wherever they are, other files ask outside the project and /tmp. */
export function checkFile(path: string, cwd: string, project: string): Finding[] {
	if (path === "") return [];
	const home = expanduser("~");
	const p = resolvePath(path, cwd);
	const base = basename(p);
	if ((base === ".env" || base.startsWith(".env.")) && !ENV_SAFE_SUFFIXES.some((s) => base.endsWith(s))) {
		return [["ask", `arquivo de segredos ${base}`]];
	}
	if (KEY_FILE_SUFFIXES.some((s) => base.endsWith(s)) || KEY_NAME_RE.test(base)) {
		return [["ask", `chave/certificado ${base}`]];
	}
	const sensitiveFiles = SENSITIVE_FILE_NAMES.map((name) => join(home, name));
	const sensitiveDirs = SENSITIVE_DIR_NAMES.map((name) => join(home, name));
	if (base === "auth.json" || sensitiveFiles.includes(p) || sensitiveDirs.some((d) => inside(p, d))) {
		return [["ask", `arquivo sensível ${p}`]];
	}
	if (["/tmp", tempDir(), "/var/tmp"].some((root) => inside(p, root))) return [];
	if (!(inside(p, project) || inside(p, cwd))) return [["ask", `fora do projeto: ${p}`]];
	return [];
}

function readDenied(p: string): boolean {
	const home = expanduser("~");
	const claudeCredentials = new RegExp(`^${escapeRegExp(home)}/\\.claude(-[^/]+)?/\\.credentials\\.json\\n?$`);
	return (
		READ_DENY_FILE_NAMES.some((name) => join(home, name) === p) ||
		READ_DENY_DIR_NAMES.some((name) => inside(p, join(home, name))) ||
		claudeCredentials.test(p) ||
		READ_DENY_ENV_RE.test(basename(p))
	);
}

/** Findings for reading `path`: secrets are denied, a symlink to one included. */
export function checkRead(path: string, cwd: string): Finding[] {
	if (path === "") return [];
	const p = resolvePath(path, cwd);
	if ([p, realpath(p)].some(readDenied)) return [["deny", `leitura de segredo bloqueada: ${p}`]];
	return [];
}
