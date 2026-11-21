import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ConfigKind } from "../types";

export interface TrustStore {
  version: 1;
  trustedHashes: string[];
}

export interface TrustDecision {
  trusted: boolean;
  persist: boolean;
  reason?: string;
}

export function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function getTrustStorePath(kind: ConfigKind, agentDir = process.env.PI_AGENT_DIR ?? path.join(process.env.HOME ?? "", ".pi", "agent")): string {
  return path.join(agentDir, "trust", `${kind}.json`);
}

async function readTrustStore(storePath: string): Promise<TrustStore> {
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<TrustStore>;
    return {
      version: 1,
      trustedHashes: Array.isArray(parsed.trustedHashes) ? parsed.trustedHashes.filter((item): item is string => typeof item === "string") : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, trustedHashes: [] };
    }
    throw error;
  }
}

async function writeTrustStore(storePath: string, store: TrustStore): Promise<void> {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function isHashTrusted(kind: ConfigKind, hash: string): Promise<boolean> {
  const store = await readTrustStore(getTrustStorePath(kind));
  return store.trustedHashes.includes(hash);
}

export async function rememberTrustedHash(kind: ConfigKind, hash: string): Promise<void> {
  const storePath = getTrustStorePath(kind);
  const store = await readTrustStore(storePath);
  if (!store.trustedHashes.includes(hash)) {
    store.trustedHashes.push(hash);
    await writeTrustStore(storePath, store);
  }
}

function formatBinaryList(binaries: string[]): string {
  const unique = [...new Set(binaries.filter(Boolean))];
  if (unique.length === 0) return "  (no binaries declared)";
  return unique.map((bin) => `  - ${bin}`).join("\n");
}

export async function askProjectConfigTrust(options: {
  ctx: ExtensionContext;
  kind: ConfigKind;
  configPath: string;
  hash: string;
  binaries: string[];
}): Promise<TrustDecision> {
  if (await isHashTrusted(options.kind, options.hash)) {
    return { trusted: true, persist: true };
  }

  if (!options.ctx.hasUI) {
    return { trusted: false, persist: false, reason: "project-local config rejected in non-interactive mode" };
  }

  const title = [
    `Project-local ${options.kind} config wants to auto-run binaries.`,
    "",
    `Config: ${options.configPath}`,
    `Hash: ${options.hash}`,
    "",
    "Binaries:",
    formatBinaryList(options.binaries),
    "",
    "Trust this config?",
  ].join("\n");

  const choice = await options.ctx.ui.select(title, ["Trust once", "Trust always", "Reject"]);

  if (choice === "Trust once") return { trusted: true, persist: false };
  if (choice === "Trust always") {
    await rememberTrustedHash(options.kind, options.hash);
    return { trusted: true, persist: true };
  }

  return { trusted: false, persist: false, reason: "project-local config rejected by user" };
}
