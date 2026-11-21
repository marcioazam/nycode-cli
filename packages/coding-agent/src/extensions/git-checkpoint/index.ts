/**
 * Git Checkpoint Extension
 *
 * Claude Code style /rewind built on a per-session shadow git repo.
 *
 * Snapshots commit the files this session's edit tools touched (the project's
 * .gitignore and .git/info/exclude are honored) into a bare repo under
 * <agent dir>/checkpoints/<session>, using --git-dir/--work-tree so the
 * project's own git state is never touched. Scope is the edit set, not the
 * working tree: Claude tracks "only files that have been edited within the
 * current session", and a whole-tree snapshot instead sizes every checkpoint
 * by cwd, which has no bound when cwd is $HOME. Each user prompt gets one
 * checkpoint persisted as {entryId, ref, prompt, createdAt} in the session
 * file, so /rewind works across restarts, resumes, and forks. Code restore
 * checks the snapshot out over the working tree, resetting file contents to
 * the checkpoint; a file first edited after the checkpoint is put back from the
 * baseline recorded before that edit, and files created after it are left in place.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir } from "../../config.ts";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "../../core/extensions/types.ts";
import { fileToolTarget } from "../_shared/rules/tool-target.ts";
import { errorMessage } from "../_shared/util/values.ts";
import {
	ADDED_FILES_LOG,
	BASELINE_MESSAGE,
	CHECKPOINT_REF_PREFIX,
	type Checkpoint,
	CUSTOM_TYPE,
	capCheckpoints,
	checkpointLabel,
	checkpointRetentionDays,
	cwdSlug,
	EDIT_TOOLS,
	findLastUserMessage,
	firstAdditions,
	MAX_CHECKPOINTS_PER_SESSION,
	NO_RESTORE_CODE,
	pruneCheckpointRepos,
	RESTORE_CHOICES,
	recordedWorkTree,
	rememberWorkTree,
	restoreConversation,
	rewindResult,
	sessionSlug,
	storedCheckpoints,
	YES_RESTORE_CODE,
} from "./checkpoints.ts";

export default function gitCheckpointExtension(nycode: ExtensionAPI) {
	const checkpoints = new Map<string, Checkpoint>();
	let pending: { ref: string; createdAt: string } | undefined;
	// A run (one user message) needs a single pre-run snapshot, no matter how many
	// assistant turns it drives. before_agent_start starts a run; the first turn_start
	// then snapshots and clears this, so turns 2..n skip the wasted git work.
	let runNeedsSnapshot = true;
	/** Whether the run about to start came from a prompt (see before_agent_start below). */
	let promptedRun = false;
	let shadowDir: string | undefined;
	let workTree: string | undefined;
	// Set in ensureShadow: whether the live session has no session file (--no-session),
	// whose shadow repo session_shutdown then knows is safe to remove on a real quit.
	let ephemeralShadow = false;
	// Absolute paths this session's edit tools targeted: the whole of what a checkpoint
	// captures. Seeded on resume from the last commit, so a resumed session keeps
	// snapshotting the files it was already tracking.
	const touched = new Set<string>();
	// The ref holding the in-flight run's checkpoint, moved as later baselines arrive.
	let runRef: string | undefined;
	let refSeq = 0;
	// True while /rewind drives navigateTree itself, so session_before_tree does not ask the
	// code question a second time (the rewind mode already answered it).
	let rewinding = false;

	function gitShadow(args: string[]): ReturnType<ExtensionAPI["exec"]> {
		if (!shadowDir || !workTree)
			return Promise.resolve({
				stdout: "",
				stderr: "shadow repo not initialized",
				code: 1,
				killed: false,
				truncated: false,
			});
		// A snapshot layer must be byte-faithful: with the host's autocrlf (the
		// Windows default) the shadow checkout would rewrite every restored file's
		// line endings, so conversion is pinned off for every shadow operation.
		return nycode.exec(
			"git",
			["-c", "core.autocrlf=false", "--git-dir", shadowDir, "--work-tree", workTree, ...args],
			{ cwd: workTree },
		);
	}

	async function ensureShadow(ctx: ExtensionContext): Promise<void> {
		workTree = ctx.cwd;
		const sessionFile = (ctx.sessionManager as { getSessionFile?: () => string | undefined }).getSessionFile?.();
		ephemeralShadow = sessionFile === undefined;
		const checkpointsRoot = path.join(getAgentDir(), "checkpoints");
		shadowDir = path.join(checkpointsRoot, sessionSlug(sessionFile));
		// A resumed session can arrive from a different directory than the one the shadow
		// snapshotted; restoring those commits here would silently overwrite unrelated
		// same-named files. Key a fresh shadow to this directory instead of ever checking
		// one tree out into another. Resuming back in the recorded directory takes the
		// original shadow again, so its checkpoints stay restorable there.
		const recorded = recordedWorkTree(shadowDir);
		if (recorded && path.resolve(recorded) !== path.resolve(ctx.cwd)) {
			shadowDir = path.join(checkpointsRoot, `${sessionSlug(sessionFile)}-${cwdSlug(ctx.cwd)}`);
			ctx.ui.notify(
				`Os checkpoints desta sessão foram gravados em ${recorded}; começando checkpoints novos para ${ctx.cwd} (os anteriores não podem ser restaurados aqui)`,
				"warning",
			);
		}
		pruneCheckpointRepos(checkpointsRoot, checkpointRetentionDays(os.homedir()), shadowDir);
		const check = await nycode.exec("git", ["--git-dir", shadowDir, "rev-parse", "--git-dir"], { cwd: ctx.cwd });
		if (check.code !== 0) {
			const init = await nycode.exec("git", ["init", "--bare", "-b", "main", shadowDir], { cwd: ctx.cwd });
			if (init.code !== 0) {
				// Every later snapshot fails against the missing repo, so without this the
				// user first learns /rewind is dead at the moment they need it.
				ctx.ui.notify(`Checkpoints desligados: ${init.stderr.trim() || "git init failed"}`, "warning");
				return;
			}
			await nycode.exec("git", ["--git-dir", shadowDir, "config", "user.email", "checkpoint@pi-code"], {
				cwd: ctx.cwd,
			});
			await nycode.exec("git", ["--git-dir", shadowDir, "config", "user.name", "pi-code-checkpoint"], {
				cwd: ctx.cwd,
			});
		}
		// Written on every start, so repos that predate the sidecar pick it up too.
		rememberWorkTree(shadowDir, ctx.cwd);
		await mirrorLocalExcludes(ctx);
	}

	/** /fork writes a new session file and copies the branch's checkpoint entries into it,
	 * while the shadow repository is keyed to the session file: the refs those entries name
	 * live in the parent's shadow, and a restore from the fork's own answered "invalid
	 * reference". A local bare-to-bare fetch brings them across. Best effort: a parent
	 * shadow already pruned leaves those checkpoints unrestorable, as they were. */
	async function inheritCheckpointRefs(previousSessionFile: string): Promise<void> {
		const parentShadow = path.join(getAgentDir(), "checkpoints", sessionSlug(previousSessionFile));
		if (parentShadow === shadowDir || !fs.existsSync(parentShadow)) return;
		await gitShadow(["fetch", "--quiet", parentShadow, `+${CHECKPOINT_REF_PREFIX}/*:${CHECKPOINT_REF_PREFIX}/*`]);
	}

	/** git reads ignore rules from the tree's .gitignore files, the user's global excludes,
	 * and $GIT_DIR/info/exclude. The shadow is the GIT_DIR here, so the repo's own
	 * .git/info/exclude (where secrets and scratch that must never be committed live)
	 * would be snapshotted and restored. Mirror it into the shadow on every start; the
	 * global excludes stay untouched (core.excludesFile is single-valued, so pointing it
	 * at the repo file would replace them). */
	async function mirrorLocalExcludes(ctx: ExtensionContext): Promise<void> {
		const cwd = ctx.cwd;
		if (!shadowDir) return;
		// Resolved through git so a linked worktree maps to its common dir; outside a repo
		// git exits 128 and there is nothing to mirror.
		const located = await nycode.exec("git", ["rev-parse", "--git-path", "info/exclude"], { cwd });
		const target = path.join(shadowDir, "info", "exclude");
		try {
			const source = located.code === 0 ? path.resolve(cwd, located.stdout.trim()) : undefined;
			if (source && fs.existsSync(source)) {
				fs.mkdirSync(path.dirname(target), { recursive: true });
				fs.copyFileSync(source, target);
			} else {
				fs.rmSync(target, { force: true });
			}
		} catch (error) {
			// Without the mirror, files the user excluded locally are snapshotted into the
			// checkpoint store and restored by /rewind, so this is not a silent fallback.
			ctx.ui.notify(
				`Os checkpoints não conseguem respeitar o .git/info/exclude deste repositório: ${errorMessage(error)}`,
				"warning",
			);
		}
	}

	/** A tracked file as git names it: a work-tree-relative slash-separated path, or
	 * undefined for anything outside the work tree, which git refuses as a pathspec.
	 * Paths are compared in this form throughout, never as absolutes: git echoes a
	 * pathspec back verbatim, while the same file can spell its absolute path two ways
	 * on Windows (a short 8.3 temp directory against its long form). */
	function workTreePath(file: string): string | undefined {
		if (!workTree) return undefined;
		const rel = path.relative(workTree, file);
		if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
		return rel.split(path.sep).join("/");
	}

	/** The paths the last checkpoint commit holds. A tracked file deleted since then still
	 * matches a pathspec through this, so its removal is staged instead of the stale index
	 * entry silently riding along into the next checkpoint. */
	async function committedPaths(): Promise<Set<string>> {
		// -z: without it git quotes and octal-escapes a non-ASCII name, and the quoted form
		// is a pathspec that matches nothing, which fails every later add of the session.
		const listed = await gitShadow(["ls-tree", "-r", "--name-only", "-z", "HEAD"]);
		if (listed.code !== 0) return new Set();
		return new Set(listed.stdout.split("\0").filter(Boolean));
	}

	/** git rejects the whole pathspec when one entry is ignored, so the ignored paths are
	 * dropped before the add rather than costing the run its checkpoint. */
	async function withoutIgnored(files: string[]): Promise<string[]> {
		const checked = await gitShadow(["-c", "core.quotePath=false", "check-ignore", "--", ...files]);
		if (checked.code !== 0) return files;
		const ignored = new Set(checked.stdout.split("\n").filter(Boolean));
		return files.filter((file) => !ignored.has(file));
	}

	/** The tracked files git will accept: inside the work tree, and either on disk or in
	 * the last commit. A pathspec matching neither aborts the entire add, taking the
	 * checkpoint with it. */
	async function addablePaths(): Promise<string[]> {
		const inside: Array<{ file: string; rel: string }> = [];
		for (const file of touched) {
			const rel = workTreePath(file);
			if (rel !== undefined) inside.push({ file, rel });
		}
		if (inside.length === 0) return [];
		const committed = await committedPaths();
		const live = inside.filter(({ file, rel }) => fs.existsSync(file) || committed.has(rel)).map(({ rel }) => rel);
		return live.length === 0 ? [] : withoutIgnored(live);
	}

	/** Point this run's ref at the commit. Publishing a ref rather than the raw sha lets a
	 * baseline captured later in the run move the checkpoint forward without rewriting a
	 * commit that an earlier checkpoint may share. */
	async function publishRun(sha: string, createdAt: string): Promise<{ ref: string; createdAt: string }> {
		const ref = `${CHECKPOINT_REF_PREFIX}/${Date.now().toString(36)}-${++refSeq}`;
		const update = await gitShadow(["update-ref", ref, sha]);
		if (update.code !== 0) return { ref: sha, createdAt };
		runRef = ref;
		return { ref, createdAt };
	}

	/** Fold a file's pre-edit content into the run's checkpoint. A file first edited part
	 * way through a run is absent from that run's pre-run snapshot, so without this its
	 * checkpoint holds no baseline and /rewind cannot undo that first edit. */
	/** `file` named by the real directory it sits in, when a symlink inside the work tree
	 * leads there. git refuses a pathspec that passes through a symlink ("beyond a symbolic
	 * link"), so the file has to be tracked where it really is. The real directory is mapped
	 * back under the work tree as the session spells it: a cwd that is itself a symlinked
	 * path (macOS /var) must not push every file outside the tree. */
	function throughSymlinks(file: string): string {
		if (!workTree) return file;
		try {
			const realTree = fs.realpathSync(workTree);
			const realDir = fs.realpathSync(path.dirname(file));
			const inside = path.relative(realTree, realDir);
			if (inside.startsWith("..") || path.isAbsolute(inside)) return file;
			return path.join(workTree, inside, path.basename(file));
		} catch {
			return file;
		}
	}

	async function captureBaseline(file: string): Promise<void> {
		const rel = workTreePath(file);
		if (!runRef || rel === undefined || !fs.existsSync(file)) return;
		if ((await withoutIgnored([rel])).length === 0) return;
		if (!(await addPaths([rel]))) return;
		// A commit, never an amend: the run's checkpoint can be a commit an earlier
		// checkpoint also points at, and rewriting it would strand that one. Its own message
		// lets a rewind to an earlier checkpoint find the file's content there.
		const commit = await commitShadow([], BASELINE_MESSAGE);
		if (commit.code !== 0) return;
		const sha = await gitShadow(["rev-parse", "HEAD"]);
		if (sha.code === 0) await gitShadow(["update-ref", runRef, sha.stdout.trim()]);
	}

	/** `checkout -f <ref> -- .` errors when the ref's tree holds no files, so an empty
	 * snapshot restores as a no-op rather than vetoing the whole rewind. */
	async function snapshotIsEmpty(ref: string): Promise<boolean> {
		const files = await gitShadow(["ls-tree", "-r", "--name-only", ref]);
		return files.code === 0 && files.stdout.trim() === "";
	}

	/** Stage what `git add` silently skipped. For a path under another repository (a
	 * workspace of clones, a submodule, $HOME) it exits 0 and stages nothing, so the edit
	 * was never snapshotted while /rewind still reported success. Such a file is written to
	 * the index directly, which `checkout` restores like any other entry. A deletion needs
	 * nothing here: `git add` does stage the removal of an entry the index already holds. */
	async function stageSkippedPaths(paths: string[]): Promise<void> {
		if (!workTree) return;
		const listed = await gitShadow(["ls-files", "-z", "--", ...paths]);
		if (listed.code !== 0) return;
		const indexed = new Set(listed.stdout.split("\0").filter(Boolean));
		for (const rel of paths) {
			if (!indexed.has(rel) && fs.existsSync(path.join(workTree, rel))) await indexDirectly(rel); // NOSONAR typescript:S9382 - git index lock forbids parallel index writes
		}
	}

	async function indexDirectly(rel: string): Promise<void> {
		if (!workTree) return;
		const blob = await gitShadow(["hash-object", "-w", "--", rel]);
		if (blob.code !== 0) return;
		const executable = (fs.statSync(path.join(workTree, rel)).mode & 0o111) !== 0;
		await gitShadow([
			"update-index",
			"--add",
			"--cacheinfo",
			`${executable ? "100755" : "100644"},${blob.stdout.trim()},${rel}`,
		]);
	}

	/** Stage the tracked paths. git fails the whole add when one pathspec is refused, which
	 * used to end checkpointing for the session over a single path. On a failure each path
	 * is added alone and one git still refuses is dropped from the edit set, so it costs
	 * its own checkpoint and nobody else's. False only when nothing could be staged. */
	async function addPaths(paths: string[]): Promise<boolean> {
		if ((await gitShadow(["add", "--", ...paths])).code === 0) {
			await stageSkippedPaths(paths);
			return true;
		}
		let staged = 0;
		for (const rel of paths) {
			const added = (await gitShadow(["add", "--", rel])).code === 0; // NOSONAR typescript:S9382 - git index lock forbids parallel adds
			if (added) staged++;
			else if (workTree) touched.delete(path.resolve(workTree, rel));
		}
		return staged > 0;
	}

	async function snapshot(): Promise<{ ref: string; createdAt: string } | undefined> {
		const createdAt = new Date().toISOString();
		const paths = await addablePaths();
		if (paths.length > 0 && !(await addPaths(paths))) return undefined;
		// Decide "nothing changed" from the index, not from the commit exit code: a commit can
		// also fail on the user's global signing or hooks config, and reusing HEAD then would
		// record a ref that predates the current tree, so /rewind restores the wrong state.
		// Untracked files are excluded because the work tree is full of files this session
		// never edited; counting them would make every run look changed.
		const status = await gitShadow(["status", "--porcelain", "--untracked-files=no"]);
		const nothingChanged = status.code === 0 && status.stdout.trim() === "";
		if (nothingChanged) {
			const head = await gitShadow(["rev-parse", "HEAD"]);
			if (head.code === 0) return publishRun(head.stdout.trim(), createdAt);
		}
		const commit = await commitShadow(nothingChanged ? ["--allow-empty"] : []);
		if (commit.code !== 0) return undefined; // real failure: do not record a stale ref
		const sha = await gitShadow(["rev-parse", "HEAD"]);
		return sha.code === 0 ? publishRun(sha.stdout.trim(), createdAt) : undefined;
	}

	/** Commit in the shadow repo, isolated from the user's global signing and hook config. */
	function commitShadow(extra: string[], message = "checkpoint"): ReturnType<ExtensionAPI["exec"]> {
		return gitShadow([
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.hooksPath=/dev/null",
			"commit",
			...extra,
			"-m",
			message,
		]);
	}

	/** A file the session first edited after this checkpoint was on disk, untouched, when it
	 * was taken, but the checkpoint's tree does not hold it: only files touched so far are
	 * snapshotted. The baseline commit that first recorded it after the checkpoint holds that
	 * content. A file created after the checkpoint first appears in a snapshot commit instead
	 * and is left in place, as documented. */
	async function restoreLaterBaselines(ref: string): Promise<void> {
		const inRef = await gitShadow(["ls-tree", "-r", "-z", "--name-only", ref]);
		const added = await gitShadow([...ADDED_FILES_LOG, `${ref}..HEAD`]);
		if (inRef.code !== 0 || added.code !== 0) return;
		const atCheckpoint = new Set(inRef.stdout.split("\0").filter(Boolean));
		const bySha = new Map<string, string[]>();
		for (const [file, commit] of firstAdditions(added.stdout, atCheckpoint)) {
			if (commit.baseline) bySha.set(commit.sha, [...(bySha.get(commit.sha) ?? []), file]);
		}
		for (const [sha, files] of bySha) {
			// Sequential on purpose: each checkout takes the shadow repo's index lock.
			await gitShadow(["checkout", "-f", sha, "--", ...files]); // NOSONAR typescript:S9382 - git's index lock forbids parallel checkouts
		}
	}

	async function restoreCode(ctx: Pick<ExtensionContext, "ui">, checkpoint: Checkpoint): Promise<boolean> {
		if (!checkpoint.ref) {
			ctx.ui.notify("Este ponto não tem snapshot de código · o código não foi alterado", "warning");
			return true;
		}
		if (await snapshotIsEmpty(checkpoint.ref)) {
			ctx.ui.notify("Este ponto não tem arquivos · o código não foi alterado", "warning");
			return true;
		}
		const result = await gitShadow(["checkout", "-f", checkpoint.ref, "--", "."]);
		if (result.code !== 0) {
			ctx.ui.notify(`Não foi possível restaurar o código: ${result.stderr.trim()}`, "warning");
			return false;
		}
		await restoreLaterBaselines(checkpoint.ref);
		return true;
	}

	async function runRestoreMode(ctx: ExtensionCommandContext, checkpoint: Checkpoint): Promise<void> {
		const chosen = await ctx.ui.select(
			`Voltar para “${checkpoint.prompt || "(prompt vazio)"}” · o que desfazer:`,
			RESTORE_CHOICES.map((choice) => choice.label),
		);
		const mode = RESTORE_CHOICES.find((choice) => choice.label === chosen)?.mode;
		if (!mode) return;
		if (mode !== "conversation" && mode !== "summary" && !(await restoreCode(ctx, checkpoint))) return;
		let promptInEditor = false;
		if (mode !== "code") {
			rewinding = true;
			try {
				const restored = await restoreConversation(ctx, checkpoint.entryId, mode === "summary");
				if (!restored) return;
				promptInEditor = restored.promptInEditor;
			} finally {
				rewinding = false;
			}
		}
		ctx.ui.notify(rewindResult(checkpoint.prompt, mode, promptInEditor), "info");
	}

	nycode.on("session_start", async (event, ctx) => {
		// nycode's CLI builds a fresh extension instance per session replacement; only RPC mode can
		// reuse one across sessions. A mid-turn /new there fires session_start on
		// the same instance after turn_start took the pre-run snapshot but before turn_end saved
		// it; that pending ref belongs to the previous session and must not attach to the next
		// session's first turn_end. Re-arm runNeedsSnapshot too, so the next run snapshots its
		// own tree even though the prior run left it false.
		pending = undefined;
		runNeedsSnapshot = true;
		promptedRun = false;
		runRef = undefined;
		await ensureShadow(ctx);
		const forkedFrom = event.reason === "fork" ? event.previousSessionFile : undefined;
		if (forkedFrom) await inheritCheckpointRefs(forkedFrom);
		touched.clear();
		for (const rel of await committedPaths()) touched.add(path.resolve(ctx.cwd, rel));
		checkpoints.clear();
		// The same cap the append path enforces: a resumed long session must not
		// rebuild a rewind list beyond the per-session limit.
		for (const checkpoint of capCheckpoints(storedCheckpoints(ctx))) checkpoints.set(checkpoint.entryId, checkpoint);
	});

	// A --no-session run has no session file, so nothing can ever resume it or run
	// /rewind from it again once the process exits: its shadow repo, left in place, was
	// pure waste for the 30 days until the retention sweep reached it. Only a genuine
	// quit removes it eagerly; 'new', 'resume' and 'reload' keep the process (and this
	// extension instance) alive, and 'fork' can write a session from the live run's
	// in-memory entries and then fetch refs from exactly this shadow at its own
	// session_start, so this one case is left for the retention sweep as before.
	nycode.on("session_shutdown", (event) => {
		if (ephemeralShadow && shadowDir && event.reason === "quit")
			fs.rmSync(shadowDir, { recursive: true, force: true });
	});

	// A new agent loop starts a run: the next turn_start snapshots the pre-run tree.
	// agent_start, not before_agent_start: before_agent_start does not fire for a queued
	// follow-up message delivered through agent.continue, so gating on it would leave that
	// follow-up's user message with no checkpoint. agent_start re-fires per agent.continue
	// (a retry, a compaction, or a follow-up), and the extra snapshot a retry produces is
	// discarded at turn_end, since that user message already has its checkpoint.
	nycode.on("agent_start", () => {
		runNeedsSnapshot = true;
	});

	// Snapshot code state before the LLM acts, once per run. The user message that
	// started the turn is not persisted yet at turn_start (it lands on message_end), so
	// the checkpoint is only keyed and saved at turn_end. The snapshot is awaited here so
	// it captures the touched files before the model's first edit; turn_end reads the
	// resolved value.
	// Only a prompt fires before_agent_start. A provider retry, an overflow recovery and a
	// queued follow-up all re-enter through agent.continue(), with agent_start alone.
	nycode.on("before_agent_start", () => {
		promptedRun = true;
	});

	/** The checkpoint a continued run is still working under: it re-entered with no new user
	 * message, so its prompt already has one. A snapshot taken there stages every tracked
	 * file at its MID-run content into the index the recorded checkpoint is later extended
	 * from (a baseline captured afterwards moved the checkpoint onto that content), and a
	 * file first edited in that turn had its baseline folded into the discarded ref. */
	function continuedCheckpoint(ctx: ExtensionContext): Checkpoint | undefined {
		// A queued follow-up is a new user message and needs its own snapshot. Optional: the
		// supported nycode range reaches runtimes that may not have the method.
		if (ctx.hasPendingMessages?.()) return undefined;
		const target = findLastUserMessage(ctx);
		return target ? checkpoints.get(target.entryId) : undefined;
	}

	nycode.on("turn_start", async (_event, ctx) => {
		if (!runNeedsSnapshot) return;
		runNeedsSnapshot = false;
		const prompted = promptedRun;
		promptedRun = false;
		// Claude: "Set to 1 to disable file checkpointing. The /rewind command will not be
		// able to restore code changes." No snapshot means turn_end's `if (!snap) return`
		// always fires, so no checkpoint is ever recorded.
		if (process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING === "1") return;
		const continued = prompted ? undefined : continuedCheckpoint(ctx);
		if (continued) {
			runRef = continued.ref;
			return;
		}
		pending = await snapshot();
	});

	// A checkpoint covers the files the session edited, so the tracked set grows as the
	// model works. The baseline is taken here, before the tool writes, because once the
	// tool has run the pre-edit content is gone.
	nycode.on("tool_call", async (event, ctx) => {
		if (!EDIT_TOOLS.has(event.toolName)) return;
		const target = fileToolTarget(event);
		if (target === undefined) return;
		const file = throughSymlinks(path.resolve(ctx.cwd, target));
		if (touched.has(file)) return;
		touched.add(file);
		await captureBaseline(file);
	});

	nycode.on("turn_end", (_event, ctx) => {
		const snap = pending;
		pending = undefined;
		if (!snap) return;

		const target = findLastUserMessage(ctx);
		if (!target) return;
		const recorded = checkpoints.get(target.entryId);
		if (recorded) {
			// A retry or follow-up re-ran agent_start and took a fresh snapshot, but this user
			// message already has its checkpoint. Discard the new one and keep folding later
			// baselines into the checkpoint that is actually recorded.
			runRef = recorded.ref;
			return;
		}

		const checkpoint: Checkpoint = {
			entryId: target.entryId,
			ref: snap.ref,
			prompt: target.prompt,
			createdAt: snap.createdAt,
		};
		checkpoints.set(checkpoint.entryId, checkpoint);
		// Bound the rewind list the way Claude does, dropping the oldest first.
		for (const stale of [...checkpoints.keys()].slice(
			0,
			Math.max(0, checkpoints.size - MAX_CHECKPOINTS_PER_SESSION),
		)) {
			checkpoints.delete(stale);
		}
		nycode.appendEntry(CUSTOM_TYPE, checkpoint);
	});

	nycode.registerCommand("rewind", {
		description: "Voltar o código e/ou a conversa a um ponto anterior",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			const ordered = [...checkpoints.values()].reverse();
			if (ordered.length === 0) {
				ctx.ui.notify("Nenhum checkpoint registrado ainda", "info");
				return;
			}
			const labels = ordered.map((checkpoint, index) => checkpointLabel(checkpoint, index));
			const choice = await ctx.ui.select("Voltar para:", labels);
			if (!choice) return;
			const checkpoint = ordered[labels.indexOf(choice)];
			if (checkpoint) await runRestoreMode(ctx, checkpoint);
		},
	});

	// /tree (Esc Esc with doubleEscapeAction 'tree') is the unified rewind. A checkpoint is keyed
	// by the user message entry that started its run, which is exactly what /tree selects when
	// rewinding to a prompt; any other target (an assistant reply, a tool result) has no snapshot
	// of its own state, so only an exact match asks. Declining or cancelling keeps the code and
	// never blocks the navigation.
	nycode.on("session_before_tree", async (event, ctx) => {
		if (rewinding || !ctx.hasUI) return;
		const checkpoint = checkpoints.get(event.preparation.targetId);
		if (!checkpoint?.ref) return;
		const choice = await ctx.ui.select(
			"Restaurar os arquivos para este ponto? As mudanças feitas depois dele se perdem.",
			[YES_RESTORE_CODE, NO_RESTORE_CODE],
		);
		if (choice !== YES_RESTORE_CODE) return;
		try {
			if (await restoreCode(ctx, checkpoint)) ctx.ui.notify("Código restaurado para este ponto", "info");
		} catch (error) {
			ctx.ui.notify(`Não foi possível restaurar o código: ${errorMessage(error)}`, "warning");
		}
	});

	nycode.on("session_before_fork", async (event, ctx) => {
		const checkpoint = checkpoints.get(event.entryId);
		if (!checkpoint?.ref || !ctx.hasUI) return;

		const choice = await ctx.ui.select(
			"Restaurar os arquivos para este ponto? As mudanças feitas depois dele se perdem.",
			[YES_RESTORE_CODE, NO_RESTORE_CODE],
		);
		if (choice === YES_RESTORE_CODE) {
			if (await snapshotIsEmpty(checkpoint.ref)) {
				ctx.ui.notify("Este ponto não tem arquivos · o código não foi alterado", "warning");
				return;
			}
			const result = await gitShadow(["checkout", "-f", checkpoint.ref, "--", "."]);
			ctx.ui.notify(
				result.code === 0
					? "Código restaurado para este ponto"
					: `Não foi possível restaurar o código: ${result.stderr.trim()}`,
				result.code === 0 ? "info" : "warning",
			);
		}
	});
}
