/**
 * Todo Extension - Claude Code style todo tracking with a live overlay
 *
 * This extension:
 * - Registers a `todo` tool for the LLM (add, start, complete, delete, clear, list)
 * - Registers a `/todos` command for users to view the list
 * - Shows a persistent widget above the editor with live todo status
 *
 * Todos move through a status machine: pending -> in_progress -> completed.
 * Exactly one todo is in_progress at a time; `start` moves any other
 * in_progress todo back to pending. An optional activeForm label (present
 * continuous, e.g. "Writing tests") is shown while a todo is in_progress.
 *
 * Mutations persist copied snapshots in branch-local custom session entries,
 * including calls nested inside other tools. Legacy tool result details still
 * replay on older branches. The same replay runs on session_start, session_tree,
 * and session_compact, so the list survives compaction without external files.
 */

import { Key, matchesKey, Text, type TUI, truncateToWidth } from "@nycode/tui";
import { type Static, Type } from "typebox";
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "../../core/extensions/types.ts";
import type { SessionEntry } from "../../core/session-manager.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";

import { stringEnum } from "../_shared/model/string-enum.ts";
import { registerStaleReminder } from "./stale-reminder.ts";

type TodoStatus = "pending" | "in_progress" | "completed";
type TodoAction = "add" | "start" | "complete" | "delete" | "clear" | "list";

export interface Todo {
	id: number;
	text: string;
	status: TodoStatus;
	activeForm?: string;
}

interface PersistedTodoState {
	todos?: LegacyTodo[];
	nextId: number;
}

interface TodoDetails {
	action: TodoAction;
	todos: Todo[];
	nextId: number;
	error?: string;
}

/** Pre-status-machine persisted shape (`done` boolean) still replays. */
export interface LegacyTodo {
	id: number;
	text: string;
	status?: TodoStatus;
	activeForm?: string;
	done?: boolean;
}

const TodoParams = Type.Object({
	action: stringEnum(["add", "start", "complete", "delete", "clear", "list"] as const),
	text: Type.Optional(Type.String({ description: "Todo text (for add)" })),
	activeForm: Type.Optional(
		Type.String({
			description: "Present-continuous label shown while in_progress, e.g. 'Writing tests' (for add/start)",
		}),
	),
	id: Type.Optional(Type.Number({ description: "Todo ID (for start, complete, delete)" })),
});

type TodoParamsType = Static<typeof TodoParams>;

const TOOL_NAME = "todo";
const STATE_ENTRY_TYPE = "pi-code:todo";
const WIDGET_KEY = "todos";
// Content budget: heading + todo rows + optional "+N more" summary. The
// rendered widget is one line taller (trailing spacer below the panel).
const MAX_WIDGET_LINES = 12;

export const normalizeTodo = (raw: LegacyTodo): Todo => {
	if (raw.status) return { id: raw.id, text: raw.text, status: raw.status, activeForm: raw.activeForm };
	return { id: raw.id, text: raw.text, status: raw.done ? "completed" : "pending" };
};

// Sem ícone de estado (dono, 2026-11-15): o nome do estado, na cor dele, numa coluna de largura fixa.
const STATUS_NAME: Record<TodoStatus, [string, "success" | "accent" | "dim"]> = {
	completed: ["concluída", "success"],
	in_progress: ["em andamento", "accent"],
	pending: ["pendente", "dim"],
};
const STATUS_W = 12;
const statusName = (status: TodoStatus, theme: Theme, pad = true): string => {
	const [name, role] = STATUS_NAME[status];
	return theme.fg(role, pad ? name.padEnd(STATUS_W) : name);
};

const listMark = (status: TodoStatus): string => {
	if (status === "completed") return "[x]";
	if (status === "in_progress") return "[>]";
	return "[ ]";
};

/** Plain-text list, shared by the list action and the non-terminal /todos path. */
const plainTodoList = (todos: Todo[]): string =>
	todos.length ? todos.map((t) => `${listMark(t.status)} #${t.id}: ${t.text}`).join("\n") : "No todos";

interface OverlayLayout {
	visible: Todo[];
	hiddenCompleted: number;
	truncatedTail: number;
}

/**
 * Fit todos into `budget` rows: drop completed first, then truncate the
 * non-completed tail. On overflow one row is reserved for the "+N more"
 * summary the caller appends.
 */
export const layoutOverlay = (todos: Todo[], budget: number): OverlayLayout => {
	if (todos.length <= budget) {
		return { visible: todos, hiddenCompleted: 0, truncatedTail: 0 };
	}
	const innerBudget = budget - 1;
	const nonCompleted = todos.filter((t) => t.status !== "completed");
	const totalCompleted = todos.length - nonCompleted.length;
	if (nonCompleted.length <= innerBudget) {
		const kept = new Set<Todo>(nonCompleted);
		for (const t of todos) {
			if (kept.size >= innerBudget) break;
			if (t.status === "completed") kept.add(t);
		}
		const visible = todos.filter((t) => kept.has(t));
		const shownCompleted = visible.filter((t) => t.status === "completed").length;
		return { visible, hiddenCompleted: totalCompleted - shownCompleted, truncatedTail: 0 };
	}
	return {
		visible: nonCompleted.slice(0, innerBudget),
		hiddenCompleted: totalCompleted,
		truncatedTail: nonCompleted.length - innerBudget,
	};
};

/** One-line widget used while collapsed (ctrl+shift+t): counts and the in_progress todo. */
export const collapsedLine = (todos: Todo[], theme: Theme): string => {
	const completed = todos.filter((t) => t.status === "completed").length;
	const active = todos.find((t) => t.status === "in_progress");
	const current = active ? `${theme.fg("dim", " · ")}${active.activeForm ?? active.text}` : "";
	if (completed === todos.length)
		return `${theme.fg("dim", `Todos ${completed}/${todos.length}`)}${theme.fg("dim", " · ")}${theme.fg("success", "concluídos")}`;
	return theme.fg("accent", `Todos ${completed}/${todos.length}`) + current;
};

export const allDone = (todos: Todo[]): boolean => todos.length > 0 && todos.every((t) => t.status === "completed");

/** Linhas visíveis a partir de `offset`, com indicadores de quanto ficou acima e abaixo. */
export const scrollWindow = <T>(
	items: T[],
	budget: number,
	offset: number,
): { visible: T[]; above: number; below: number; offset: number } => {
	if (items.length <= budget) return { visible: items, above: 0, below: 0, offset: 0 };
	const inner = budget - 1; // uma linha para o rodapé "+N"
	const max = items.length - inner;
	const start = Math.min(Math.max(0, offset), max);
	return { visible: items.slice(start, start + inner), above: start, below: max - start, offset: start };
};

/**
 * Persistent widget above the editor. Factory-form setWidget registration,
 * register-once + requestRender() refresh, auto-hide when the list is empty.
 * Reads live state via getTodos() at render time.
 */
class TodoOverlay {
	private uiCtx?: ExtensionUIContext;
	private widgetRegistered = false;
	private tui?: TUI;
	// Per process, not persisted: ctrl+shift+t folds the list into collapsedLine.
	private collapsed = false;
	// Lista concluída recolhe sozinha; expandir manualmente (clique ou ctrl+shift+t) vence até a próxima lista.
	private expandedByUser = false;
	private scroll = 0;
	private readonly getTodos: () => Todo[];

	constructor(getTodos: () => Todo[]) {
		this.getTodos = getTodos;
	}

	setUICtx(ctx: ExtensionUIContext): void {
		// Identity-compare so repeat session_start handlers are idempotent;
		// on identity change (/reload) invalidate so update() re-registers.
		if (ctx !== this.uiCtx) {
			this.uiCtx = ctx;
			this.widgetRegistered = false;
			this.tui = undefined;
		}
	}

	private lastCount = 0;

	update(): void {
		if (!this.uiCtx) return;
		const count = this.getTodos().length;
		if (count > this.lastCount) this.resetView(); // lista nova ou item adicionado: volta ao automático
		this.lastCount = count;
		if (count === 0) {
			this.resetView();
			this.hide();
			return;
		}
		if (this.widgetRegistered) {
			this.tui?.requestRender();
			return;
		}
		this.uiCtx.setWidget(
			WIDGET_KEY,
			(tui, theme) => {
				this.tui = tui;
				return {
					render: (width: number) => this.renderWidget(theme, width),
					// Mouse chega aqui em tuiMode fullscreen (padrão): clique alterna, roda rola a lista.
					handleMouse: (event: { type?: string; wheelDelta?: number }) => {
						if (event.type === "click") {
							this.toggleCollapsed();
							return { render: true };
						}
						if (event.type === "wheel" && event.wheelDelta) {
							const moved = this.scrollBy(event.wheelDelta > 0 ? 1 : -1);
							return moved ? { render: true } : undefined;
						}
						return undefined;
					},
					invalidate: () => {
						this.widgetRegistered = false;
						this.tui = undefined;
					},
				};
			},
			{ placement: "aboveEditor" },
		);
		this.widgetRegistered = true;
	}

	toggleCollapsed(): void {
		const todos = this.getTodos();
		if (todos.length === 0) return;
		const showingCollapsed = this.collapsed || (allDone(todos) && !this.expandedByUser);
		this.collapsed = !showingCollapsed;
		this.expandedByUser = !this.collapsed;
		this.scroll = 0;
		this.update();
	}

	/** Rola a lista expandida; devolve true quando o offset mudou. */
	scrollBy(delta: number): boolean {
		const todos = this.getTodos();
		if (this.collapsed || todos.length <= MAX_WIDGET_LINES - 1) return false;
		const before = this.scroll;
		this.scroll = Math.min(Math.max(0, this.scroll + delta), todos.length - (MAX_WIDGET_LINES - 2));
		if (this.scroll === before) return false;
		this.update();
		return true;
	}

	/** Nova lista (ou lista esvaziada) volta ao comportamento automático. */
	resetView(): void {
		this.collapsed = false;
		this.expandedByUser = false;
		this.scroll = 0;
	}

	dispose(): void {
		this.hide();
		this.uiCtx = undefined;
	}

	private hide(): void {
		if (!this.widgetRegistered) return;
		this.uiCtx?.setWidget(WIDGET_KEY, undefined);
		this.widgetRegistered = false;
		this.tui = undefined;
	}

	/** Never drawn in the chat: the todos live only in the Plan section (event 'pi-code:todos', plan-mode/index.ts). */
	private renderWidget(_theme: Theme, _width: number): string[] {
		return [];
	}
}

/**
 * UI component for the /todos command
 */
class TodoListComponent {
	private readonly todos: Todo[];
	private readonly theme: Theme;
	private readonly onClose: () => void;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(todos: Todo[], theme: Theme, onClose: () => void) {
		this.todos = todos;
		this.theme = theme;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onClose();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const th = this.theme;

		lines.push("");
		const title = th.fg("accent", " Todos ");
		const headerLine =
			th.fg("borderMuted", "─".repeat(3)) + title + th.fg("borderMuted", "─".repeat(Math.max(0, width - 10)));
		lines.push(truncateToWidth(headerLine, width), "");

		if (this.todos.length === 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim", "No todos yet. Ask the agent to add some!")}`, width));
		} else {
			const completed = this.todos.filter((t) => t.status === "completed").length;
			const completedLabel = `${completed}/${this.todos.length} completed`;
			lines.push(truncateToWidth(`  ${th.fg("muted", completedLabel)}`, width), "");

			for (const todo of this.todos) {
				const glyph = statusName(todo.status, th);
				const id = th.fg("accent", `#${todo.id}`);
				const text = todo.status === "completed" ? th.fg("dim", todo.text) : th.fg("text", todo.text);
				let line = `  ${glyph} ${id} ${text}`;
				if (todo.status === "in_progress" && todo.activeForm) {
					const activeFormLabel = `(${todo.activeForm})`;
					line += ` ${th.fg("dim", activeFormLabel)}`;
				}
				lines.push(truncateToWidth(line, width));
			}
		}

		lines.push("", truncateToWidth(`  ${th.fg("dim", "Press Escape to close")}`, width), "");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

// nycode core's ExtensionRunner throws this exact phrase from an invalidated ctx
// proxy after session replacement/reload. Match the stable substring so
// genuine replay bugs still propagate instead of being silently swallowed.
const isStaleCtxError = (e: unknown): boolean => /stale after session replacement/.test(String(e));

const LIST_RESULT_PREVIEW = 5;

const renderTodoListResult = (todoList: Todo[], expanded: boolean, theme: Theme): Text => {
	if (todoList.length === 0) {
		return new Text(theme.fg("dim", "No todos"), 0, 0);
	}
	let listText = theme.fg("muted", `${todoList.length} todo(s):`);
	const display = expanded ? todoList : todoList.slice(0, LIST_RESULT_PREVIEW);
	for (const t of display) {
		const idLabel = `#${t.id}`;
		const itemText = t.status === "completed" ? theme.fg("dim", t.text) : theme.fg("muted", t.text);
		listText += `\n${statusName(t.status, theme)} ${theme.fg("accent", idLabel)} ${itemText}`;
	}
	if (!expanded && todoList.length > LIST_RESULT_PREVIEW) {
		const moreLabel = `... ${todoList.length - LIST_RESULT_PREVIEW} more`;
		listText += `\n${theme.fg("dim", moreLabel)}`;
	}
	return new Text(listText, 0, 0);
};

/** Read provider snapshots, allowing legacy direct results until the first snapshot. */
const persistedTodoDetails = (entry: SessionEntry, includeLegacy: boolean): PersistedTodoState | undefined => {
	if (entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE)
		return entry.data as PersistedTodoState | undefined;
	if (!includeLegacy || entry.type !== "message") return undefined;
	const message = entry.message;
	if (message.role !== "toolResult" || message.toolName !== TOOL_NAME) return undefined;
	return message.details as PersistedTodoState | undefined;
};

/** Register the branch-local Todo provider, viewer, and live widget. */
export default function todoExtension(nycode: ExtensionAPI) {
	const setStaleItems = registerStaleReminder(nycode);
	// In-memory state (reconstructed from session on load)
	let todos: Todo[] = [];
	let nextId = 1;
	const overlay = new TodoOverlay(() => todos);
	/** Todos go to the Plan section (plan-mode/index.ts listens); the chat widget stays empty. */
	const refresh = () => {
		overlay.update();
		const shown = todos.map((t) => ({
			id: t.id,
			text: t.status === "in_progress" ? (t.activeForm ?? t.text) : t.text,
			status: t.status,
		}));
		setStaleItems(shown);
		nycode.events.emit("pi-code:todos", shown);
	};

	/**
	 * Reconstruct state from session entries.
	 * Provider snapshots supersede legacy results, whose completion order can
	 * differ from mutation order. Commit only after a full scan so a stale ctx
	 * leaves the current state intact.
	 */
	const reconstructState = (ctx: ExtensionContext) => {
		let replayTodos: Todo[] = [];
		let replayNextId = 1;
		let hasProviderSnapshot = false;

		for (const entry of ctx.sessionManager.getBranch()) {
			const details = persistedTodoDetails(entry, !hasProviderSnapshot);
			// nycode persists a failed tool call as `details: {}`, which is truthy: a rejected
			// or blocked call would otherwise throw here and break replay for the rest of
			// the session, losing the list on every resume, fork and compaction.
			if (Array.isArray(details?.todos)) {
				replayTodos = details.todos.map(normalizeTodo);
				replayNextId = details.nextId;
				if (entry.type === "custom") hasProviderSnapshot = true;
			}
		}

		todos = replayTodos;
		nextId = replayNextId;
	};

	/**
	 * Replay for session_tree/session_compact. Auto-compaction races session
	 * disposal: nycode core can emit these with an already-invalidated ctx proxy
	 * whose getters throw the stale error. The replacement session's
	 * session_start replays state, so keep current state on a stale ctx.
	 */
	const replayAndRefresh = (ctx: ExtensionContext) => {
		try {
			reconstructState(ctx);
		} catch (e) {
			if (!isStaleCtxError(e)) throw e;
		}
		refresh();
	};

	nycode.on("session_start", (_event, ctx) => {
		reconstructState(ctx);
		if (ctx.hasUI) overlay.setUICtx(ctx.ui);
		refresh();
	});
	nycode.registerShortcut(Key.ctrlShift("t"), {
		description: "Collapse or expand the todo list",
		handler: () => overlay.toggleCollapsed(),
	});
	nycode.on("session_tree", (_event, ctx) => replayAndRefresh(ctx));
	nycode.on("session_compact", (_event, ctx) => replayAndRefresh(ctx));
	nycode.on("session_shutdown", () => overlay.dispose());

	// Reads live state at render time; never replay the branch here (the
	// branch is stale until message_end runs after tool_execution_end).
	nycode.on("tool_execution_end", (event) => {
		if (event.toolName !== TOOL_NAME || event.isError) return;
		refresh();
	});

	const toolMessage = (text: string, details: TodoDetails) => ({
		content: [{ type: "text" as const, text }],
		details,
	});
	// nycode keeps a result's details by reference in the live session, and start/complete
	// mutate the todo objects in place, so each result carries its own copies: without
	// them a rewind replays, and the TUI re-renders, today's statuses on earlier calls.
	const snapshot = () => todos.map((t) => ({ ...t }));
	/** Persist successful mutations before direct or nested execution returns. */
	const ok = (action: TodoAction, text: string) => {
		if (action !== "list") nycode.appendEntry(STATE_ENTRY_TYPE, { todos: snapshot(), nextId });
		return toolMessage(text, { action, todos: snapshot(), nextId });
	};
	const fail = (action: TodoAction, error: string) =>
		toolMessage(`Error: ${error}`, { action, todos: snapshot(), nextId, error });

	const handleAdd = (params: TodoParamsType) => {
		if (!params.text) return fail("add", "text required for add");
		const newTodo: Todo = { id: nextId++, text: params.text, status: "pending", activeForm: params.activeForm };
		todos.push(newTodo);
		return ok("add", `Added todo #${newTodo.id}: ${newTodo.text}`);
	};

	const handleStart = (params: TodoParamsType) => {
		if (params.id === undefined) return fail("start", "id required for start");
		const todo = todos.find((t) => t.id === params.id);
		if (!todo) return fail("start", `#${params.id} not found`);
		const demoted = todos.filter((t) => t.status === "in_progress" && t.id !== todo.id);
		for (const other of demoted) other.status = "pending";
		todo.status = "in_progress";
		if (params.activeForm) todo.activeForm = params.activeForm;
		let text = `Started #${todo.id}: ${todo.text}`;
		if (demoted.length > 0) {
			const movedIds = demoted.map((t) => `#${t.id}`).join(", ");
			text += ` (moved ${movedIds} back to pending)`;
		}
		return ok("start", text);
	};

	const handleComplete = (params: TodoParamsType) => {
		if (params.id === undefined) return fail("complete", "id required for complete");
		const todo = todos.find((t) => t.id === params.id);
		if (!todo) return fail("complete", `#${params.id} not found`);
		todo.status = "completed";
		return ok("complete", `Completed #${todo.id}: ${todo.text}`);
	};

	const handleDelete = (params: TodoParamsType) => {
		if (params.id === undefined) return fail("delete", "id required for delete");
		const index = todos.findIndex((t) => t.id === params.id);
		if (index === -1) return fail("delete", `#${params.id} not found`);
		const [removed] = todos.splice(index, 1);
		return ok("delete", `Deleted #${removed.id}: ${removed.text}`);
	};

	const handleClear = () => {
		const count = todos.length;
		todos = [];
		nextId = 1;
		return ok("clear", `Cleared ${count} todos`);
	};

	const handleList = () => ok("list", plainTodoList(todos));

	// Register the todo tool for the LLM
	nycode.registerTool({
		name: TOOL_NAME,
		label: "Todo",
		description:
			"Manage a todo list for tracking multi-step progress. Actions: add (text, optional activeForm), start (id, mark in_progress), complete (id), delete (id), clear, list. Status machine: pending -> in_progress -> completed. Exactly one todo is in_progress at a time; start moves any other in_progress todo back to pending.",
		promptSnippet: "Manage a todo list to plan and track multi-step work",
		promptGuidelines: [
			"Use the todo tool to create todos for any multi-step work (3+ steps) or when the user gives you a list of tasks. Skip it for single trivial tasks and purely conversational requests.",
			"Keep exactly one todo in_progress at a time: mark a todo in_progress (todo action start) BEFORE beginning work on it, passing activeForm as a present-continuous label (e.g. 'Writing tests').",
			"Mark a todo completed (todo action complete) IMMEDIATELY after finishing it; never batch completions or leave finished work in_progress.",
		],
		parameters: TodoParams,

		async execute(
			_toolCallId,
			params,
			_signal,
			_onUpdate,
			_ctx,
		) /* NOSONAR typescript:S7503 - nycode types a tool execute as returning a Promise */ {
			switch (params.action) {
				case "add":
					return handleAdd(params);
				case "start":
					return handleStart(params);
				case "complete":
					return handleComplete(params);
				case "delete":
					return handleDelete(params);
				case "clear":
					return handleClear();
				case "list":
					return handleList();
				default:
					return fail("list", `unknown action: ${params.action}`);
			}
		},

		renderCall(args, theme, _context) {
			let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", args.action);
			if (args.id !== undefined) {
				const idLabel = `#${args.id}`;
				text += ` ${theme.fg("accent", idLabel)}`;
			}
			if (args.text) {
				const textLabel = `"${args.text}"`;
				text += ` ${theme.fg("dim", textLabel)}`;
			}
			if (args.activeForm) {
				const activeFormLabel = `(${args.activeForm})`;
				text += ` ${theme.fg("dim", activeFormLabel)}`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as TodoDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (details.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			if (details.action === "list") {
				return renderTodoListResult(details.todos, expanded, theme);
			}

			const text = result.content[0];
			const msg = text?.type === "text" ? text.text : "";
			const nome =
				details.action === "start" ? "in_progress" : details.action === "complete" ? "completed" : undefined;
			const tag = nome ? `${statusName(nome, theme, false)}${theme.fg("dim", " · ")}` : "";
			return new Text(tag + theme.fg("muted", msg), 0, 0);
		},
	});

	// Register the /todos command for users
	nycode.registerCommand("todos", {
		description: "Show all todos on the current branch",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/todos requires interactive mode", "error");
				return;
			}

			// ui.custom() is terminal-only: with a UI but no terminal (RPC mode) it
			// resolves undefined without showing anything, so notify the plain list.
			if (ctx.mode !== "tui") {
				ctx.ui.notify(plainTodoList(todos), "info");
				return;
			}

			await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
				return new TodoListComponent(todos, theme, () => done());
			});
		},
	});
}
