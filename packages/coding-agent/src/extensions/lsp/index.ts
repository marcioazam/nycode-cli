import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { Box, Spacer, Text } from "@nycode/tui";
import { Type } from "typebox";
import type { MessageConnection } from "vscode-jsonrpc";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node.js";
import {
	DefinitionRequest,
	type Diagnostic,
	DidChangeConfigurationNotification,
	DidChangeTextDocumentNotification,
	DidOpenTextDocumentNotification,
	DidSaveTextDocumentNotification,
	DocumentSymbolRequest,
	HoverRequest,
	InitializedNotification,
	InitializeRequest,
	type InitializeResult,
	PublishDiagnosticsNotification,
	ReferencesRequest,
	type ServerCapabilities,
} from "vscode-languageserver-protocol";
import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import { loadLspConfig } from "./_shared/config/config.ts";
import { isPathIncluded, matchesAnyGlob } from "./_shared/glob.ts";
import { formatLspDiagnostics, formatWarnings, hasIssueOutput, joinSections } from "./_shared/output.ts";
import {
	filePathToUri,
	findProjectRoot,
	normalizeRelativePath,
	resolveCommand,
	toAbsolutePath,
	uriToFilePath,
} from "./_shared/paths.ts";
import { isExecutableAvailable } from "./_shared/runner.ts";
import type { LspServerConfig, ResolvedCommand, StoredDiagnostics } from "./_shared/types.ts";
// Post-edit text carries errors only (see post-edit.ts).
import { formatPostEdit, oncePerSession } from "./post-edit.ts";
import { terminateChild } from "./process.ts";

const DEFAULT_STARTUP_TIMEOUT_MS = 45_000;
const DEFAULT_DIAGNOSTICS_WAIT_MS = 1_500;
const DEFAULT_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const SHUTDOWN_WRITE_TIMEOUT_MS = 100;

interface MatchedServer {
	server: LspServerConfig;
	root: string;
	relFile: string;
}

interface OpenDocument {
	file: string;
	uri: string;
	languageId: string;
	version: number;
	text: string;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	if (signal?.aborted) return Promise.reject(new Error("aborted"));
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(resolve, ms);
		const abort = () => {
			clearTimeout(timeout);
			reject(new Error("aborted"));
		};
		signal?.addEventListener("abort", abort, { once: true });
	});
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
	let timeout: NodeJS.Timeout | undefined;
	const timeoutPromise = new Promise<never>((_resolve, reject) => {
		timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
	});
	return Promise.race([promise, timeoutPromise]).finally(() => {
		if (timeout) clearTimeout(timeout);
	});
}

function canWriteToChild(child: ChildProcessWithoutNullStreams): boolean {
	return (
		child.exitCode === null &&
		child.signalCode === null &&
		child.stdin.writable &&
		!child.stdin.destroyed &&
		!child.stdin.writableEnded
	);
}

async function bestEffortWriteJsonRpc(
	child: ChildProcessWithoutNullStreams,
	message: Record<string, unknown>,
): Promise<void> {
	if (!canWriteToChild(child)) return;

	const json = JSON.stringify(message);
	const payload = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
	await new Promise<void>((resolve) => {
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			clearTimeout(timeout);
			resolve();
		};
		const timeout = setTimeout(finish, SHUTDOWN_WRITE_TIMEOUT_MS);
		timeout.unref();

		try {
			child.stdin.write(payload, "utf8", finish);
		} catch {
			finish();
		}
	});
}

function getEventPath(input: Record<string, unknown>): string | undefined {
	return typeof input.path === "string" && input.path.trim() ? input.path : undefined;
}

async function readTextFile(file: string): Promise<string> {
	return fs.readFile(file, "utf8");
}

async function fileSizeAllowed(file: string, limit: number): Promise<boolean> {
	const stat = await fs.stat(file);
	return stat.size <= limit;
}

function languageIdForFile(server: LspServerConfig, file: string): string {
	const extension = path.extname(file);
	return server.languageIdByExtension?.[extension] ?? (extension.replace(/^\./, "") || "plaintext");
}

function couldMatchBeforeRoot(file: string, cwd: string, include?: string[], exclude?: string[]): boolean {
	const candidates = [...new Set([normalizeRelativePath(path.relative(cwd, file)), path.basename(file)])];
	const included =
		!include || include.length === 0 || candidates.some((candidate) => matchesAnyGlob(include, candidate));
	if (!included) return false;
	return !candidates.some((candidate) => matchesAnyGlob(exclude, candidate));
}

function supportsSave(capabilities: ServerCapabilities | undefined): boolean {
	const sync = capabilities?.textDocumentSync;
	if (!sync || typeof sync === "number") return false;
	return !!sync.save;
}

function clientKey(serverId: string, root: string): string {
	return `${serverId}\u0000${root}`;
}

function formatUnknownResult(value: unknown): string {
	if (value === null || value === undefined) return "No result";
	if (typeof value === "string") return value;
	return JSON.stringify(value, null, 2);
}

function textToolResult(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

function customMessageText(content: unknown, details: unknown): string {
	const summary = (details as { summary?: unknown } | undefined)?.summary;
	if (typeof summary === "string") return summary;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((item): item is { type: string; text: string } => item?.type === "text" && typeof item.text === "string")
		.map((item) => item.text)
		.join("\n");
}

function registerDiagnosticsRenderer(nycode: ExtensionAPI): void {
	nycode.registerMessageRenderer("lsp-diagnostics", (message, _options, theme) => {
		const text = customMessageText(message.content, message.details);
		const box = new Box(1, 1, (value) => theme.bg("toolSuccessBg", value));
		box.addChild(new Text(theme.fg("toolTitle", theme.bold("lsp_diagnostics")), 0, 0));
		if (text.trim()) {
			box.addChild(new Spacer(1));
			box.addChild(new Text(theme.fg("toolOutput", text), 0, 0));
		}
		return box;
	});
}

class DocumentStore {
	private readonly documents = new Map<string, OpenDocument>();

	get(file: string): OpenDocument | undefined {
		return this.documents.get(file);
	}

	open(file: string, languageId: string, text: string): OpenDocument {
		const doc: OpenDocument = { file, uri: filePathToUri(file), languageId, version: 1, text };
		this.documents.set(file, doc);
		return doc;
	}

	change(file: string, text: string): OpenDocument {
		const existing = this.documents.get(file);
		if (!existing) throw new Error(`document not opened: ${file}`);
		const updated: OpenDocument = { ...existing, version: existing.version + 1, text };
		this.documents.set(file, updated);
		return updated;
	}

	values(): OpenDocument[] {
		return [...this.documents.values()];
	}
}

class DiagnosticsStore {
	private readonly diagnostics = new Map<string, StoredDiagnostics>();

	private key(serverId: string, root: string, file: string): string {
		return `${serverId}\u0000${root}\u0000${file}`;
	}

	set(serverId: string, root: string, uri: string, diagnostics: Diagnostic[], version?: number): void {
		const file = uriToFilePath(uri);
		const key = this.key(serverId, root, file);
		if (diagnostics.length === 0) {
			this.diagnostics.delete(key);
			return;
		}
		this.diagnostics.set(key, {
			serverId,
			root,
			file,
			version,
			diagnostics,
			updatedAt: Date.now(),
		});
	}

	get(serverId: string, root: string, file: string): StoredDiagnostics | undefined {
		return this.diagnostics.get(this.key(serverId, root, file));
	}

	getAllForFile(file: string): StoredDiagnostics[] {
		return [...this.diagnostics.values()].filter((entry) => entry.file === file);
	}
}

class LspClient {
	private process: ChildProcessWithoutNullStreams | undefined;
	private connection: MessageConnection | undefined;
	private capabilities: ServerCapabilities | undefined;
	private readonly documents = new DocumentStore();
	private startPromise: Promise<void> | undefined;
	private unavailableReason: string | undefined;
	private stderrTail = "";
	private readonly server: LspServerConfig;
	private readonly root: string;
	private readonly command: ResolvedCommand;
	private readonly diagnostics: DiagnosticsStore;

	constructor(server: LspServerConfig, root: string, command: ResolvedCommand, diagnostics: DiagnosticsStore) {
		this.server = server;
		this.root = root;
		this.command = command;
		this.diagnostics = diagnostics;
	}

	get isUnavailable(): boolean {
		return !!this.unavailableReason;
	}

	get reason(): string | undefined {
		return this.unavailableReason;
	}

	async ensureStarted(signal?: AbortSignal): Promise<void> {
		if (this.connection && !this.unavailableReason) return;
		if (this.unavailableReason) throw new Error(this.unavailableReason);
		this.startPromise ??= this.start(signal);
		await this.startPromise;
	}

	private async start(signal?: AbortSignal): Promise<void> {
		if (!isExecutableAvailable(this.command.bin)) {
			this.unavailableReason = `${this.server.id}: LSP binary not found: ${this.command.bin}`;
			throw new Error(this.unavailableReason);
		}

		const child = spawn(this.command.bin, this.command.args, {
			cwd: this.command.cwd,
			env: this.command.env ? { ...process.env, ...this.command.env } : process.env,
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.process = child;
		child.stderr.on("data", (chunk: Buffer) => {
			this.stderrTail = `${this.stderrTail}${chunk.toString()}`.slice(-4000);
		});
		child.on("exit", (code, sig) => {
			this.unavailableReason = `${this.server.id}: LSP exited (${code ?? sig ?? "unknown"})${this.stderrTail ? `: ${this.stderrTail.trim()}` : ""}`;
			this.connection?.dispose();
			this.connection = undefined;
		});

		const connection = createMessageConnection(
			new StreamMessageReader(child.stdout),
			new StreamMessageWriter(child.stdin),
		);
		this.connection = connection;
		this.registerHandlers(connection);
		connection.listen();

		const initializeResult = (await withTimeout(
			connection.sendRequest(InitializeRequest.method, this.initializeParams()),
			this.server.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
			`${this.server.id} initialize`,
		)) as InitializeResult;
		this.capabilities = initializeResult.capabilities;

		await connection.sendNotification(InitializedNotification.method, {});
		if (this.server.settings !== undefined) {
			await connection.sendNotification(DidChangeConfigurationNotification.method, {
				settings: this.server.settings,
			});
		}

		if (signal?.aborted) throw new Error("aborted");
	}

	private initializeParams() {
		const rootUri = filePathToUri(this.root);
		return {
			processId: process.pid,
			rootUri,
			workspaceFolders: [{ name: path.basename(this.root), uri: rootUri }],
			capabilities: {
				window: { workDoneProgress: true },
				workspace: {
					configuration: true,
					workspaceFolders: true,
					didChangeWatchedFiles: { dynamicRegistration: true },
				},
				textDocument: {
					synchronization: {
						didOpen: true,
						didChange: true,
						didSave: true,
					},
					publishDiagnostics: {
						relatedInformation: true,
						versionSupport: true,
					},
					hover: {},
					definition: {},
					references: {},
					documentSymbol: {},
				},
			},
			initializationOptions: this.server.initializationOptions ?? {},
		};
	}

	private registerHandlers(connection: MessageConnection): void {
		connection.onNotification(
			PublishDiagnosticsNotification.method,
			(params: { uri: string; diagnostics: Diagnostic[]; version?: number }) => {
				this.diagnostics.set(this.server.id, this.root, params.uri, params.diagnostics, params.version);
			},
		);

		const anyConnection = connection as unknown as {
			onRequest(method: string, handler: (params: unknown) => unknown): void;
			onNotification(method: string, handler: (params: unknown) => void): void;
		};

		anyConnection.onRequest("workspace/configuration", (params: unknown) => {
			const items = (params as { items?: unknown[] } | undefined)?.items;
			if (!Array.isArray(items)) return [this.server.settings ?? {}];
			return items.map(() => this.server.settings ?? {});
		});
		anyConnection.onRequest("workspace/workspaceFolders", () => [
			{ name: path.basename(this.root), uri: filePathToUri(this.root) },
		]);
		anyConnection.onRequest("client/registerCapability", () => null);
		anyConnection.onRequest("client/unregisterCapability", () => null);
		anyConnection.onRequest("window/workDoneProgress/create", () => null);
		anyConnection.onNotification("window/logMessage", () => undefined);
		anyConnection.onNotification("telemetry/event", () => undefined);
	}

	async openOrChange(file: string, languageId: string, text: string, signal?: AbortSignal): Promise<OpenDocument> {
		await this.ensureStarted(signal);
		if (!this.connection) throw new Error(`${this.server.id}: LSP connection unavailable`);

		const existing = this.documents.get(file);
		if (!existing) {
			const doc = this.documents.open(file, languageId, text);
			await this.connection.sendNotification(DidOpenTextDocumentNotification.method, {
				textDocument: {
					uri: doc.uri,
					languageId: doc.languageId,
					version: doc.version,
					text: doc.text,
				},
			});
			return doc;
		}

		const doc = this.documents.change(file, text);
		await this.connection.sendNotification(DidChangeTextDocumentNotification.method, {
			textDocument: { uri: doc.uri, version: doc.version },
			contentChanges: [{ text: doc.text }],
		});
		return doc;
	}

	async didSave(file: string): Promise<void> {
		if (!this.connection || !supportsSave(this.capabilities)) return;
		const doc = this.documents.get(file);
		if (!doc) return;
		await this.connection.sendNotification(DidSaveTextDocumentNotification.method, {
			textDocument: { uri: doc.uri },
			text: doc.text,
		});
	}

	async hover(file: string, line: number, character: number): Promise<unknown> {
		if (!this.connection) throw new Error(`${this.server.id}: LSP connection unavailable`);
		return withTimeout(
			this.connection.sendRequest(HoverRequest.method, {
				textDocument: { uri: filePathToUri(file) },
				position: { line, character },
			}),
			REQUEST_TIMEOUT_MS,
			`${this.server.id} hover`,
		);
	}

	async definition(file: string, line: number, character: number): Promise<unknown> {
		if (!this.connection) throw new Error(`${this.server.id}: LSP connection unavailable`);
		return withTimeout(
			this.connection.sendRequest(DefinitionRequest.method, {
				textDocument: { uri: filePathToUri(file) },
				position: { line, character },
			}),
			REQUEST_TIMEOUT_MS,
			`${this.server.id} definition`,
		);
	}

	async references(file: string, line: number, character: number, includeDeclaration: boolean): Promise<unknown> {
		if (!this.connection) throw new Error(`${this.server.id}: LSP connection unavailable`);
		return withTimeout(
			this.connection.sendRequest(ReferencesRequest.method, {
				textDocument: { uri: filePathToUri(file) },
				position: { line, character },
				context: { includeDeclaration },
			}),
			REQUEST_TIMEOUT_MS,
			`${this.server.id} references`,
		);
	}

	async symbols(file: string): Promise<unknown> {
		if (!this.connection) throw new Error(`${this.server.id}: LSP connection unavailable`);
		return withTimeout(
			this.connection.sendRequest(DocumentSymbolRequest.method, {
				textDocument: { uri: filePathToUri(file) },
			}),
			REQUEST_TIMEOUT_MS,
			`${this.server.id} document symbols`,
		);
	}

	async shutdown(): Promise<void> {
		const connection = this.connection;
		const child = this.process;
		this.connection = undefined;
		this.process = undefined;

		if (child) {
			await bestEffortWriteJsonRpc(child, { jsonrpc: "2.0", id: "lsp-shutdown", method: "shutdown" });
			await bestEffortWriteJsonRpc(child, { jsonrpc: "2.0", method: "exit" });
		}

		connection?.dispose();

		if (child) terminateChild(child);
	}
}

class LspManager {
	private readonly diagnostics = new DiagnosticsStore();
	private readonly clients = new Map<string, LspClient>();
	private readonly backoff = new Map<string, { retryAt: number; attempts: number; reason: string }>();
	// Warnings and failures already shown in this session (see post-edit.ts).
	private readonly reported = new Set<string>();

	async matchingServers(
		ctx: ExtensionContext,
		file: string,
	): Promise<{ matches: MatchedServer[]; warnings: string[]; workspace: string }> {
		const loaded = await loadLspConfig(ctx);
		const warnings = [...loaded.warnings];
		const projectLayer = loaded.layers.find((layer) => layer.scope === "project");
		const workspace = projectLayer ? path.dirname(projectLayer.dir) : ctx.cwd;
		const matches: MatchedServer[] = [];

		for (const server of loaded.items) {
			if (server.enabled === false) continue;
			if (!couldMatchBeforeRoot(file, ctx.cwd, server.include, server.exclude)) continue;

			const root = findProjectRoot(file, server.rootMarkers, ctx.cwd);
			if (!root) {
				warnings.push(`${server.id}: root markers not found (${(server.rootMarkers ?? []).join(", ") || "none"})`);
				continue;
			}
			const relFile = normalizeRelativePath(path.relative(root, file));
			if (relFile.startsWith("..") || path.isAbsolute(relFile)) continue;
			if (!isPathIncluded(relFile, server.include, server.exclude)) continue;
			matches.push({ server, root, relFile });
		}

		return { matches, warnings, workspace };
	}

	private async getClient(
		server: LspServerConfig,
		root: string,
		file: string,
		workspace: string,
		signal?: AbortSignal,
	): Promise<LspClient> {
		const key = clientKey(server.id, root);
		const backoff = this.backoff.get(key);
		if (backoff && Date.now() < backoff.retryAt) {
			throw new Error(
				`${server.id}: unavailable (${backoff.reason}); retry after ${new Date(backoff.retryAt).toISOString()}`,
			);
		}

		let client = this.clients.get(key);
		if (!client || client.isUnavailable) {
			const command = resolveCommand(server.id, server, { workspace, root, file });
			client = new LspClient(server, root, command, this.diagnostics);
			this.clients.set(key, client);
		}

		try {
			await client.ensureStarted(signal);
			this.backoff.delete(key);
			return client;
		} catch (error) {
			const previous = this.backoff.get(key);
			const attempts = (previous?.attempts ?? 0) + 1;
			const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6));
			this.backoff.set(key, { attempts, retryAt: Date.now() + delayMs, reason: (error as Error).message });
			throw error;
		}
	}

	async updateDiagnosticsForFile(ctx: ExtensionContext, file: string): Promise<string> {
		const { matches, warnings: allWarnings, workspace } = await this.matchingServers(ctx, file);
		// No "root markers not found" warning; every other warning once per session.
		const warnings = allWarnings.filter(
			(w) => !w.includes("root markers not found") && oncePerSession(this.reported, w),
		);
		if (matches.length === 0) return formatWarnings("LSP diagnostics", warnings);

		const lines: string[] = [];
		for (const match of matches) {
			try {
				const maxFileSizeBytes = match.server.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
				if (!(await fileSizeAllowed(file, maxFileSizeBytes))) {
					// The oversized-file warning is left out of the post-edit text.
					continue;
				}

				const text = await readTextFile(file);
				const client = await this.getClient(match.server, match.root, file, workspace, ctx.signal);
				const languageId = languageIdForFile(match.server, file);
				await client.openOrChange(file, languageId, text, ctx.signal);
				await client.didSave(file);
				await delay(match.server.diagnosticsWaitMs ?? DEFAULT_DIAGNOSTICS_WAIT_MS, ctx.signal);
				const entry = this.diagnostics.get(match.server.id, match.root, file);
				// Errors only; empty when there is nothing to say.
				const text2 = formatPostEdit(match.server.id, file, entry?.diagnostics ?? [], match.root);
				if (text2) lines.push(text2);
			} catch (error) {
				// A server failure is reported once per session.
				const message = (error as Error).message;
				if (oncePerSession(this.reported, `${match.server.id}: ${message}`))
					lines.push(`⚠️ ${match.server.id}: ${message}`);
			}
		}

		return [formatWarnings("LSP diagnostics", warnings), joinSections("LSP diagnostics", lines)]
			.filter(Boolean)
			.join("\n\n");
	}

	async ensureDocumentForTool(
		ctx: ExtensionContext,
		inputPath: string,
	): Promise<{ file: string; match: MatchedServer; client: LspClient; workspace: string } | undefined> {
		const file = toAbsolutePath(inputPath, ctx.cwd);
		const { matches, workspace } = await this.matchingServers(ctx, file);
		const match = matches[0];
		if (!match) return undefined;
		const text = await readTextFile(file);
		const client = await this.getClient(match.server, match.root, file, workspace, ctx.signal);
		await client.openOrChange(file, languageIdForFile(match.server, file), text, ctx.signal);
		return { file, match, client, workspace };
	}

	diagnosticsForPath(ctx: ExtensionContext, inputPath: string): string {
		const file = toAbsolutePath(inputPath, ctx.cwd);
		const entries = this.diagnostics.getAllForFile(file);
		if (entries.length === 0) return `LSP diagnostics:\n\n✅ no diagnostics recorded for ${file}`;
		return joinSections(
			"LSP diagnostics",
			entries.map((entry) => formatLspDiagnostics(entry.serverId, entry.file, entry.diagnostics, entry.root)),
		);
	}

	async shutdownAll(): Promise<void> {
		const clients = [...this.clients.values()];
		this.clients.clear();
		await Promise.allSettled(clients.map((client) => client.shutdown()));
	}
}

const POSITION_PARAMS = Type.Object({
	path: Type.String({ description: "File path" }),
	line: Type.Number({ description: "Zero-based line number" }),
	character: Type.Number({ description: "Zero-based UTF-16 character offset" }),
});

const REFERENCES_PARAMS = Type.Object({
	path: Type.String({ description: "File path" }),
	line: Type.Number({ description: "Zero-based line number" }),
	character: Type.Number({ description: "Zero-based UTF-16 character offset" }),
	includeDeclaration: Type.Optional(
		Type.Boolean({ default: false, description: "Include the declaration in references" }),
	),
});

export default function lspExtension(nycode: ExtensionAPI) {
	const manager = new LspManager();
	registerDiagnosticsRenderer(nycode);

	nycode.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
		if (event.isError) return undefined;

		const inputPath = getEventPath(event.input);
		if (!inputPath) return undefined;

		const file = toAbsolutePath(inputPath, ctx.cwd);
		const summary = await manager.updateDiagnosticsForFile(ctx, file);
		if (!summary.trim()) return undefined;

		// The upstream package (0.1.7) also sent an empty "steer" message when there were problems. The diagnostics already
		// travel in the tool result; the empty steer arrived after the final answer and caused empty turns plus
		// HTTP 400 ("does not support assistant message prefill"). Removed.
		void hasIssueOutput;

		return { content: [...event.content, { type: "text", text: summary }] };
	});

	nycode.on("session_shutdown", async () => {
		await manager.shutdownAll();
	});

	nycode.registerTool({
		name: "lsp_diagnostics",
		label: "LSP Diagnostics",
		description: "Return latest LSP diagnostics collected for a file.",
		promptSnippet: "Inspect latest LSP diagnostics for a file",
		promptGuidelines: ["Use lsp_diagnostics to inspect latest LSP diagnostics after editing code."],
		parameters: Type.Object({ path: Type.String({ description: "File path" }) }),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) return textToolResult("Cancelled");
			return textToolResult(manager.diagnosticsForPath(ctx, params.path));
		},
	});

	nycode.registerTool({
		name: "lsp_hover",
		label: "LSP Hover",
		description: "Request hover information from the matching LSP server.",
		promptSnippet: "Request hover information at a file position",
		promptGuidelines: [
			"Use lsp_hover when symbol type or documentation from the language server would help answer accurately.",
		],
		parameters: POSITION_PARAMS,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) return textToolResult("Cancelled");
			const target = await manager.ensureDocumentForTool(ctx, params.path);
			if (!target) return textToolResult(`No matching LSP server for ${params.path}`);
			const result = await target.client.hover(target.file, params.line, params.character);
			return textToolResult(formatUnknownResult(result));
		},
	});

	nycode.registerTool({
		name: "lsp_definition",
		label: "LSP Definition",
		description: "Request definition locations from the matching LSP server.",
		promptSnippet: "Find definition locations for a symbol at a file position",
		promptGuidelines: [
			"Use lsp_definition to navigate to definitions through the language server instead of text search when available.",
		],
		parameters: POSITION_PARAMS,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) return textToolResult("Cancelled");
			const target = await manager.ensureDocumentForTool(ctx, params.path);
			if (!target) return textToolResult(`No matching LSP server for ${params.path}`);
			const result = await target.client.definition(target.file, params.line, params.character);
			return textToolResult(formatUnknownResult(result));
		},
	});

	nycode.registerTool({
		name: "lsp_references",
		label: "LSP References",
		description: "Request references from the matching LSP server.",
		promptSnippet: "Find references for a symbol at a file position",
		promptGuidelines: ["Use lsp_references to locate symbol usages through the language server when available."],
		parameters: REFERENCES_PARAMS,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) return textToolResult("Cancelled");
			const target = await manager.ensureDocumentForTool(ctx, params.path);
			if (!target) return textToolResult(`No matching LSP server for ${params.path}`);
			const result = await target.client.references(
				target.file,
				params.line,
				params.character,
				params.includeDeclaration ?? false,
			);
			return textToolResult(formatUnknownResult(result));
		},
	});

	nycode.registerTool({
		name: "lsp_symbols",
		label: "LSP Symbols",
		description: "Request document symbols from the matching LSP server.",
		promptSnippet: "List document symbols for a file using LSP",
		promptGuidelines: ["Use lsp_symbols to inspect file structure using the language server when available."],
		parameters: Type.Object({ path: Type.String({ description: "File path" }) }),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) return textToolResult("Cancelled");
			const target = await manager.ensureDocumentForTool(ctx, params.path);
			if (!target) return textToolResult(`No matching LSP server for ${params.path}`);
			const result = await target.client.symbols(target.file);
			return textToolResult(formatUnknownResult(result));
		},
	});
}
