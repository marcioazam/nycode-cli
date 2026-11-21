// `nycode migrate from-pi`: one-time import of a pi agent directory into the nycode agent directory.
// Dry run by default; `--apply` writes. The origin is only read, never changed.
import { homedir } from "node:os";
import { resolve } from "node:path";
import { questionTerminal } from "../utils/terminal-question.ts";
import { applyPlan } from "./from-pi-apply.ts";
import { buildPlan, defaultSource, KEPT_DIRS, type Plan, type PlanFile } from "./from-pi-plan.ts";

export interface MigrateIo {
	log: (message: string) => void;
	error: (message: string) => void;
	isInteractive: boolean;
	confirm: (question: string) => Promise<boolean>;
}

export interface MigrateOptions {
	/** Destination: the nycode agent directory (`getAgentDir()`). */
	agentDir: string;
	io?: Partial<MigrateIo>;
}

const HELP = `Usage: nycode migrate from-pi [--from <dir>] [--apply]

Imports a pi agent directory into the nycode agent directory.

Options:
  --from <dir>   Origin directory (default: ~/.pi/agent)
  --dry-run      Print the plan and write nothing (default)
  --apply        Write the files; existing destination files are backed up first
  -h, --help     Show this help

Converts settings.json and local.env (only read when owned by you with mode 0600 or 0400) to nycode settings;
copies mcp.json (env and headers values become \${ENV} placeholders; credential-like args and urls are
listed, not rewritten), models.json, lsp.json, keybindings.json,
sessions/, memory/ (the memory extension store) and the project trust file. auth*.json is copied only with --apply, after an interactive
confirmation. The origin directory is never changed or deleted. Backups go to
<agent dir>/.backup-from-pi/<timestamp>/.`;

interface Parsed {
	apply: boolean;
	from: string | undefined;
	help: boolean;
	error: string | undefined;
}

function parseArgs(args: string[]): Parsed {
	const parsed: Parsed = { apply: false, from: undefined, help: false, error: undefined };
	let dryRun = false;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--apply") parsed.apply = true;
		else if (arg === "--dry-run") dryRun = true;
		else if (arg === "-h" || arg === "--help") parsed.help = true;
		else if (arg === "--from") {
			parsed.from = args[++i];
			if (!parsed.from) parsed.error = "--from needs a directory";
		} else if (arg.startsWith("--from=")) parsed.from = arg.slice("--from=".length);
		else parsed.error = `unknown argument: ${arg}`;
	}
	if (parsed.apply && dryRun) parsed.error = "--apply and --dry-run cannot be combined";
	return parsed;
}

function defaultIo(): MigrateIo {
	return {
		log: (message) => console.log(message),
		error: (message) => console.error(message),
		isInteractive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
		confirm: async (question) => {
			const answer = await questionTerminal(question, {
				output: process.stdout,
				signal: new AbortController().signal,
			});
			return /^y(es)?$/i.test(answer.trim());
		},
	};
}

function describeFile(file: PlanFile, apply: boolean, interactive: boolean): string {
	if (file.credential) {
		const how = apply
			? interactive
				? "asks for confirmation before copying"
				: "skipped: no interactive terminal"
			: "copied only with --apply, after an interactive confirmation";
		return `  ${file.rel}  credentials: ${how}`;
	}
	return `  ${file.action.padEnd(9)} ${file.rel}  (${file.label})`;
}

function formatPlan(plan: Plan, apply: boolean, interactive: boolean): string[] {
	const lines = [
		`nycode migrate from-pi (${apply ? "apply" : "dry run"})`,
		`  from: ${plan.source}`,
		`  to:   ${plan.dest}`,
		"",
		"Plan:",
	];
	const inKept = (f: PlanFile) => KEPT_DIRS.some((dir) => f.rel.startsWith(`${dir}/`));
	for (const file of plan.files.filter((f) => !inKept(f))) lines.push(describeFile(file, apply, interactive));
	for (const dir of KEPT_DIRS) {
		const entries = plan.files.filter((f) => f.rel.startsWith(`${dir}/`));
		if (entries.length === 0) continue;
		const fresh = entries.filter((f) => f.action === "create").length;
		lines.push(`  ${`${dir}/`.padEnd(9)} ${fresh} file(s) to copy, ${entries.length - fresh} already present (kept)`);
	}
	if (plan.notes.length > 0) lines.push("", "Notes:", ...plan.notes.map((n) => `  ${n}`));
	return lines;
}

/** Runs `nycode migrate ...`; resolves to the process exit code. */
export async function runMigrateCommand(args: string[], options: MigrateOptions): Promise<number> {
	const io: MigrateIo = { ...defaultIo(), ...options.io };
	if (args[0] !== "from-pi") {
		io.log(HELP);
		return args.length === 0 || args[0] === "--help" || args[0] === "-h" ? 0 : 1;
	}
	const parsed = parseArgs(args.slice(1));
	if (parsed.help) {
		io.log(HELP);
		return 0;
	}
	if (parsed.error) {
		io.error(`Error: ${parsed.error}\n\n${HELP}`);
		return 1;
	}

	const plan = buildPlan(resolve(parsed.from ?? defaultSource(homedir())), resolve(options.agentDir));
	if (plan.errors.length > 0) {
		for (const message of plan.errors) io.error(`Error: ${message}`);
		io.error("Nothing was written.");
		return 1;
	}
	for (const line of formatPlan(plan, parsed.apply, io.isInteractive)) io.log(line);
	if (!parsed.apply) {
		io.log("");
		io.log("Dry run: nothing was written. Re-run with --apply to write these files.");
		return 0;
	}

	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const result = await applyPlan(plan, io, stamp);
	io.log("");
	io.log(
		`Wrote ${result.written} file(s); ${result.backedUp} existing file(s) backed up to ${plan.dest}/.backup-from-pi/${stamp}/.`,
	);
	for (const message of result.skipped) io.log(`Skipped ${message}`);
	return 0;
}
