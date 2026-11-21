import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CommandConfig, PathPlaceholders, ResolvedCommand } from "./types";
import { applyTemplate, applyTemplateArray, applyTemplateRecord } from "./template";

export function expandHome(input: string): string {
  if (input === "~") return process.env.HOME ?? input;
  if (input.startsWith("~/")) return path.join(process.env.HOME ?? "~", input.slice(2));
  return input;
}

export function toAbsolutePath(inputPath: string, cwd: string): string {
  const expanded = expandHome(inputPath);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(cwd, expanded);
}

export function normalizeRelativePath(inputPath: string): string {
  const normalized = inputPath.split(path.sep).join("/");
  return normalized === "" ? "." : normalized;
}

export function isSubPathOrSame(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

export function markerExists(candidateDir: string, marker: string): boolean {
  return fs.existsSync(path.resolve(candidateDir, marker));
}

export function findProjectRoot(filePath: string, rootMarkers: string[] | undefined, fallbackRoot: string): string | undefined {
  const absoluteFile = toAbsolutePath(filePath, fallbackRoot);
  let dir = fs.existsSync(absoluteFile) && fs.statSync(absoluteFile).isDirectory() ? absoluteFile : path.dirname(absoluteFile);
  const markers = rootMarkers?.filter(Boolean) ?? [];

  if (markers.length === 0) {
    return toAbsolutePath(fallbackRoot, process.cwd());
  }

  while (true) {
    if (markers.some((marker) => markerExists(dir, marker))) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function findUp(startDir: string, relativeFile: string): string | undefined {
  let dir = toAbsolutePath(startDir, process.cwd());
  while (true) {
    const candidate = path.join(dir, relativeFile);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function resolveConfigPath(config: string | undefined, root: string, baseValues: PathPlaceholders): string | undefined {
  if (!config) return undefined;
  const templated = applyTemplate(config, baseValues);
  const expanded = expandHome(templated);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(root, expanded);
}

export function createPathPlaceholders(options: {
  workspace: string;
  root: string;
  file: string;
  config?: string;
}): PathPlaceholders {
  const workspace = toAbsolutePath(options.workspace, process.cwd());
  const root = toAbsolutePath(options.root, workspace);
  const file = toAbsolutePath(options.file, root);
  const dir = path.dirname(file);
  const relFile = normalizeRelativePath(path.relative(root, file));
  const relDir = normalizeRelativePath(path.relative(root, dir));
  const config = options.config ? toAbsolutePath(options.config, root) : "";
  const configDir = config ? path.dirname(config) : "";

  return { workspace, root, file, relFile, dir, relDir, config, configDir };
}

export function resolveExecutable(bin: string, root: string): string {
  const expanded = expandHome(bin);
  if (path.isAbsolute(expanded)) return path.normalize(expanded);
  if (expanded.includes("/") || expanded.includes("\\")) return path.resolve(root, expanded);
  return expanded;
}

export function resolveWorkingDirectory(cwd: string | undefined, root: string, values: PathPlaceholders): string {
  if (!cwd) return root;
  const templated = applyTemplate(cwd, values);
  const expanded = expandHome(templated);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(root, expanded);
}

export function resolveCommand(id: string, command: CommandConfig, options: {
  workspace: string;
  root: string;
  file: string;
}): ResolvedCommand {
  const baseValues = createPathPlaceholders({
    workspace: options.workspace,
    root: options.root,
    file: options.file,
  });
  const configPath = resolveConfigPath(command.config, options.root, baseValues);
  const values = createPathPlaceholders({
    workspace: options.workspace,
    root: options.root,
    file: options.file,
    config: configPath,
  });

  return {
    id,
    bin: resolveExecutable(applyTemplate(command.bin, values), options.root),
    args: applyTemplateArray(command.args, values),
    cwd: resolveWorkingDirectory(command.cwd, options.root, values),
    env: applyTemplateRecord(command.env, values),
    timeoutMs: command.timeoutMs,
    configPath,
    placeholders: values,
  };
}

export function filePathToUri(filePath: string): string {
  return pathToFileURL(path.resolve(filePath)).toString();
}

export function uriToFilePath(uri: string): string {
  return fileURLToPath(uri);
}
