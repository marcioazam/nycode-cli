// Writes a `migrate from-pi` plan into the nycode agent directory, backing up every file it replaces.
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
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

function writeOne(file: PlanFile, dest: string): void {
	const path = join(dest, file.rel);
	mkdirSync(dirname(path), { recursive: true });
	if (file.data === undefined) copyFileSync(file.from as string, path);
	else writeFileSync(path, file.data);
	if (file.mode !== undefined) chmodSync(path, file.mode);
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
			mkdirSync(dirname(backup), { recursive: true });
			copyFileSync(join(plan.dest, file.rel), backup);
			result.backedUp++;
		}
		writeOne(file, plan.dest);
		result.written++;
	}
	return result;
}
