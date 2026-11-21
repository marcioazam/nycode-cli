import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CommandRunResult, ResolvedCommand } from "./types";

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathCandidates(bin: string): string[] {
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  const candidates: string[] = [];
  for (const entry of pathEntries) {
    for (const extension of extensions) {
      candidates.push(path.join(entry, `${bin}${extension}`));
    }
  }
  return candidates;
}

export function findExecutable(bin: string): string | undefined {
  if (path.isAbsolute(bin) || bin.includes("/") || bin.includes("\\")) {
    return isExecutable(bin) ? bin : undefined;
  }
  return pathCandidates(bin).find(isExecutable);
}

export function isExecutableAvailable(bin: string): boolean {
  return !!findExecutable(bin);
}

export async function runCommand(
  pi: ExtensionAPI,
  command: ResolvedCommand,
  signal?: AbortSignal,
): Promise<CommandRunResult> {
  const startedAt = Date.now();
  const execOptions = {
    cwd: command.cwd,
    timeout: command.timeoutMs,
    signal,
    env: command.env ? { ...process.env, ...command.env } : undefined,
  } as Parameters<ExtensionAPI["exec"]>[2] & { env?: NodeJS.ProcessEnv };

  const result = await pi.exec(command.bin, command.args, execOptions);

  return {
    id: command.id,
    bin: command.bin,
    args: command.args,
    cwd: command.cwd,
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.code,
    killed: result.killed,
    durationMs: Date.now() - startedAt,
  };
}
