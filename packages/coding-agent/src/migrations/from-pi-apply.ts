// Writes a `migrate from-pi` plan into the nycode agent directory, backing up every file it replaces.
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Plan, PlanFile } from "./from-pi-plan.ts";

export interface ApplyIo {
	log: (message: string) => void;
	isInteractive: boolean;
	confirm: (question: string) => Promise<boolean>;
}

export interface ApplyResult {
	written: number;
	backedUp: number;
	skipped: string[];
}

const BACKUP_DIR = ".backup-from-pi";
const PRIVATE_DIR = 0o700;

/** Sensitive files are created 0600 in a sibling temp file and renamed, so they are never readable by others. */
function writeFile(path: string, data: Buffer | string, mode: number | undefined): void {
	if (mode === undefined) {
		writeFileSync(path, data);
		return;
	}
	const temp = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
	try {
		writeFileSync(temp, data, { flag: "wx", mode });
		renameSync(temp, path);
	} catch (error) {
		rmSync(temp, { force: true });
		throw error;
	}
}

function writeOne(file: PlanFile, dest: string): void {
	const path = join(dest, file.rel);
	mkdirSync(dest, { recursive: true, mode: PRIVATE_DIR });
	mkdirSync(dirname(path), { recursive: true });
	if (file.data === undefined && file.mode === undefined) copyFileSync(file.from as string, path);
	else writeFile(path, file.data ?? readFileSync(file.from as string), file.mode);
}

async function wanted(file: PlanFile, io: ApplyIo, skipped: string[]): Promise<boolean> {
	if (file.action === "unchanged" || file.action === "keep") return false;
	if (!file.credential) return true;
	if (!io.isInteractive) {
		skipped.push(`${file.rel}: no interactive terminal`);
		return false;
	}
	if (await io.confirm(`Copy ${file.rel} (credentials) to the nycode agent directory? [y/N] `)) return true;
	skipped.push(`${file.rel}: declined`);
	return false;
}

/** Applies the plan: files that exist in the destination are copied to `.backup-from-pi/<stamp>/` first. */
export async function applyPlan(plan: Plan, io: ApplyIo, stamp: string): Promise<ApplyResult> {
	const result: ApplyResult = { written: 0, backedUp: 0, skipped: [] };
	for (const file of plan.files) {
		if (!(await wanted(file, io, result.skipped))) continue;
		if (file.action === "overwrite") {
			const backup = join(plan.dest, BACKUP_DIR, stamp, file.rel);
			mkdirSync(join(plan.dest, BACKUP_DIR, stamp), { recursive: true, mode: PRIVATE_DIR });
			mkdirSync(dirname(backup), { recursive: true });
			if (file.mode === undefined) copyFileSync(join(plan.dest, file.rel), backup);
			else writeFile(backup, readFileSync(join(plan.dest, file.rel)), file.mode);
			result.backedUp++;
		}
		writeOne(file, plan.dest);
		result.written++;
	}
	return result;
}
