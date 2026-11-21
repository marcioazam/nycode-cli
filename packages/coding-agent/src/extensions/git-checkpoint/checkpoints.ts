/** Checkpoint state, shadow-repo path helpers and rewind text for the git-checkpoint extension. */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext, ExtensionContext } from "../../core/extensions/types.ts";
import { readUserSetting } from "../_shared/settings/settings-chain.ts";
import { contentText, errorMessage } from "../_shared/util/values.ts";

export const CUSTOM_TYPE = "git-checkpoint";
/** Sidecar inside the bare shadow repo recording the work tree it snapshots. */
const WORK_TREE_FILE = "pi-work-tree";
/** nycode's tools that change a file. `read` is deliberately absent: checkpoint scope is
 * the set of files the session edited, and that set is what bounds the snapshot. */
export const EDIT_TOOLS: ReadonlySet<string> = new Set(["edit", "write"]);
/** A run's checkpoint commit is published under a ref rather than recorded as a raw
 * sha, so a file first edited in a later turn of the same run can still fold its
 * pre-edit baseline into that run's checkpoint by moving the ref. */
export const CHECKPOINT_REF_PREFIX = "refs/pi-code/checkpoints";
const PROMPT_SNIPPET_LENGTH = 60;

/** The value the restore logic branches on; the label shown to the user is separate. */
type RestoreMode = "code-and-conversation" | "conversation" | "code" | "summary";
/** What each mode does (runRestoreMode): navigateTree moves the session leaf, so later messages
 * stay in the session tree on another branch; code restore checks the snapshot out over the
 * edited files only (files created later are left in place). */
export const RESTORE_CHOICES: ReadonlyArray<{ label: string; mode: RestoreMode }> = [
	{
		label: "Código e conversa · restaura os arquivos editados e volta a conversa a este ponto",
		mode: "code-and-conversation",
	},
	{ label: "Só a conversa · os arquivos ficam como estão", mode: "conversation" },
	{ label: "Só o código · a conversa fica como está", mode: "code" },
	{
		label: "Resumir daqui em diante · os arquivos ficam como estão; o que veio depois vira um resumo",
		mode: "summary",
	},
];
const RESTORED_TEXT: Record<RestoreMode, string> = {
	"code-and-conversation": "código e conversa",
	conversation: "só a conversa",
	code: "só o código",
	summary: "resumido",
};
export const YES_RESTORE_CODE = "Sim, restaurar os arquivos";
export const NO_RESTORE_CODE = "Não, manter os arquivos como estão";

export interface Checkpoint {
	entryId: string;
	ref: string;
	prompt: string;
	createdAt: string;
}

/** Claude deletes checkpoints after 30 days (cleanupPeriodDays). Shadow repos hold a
 * snapshot per edited file, so unbounded retention grows under $HOME for the life of
 * the machine. */
export const CHECKPOINT_RETENTION_DAYS = 30;

/** The message of a commit that records a file's content before its first edit. */
export const BASELINE_MESSAGE = "baseline";

/** Marks a commit header in ADDED_FILES_LOG output, which no file name can contain. */
const COMMIT_MARK = "\x01";

/** `git log` arguments listing, oldest first, the files each commit added: with -z the
 * names arrive raw and NUL-terminated rather than C-quoted ("caf\303\251.md"), which no
 * checkout could name. */
export const ADDED_FILES_LOG = [
	"log",
	"-z",
	"--reverse",
	"--diff-filter=A",
	"--name-only",
	`--format=${COMMIT_MARK}%H %s`,
];

/** For each file ADDED_FILES_LOG lists, the first commit that added it, skipping files the
 * checkpoint already holds. */
export function firstAdditions(
	log: string,
	skip: ReadonlySet<string>,
): Map<string, { sha: string; baseline: boolean }> {
	const first = new Map<string, { sha: string; baseline: boolean }>();
	let commit: { sha: string; baseline: boolean } | undefined;
	for (const raw of log.split("\0")) {
		// git separates a commit's header from its names with a newline.
		const token = raw.startsWith("\n") ? raw.slice(1) : raw;
		if (token.startsWith(COMMIT_MARK)) {
			const header = token.slice(1);
			const space = header.indexOf(" ");
			commit =
				space === -1
					? undefined
					: { sha: header.slice(0, space), baseline: header.slice(space + 1) === BASELINE_MESSAGE };
		} else if (commit !== undefined && token !== "" && !skip.has(token) && !first.has(token))
			first.set(token, commit);
	}
	return first;
}

/** The retention period in effect: Claude keeps checkpoints for 30 days and says to
 * "change the period with cleanupPeriodDays". Read from the user-level files (the user
 * file and the `--settings` flag), which is where a setting about the user's own disk
 * belongs; a non-positive or unreadable value keeps the default rather than sweeping
 * everything away. */
export function checkpointRetentionDays(home: string = os.homedir()): number {
	const declared = readUserSetting(home, "cleanupPeriodDays");
	if (typeof declared === "number" && Number.isFinite(declared) && declared > 0) return declared;
	return CHECKPOINT_RETENTION_DAYS;
}

/** Claude keeps the 100 most recent checkpoints per session. Older ones drop off the
 * rewind list; their commits stay in the shadow repo until the retention sweep. */
export const MAX_CHECKPOINTS_PER_SESSION = 100;

/** The newest entries, up to the per-session cap, oldest first. */
export function capCheckpoints<T>(all: T[]): T[] {
	return all.length <= MAX_CHECKPOINTS_PER_SESSION ? all : all.slice(all.length - MAX_CHECKPOINTS_PER_SESSION);
}

/** Remove shadow repos untouched for longer than the retention window. The live
 * session's repo is always kept, whatever its age: a long session's directory mtime
 * can predate the window. Failures are ignored; this is housekeeping, not a gate. */
export function pruneCheckpointRepos(root: string, retentionDays: number, keepDir?: string): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(root, { withFileTypes: true });
	} catch {
		return;
	}
	const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const dir = path.join(root, entry.name);
		if (keepDir && path.resolve(dir) === path.resolve(keepDir)) continue;
		try {
			if (fs.statSync(dir).mtimeMs >= cutoff) continue;
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {
			// a repo we cannot stat or remove stays; housekeeping must not break startup
		}
	}
}

export function sessionSlug(sessionFile: string | undefined): string {
	if (!sessionFile) return `ephemeral-${process.pid}`;
	return path.basename(sessionFile).replace(/[^\w.-]+/g, "_");
}

/** A stable per-directory key, so a session resumed elsewhere gets its own shadow. */
export function cwdSlug(cwd: string): string {
	const resolved = path.resolve(cwd);
	const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 8);
	return `${path.basename(resolved).replace(/[^\w.-]+/g, "_")}-${hash}`;
}

/** The work tree a shadow repo was created against, or undefined for a repo that
 * predates the sidecar or does not exist yet. */
export function recordedWorkTree(shadowDir: string): string | undefined {
	try {
		return fs.readFileSync(path.join(shadowDir, WORK_TREE_FILE), "utf8").trim() || undefined;
	} catch {
		return undefined;
	}
}

export function rememberWorkTree(shadowDir: string, cwd: string): void {
	try {
		fs.writeFileSync(path.join(shadowDir, WORK_TREE_FILE), `${cwd}\n`);
	} catch {
		// best effort: without the marker the next resume simply cannot detect a move
	}
}

function promptSnippet(content: unknown): string {
	const text = contentText(content, " ").replace(/\s+/g, " ").trim();
	if (text.length <= PROMPT_SNIPPET_LENGTH) return text;
	return `${text.slice(0, PROMPT_SNIPPET_LENGTH)}…`;
}

export function findLastUserMessage(ctx: ExtensionContext): { entryId: string; prompt: string } | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry?.type === "message" && entry.message.role === "user") {
			return { entryId: entry.id, prompt: promptSnippet(entry.message.content) };
		}
	}
	return undefined;
}

/** The checkpoints recorded in the session, in entry order. */
export function storedCheckpoints(ctx: ExtensionContext): Checkpoint[] {
	const stored: Checkpoint[] = [];
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE) continue;
		const checkpoint = entry.data as Checkpoint | undefined;
		if (checkpoint?.entryId) stored.push(checkpoint);
	}
	return stored;
}

/** `HH:MM · agora|há N min|há N h|há N d`, local 24h clock; `now` is injectable for tests. */
export function checkpointWhen(createdAt: string, now = Date.now()): string {
	const at = new Date(createdAt);
	if (Number.isNaN(at.getTime())) return "--:--";
	const clock = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
	const minutes = Math.max(0, Math.floor((now - at.getTime()) / 60_000));
	if (minutes < 1) return `${clock} · agora`;
	if (minutes < 60) return `${clock} · há ${minutes} min`;
	if (minutes < 1440) return `${clock} · há ${Math.floor(minutes / 60)} h`;
	return `${clock} · há ${Math.floor(minutes / 1440)} d`;
}

export function checkpointLabel(checkpoint: Checkpoint, index: number): string {
	const marker = checkpoint.ref ? "" : " [sem snapshot de código]";
	return `${index + 1}. ${checkpointWhen(checkpoint.createdAt)}  ${checkpoint.prompt || "(prompt vazio)"}${marker}`;
}

export function rewindResult(prompt: string, mode: RestoreMode, promptInEditor: boolean): string {
	const tail = promptInEditor && mode !== "code" ? " · o prompt está no campo" : "";
	return `✓ Voltou para “${prompt || "(prompt vazio)"}” · ${RESTORED_TEXT[mode]}${tail}`;
}

export async function restoreConversation(
	ctx: ExtensionCommandContext,
	entryId: string,
	summarize = false,
): Promise<{ promptInEditor: boolean } | undefined> {
	try {
		// navigateTree's published type omits editorText, but it is present at runtime (docs/extensions.md)
		const result = (await ctx.navigateTree(entryId, { summarize })) as { cancelled: boolean; editorText?: string };
		if (result.cancelled) return undefined;
		if (typeof result.editorText === "string") ctx.ui.setEditorText(result.editorText);
		return { promptInEditor: typeof result.editorText === "string" && result.editorText !== "" };
	} catch (error) {
		const message = errorMessage(error);
		ctx.ui.notify(`Não foi possível restaurar a conversa: ${message}`, "error");
		return undefined;
	}
}
