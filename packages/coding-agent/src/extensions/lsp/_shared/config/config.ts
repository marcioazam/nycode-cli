import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { findUp } from "../paths";
import { askProjectConfigTrust, sha256 } from "./trust";
import type { ConfigLayer, LoadedConfig, LspConfigFile, LspServerConfig, MatchableConfig } from "../types";

function defaultAgentDir(): string {
  return process.env.PI_AGENT_DIR ?? path.join(process.env.HOME ?? "", ".pi", "agent");
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function cleanStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function cleanStringRecord(value: unknown): Record<string, string> | undefined {
  const object = asObject(value);
  if (!object) return undefined;
  const out: Record<string, string> = {};
  for (const [key, recordValue] of Object.entries(object)) {
    if (typeof recordValue === "string") out[key] = recordValue;
  }
  return out;
}

function cleanNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cleanBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function cleanMatchable<T extends MatchableConfig>(object: Record<string, unknown>, extra: Omit<T, keyof MatchableConfig>): T | undefined {
  if (typeof object.id !== "string" || object.id.trim() === "") return undefined;
  return {
    id: object.id,
    enabled: cleanBoolean(object.enabled),
    include: cleanStringArray(object.include),
    exclude: cleanStringArray(object.exclude),
    rootMarkers: cleanStringArray(object.rootMarkers),
    maxFileSizeBytes: cleanNumber(object.maxFileSizeBytes),
    ...extra,
  } as T;
}

function parseLspItems(parsed: unknown): LspServerConfig[] {
  const root = asObject(parsed) as LspConfigFile | undefined;
  const servers = Array.isArray(root?.servers) ? root.servers : [];
  const out: LspServerConfig[] = [];

  for (const item of servers) {
    const object = asObject(item);
    if (!object) continue;
    const bin = typeof object.bin === "string" ? object.bin : "";
    if (object.enabled !== false && bin.trim() === "") continue;

    const cleaned = cleanMatchable<LspServerConfig>(object, {
      bin,
      args: cleanStringArray(object.args),
      cwd: typeof object.cwd === "string" ? object.cwd : undefined,
      env: cleanStringRecord(object.env),
      config: typeof object.config === "string" ? object.config : undefined,
      languageIdByExtension: cleanStringRecord(object.languageIdByExtension),
      startupTimeoutMs: cleanNumber(object.startupTimeoutMs),
      diagnosticsWaitMs: cleanNumber(object.diagnosticsWaitMs),
      initializationOptions: object.initializationOptions,
      settings: object.settings,
    });
    if (cleaned) out.push(cleaned);
  }

  return out;
}

async function readJsonLayer<TItem extends MatchableConfig>(options: {
  scope: "global" | "project";
  filePath: string;
  parseItems: (parsed: unknown) => TItem[];
}): Promise<ConfigLayer<TItem> | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(options.filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const parsed = JSON.parse(raw) as unknown;
  return {
    scope: options.scope,
    path: options.filePath,
    dir: path.dirname(options.filePath),
    raw,
    hash: sha256(raw),
    items: options.parseItems(parsed),
  };
}

function mergeLayers<TItem extends MatchableConfig>(layers: ConfigLayer<TItem>[]): TItem[] {
  const byId = new Map<string, TItem>();
  for (const layer of layers) {
    for (const item of layer.items) {
      if (item.enabled === false) {
        byId.delete(item.id);
        continue;
      }
      byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

function binariesForLsp(items: LspServerConfig[]): string[] {
  return items.map((item) => item.bin).filter(Boolean);
}

export async function loadLspConfig(ctx: ExtensionContext): Promise<LoadedConfig<LspServerConfig>> {
  const warnings: string[] = [];
  const layers: ConfigLayer<LspServerConfig>[] = [];
  const globalPath = path.join(defaultAgentDir(), "lsp.json");

  try {
    const globalLayer = await readJsonLayer({ scope: "global", filePath: globalPath, parseItems: parseLspItems });
    if (globalLayer) layers.push(globalLayer);
  } catch (error) {
    warnings.push(`Failed to load global lsp config: ${(error as Error).message}`);
  }

  const projectPath = findUp(ctx.cwd, path.join(".pi", "lsp.json"));
  if (projectPath) {
    try {
      const projectLayer = await readJsonLayer({ scope: "project", filePath: projectPath, parseItems: parseLspItems });
      if (projectLayer) {
        const decision = await askProjectConfigTrust({
          ctx,
          kind: "lsp",
          configPath: projectLayer.path,
          hash: projectLayer.hash,
          binaries: binariesForLsp(projectLayer.items),
        });
        if (decision.trusted) layers.push(projectLayer);
        else warnings.push(`${projectLayer.path}: ${decision.reason ?? "project-local config rejected"}`);
      }
    } catch (error) {
      warnings.push(`Failed to load project lsp config: ${(error as Error).message}`);
    }
  }

  return { items: mergeLayers(layers), layers, warnings };
}
