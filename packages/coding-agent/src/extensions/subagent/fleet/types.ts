/**
 * Agent fleet contract (local patch, claude-home/patches/pi-code/subagent-panel.patch).
 *
 * Every pi process that spawns a subagent (the main session at depth 0 and any writer
 * child below it) records that run in one shared directory per main session, the fleet
 * dir. The spawner is the only writer of a run's files; the main session's panel reads
 * the whole tree from disk, so runs at depth 2 and 3, which live in other processes, show
 * up the same way as its own children. Record: docs/pi-agent-fleet-2026-11-12.md.
 *
 * Files in the fleet dir (mode 0700, under os.tmpdir()/pi-code-fleet-<uid>/):
 *   <id>.json               RunRecord, rewritten atomically (tmp file + rename)
 *   <id>.transcript.jsonl   TranscriptItem per line, appended by the spawner, size-capped
 *   <id>.inbox.jsonl        InboxMessage per line, appended by the main session's panel
 *   <id>.inbox-ack.jsonl    InboxAck per line, appended by the child that consumed the inbox
 *   <id>.stop               marker written before the panel stops a run: the spawner then
 *                           reports the run as stopped by the user, not as a crash
 */

/** Environment a spawned child inherits (set by the spawner, read by the child). */
export const FLEET_ENV = {
  /** The main session's fleet dir; created once at depth 0, inherited unchanged below. */
  dir: 'PI_CODE_FLEET_DIR',
  /** The run id of this process itself, so its own children record it as their parent
   * and its inbox watcher knows which inbox is its own. Unset in the main session. */
  runId: 'PI_CODE_FLEET_RUN_ID',
} as const

export type RunState = 'running' | 'done' | 'failed' | 'cancelled'

export interface RunTokens {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** Context window in use after the latest assistant message (its totalTokens). */
  context: number
}

export interface RunRecord {
  v: 1
  /** pi-code's run id: `fg-xxxxxxxx` (foreground) or `bg-xxxxxxxx` (background). */
  id: string
  /** Run id of the run whose process spawned this one; null when the main session did. */
  parentId: string | null
  /** 1 = child of the main session, 2 = grandchild, 3 = great-grandchild. */
  depth: number
  agent: string
  /** First 300 characters of the task, whitespace collapsed to single spaces. */
  task: string
  /** Model of the run: the argv-resolved one until the child reports, then the physical id it used. */
  model?: string
  /** Physical provider, once the child's assistant messages report it. */
  provider?: string
  /** Thinking level: configured (argv) until observed; absent = unknown (never guessed). */
  effort?: string
  /** The child confirmed the model / the effort (assistant message or thinking_level_changed). */
  modelSeen?: true
  effortSeen?: true
  /** Started with background: true, or moved to the background by the user (Ctrl+B). */
  background: boolean
  state: RunState
  startedAt: number
  updatedAt: number
  endedAt?: number
  /** Plain text, no ANSI, at most 120 characters: the tool call in flight, else the
   * latest assistant text line. */
  activity?: string
  turns: number
  toolCalls: number
  tokens: RunTokens
  /** USD spent by this run itself, descendants excluded. */
  cost: number
  /** The `subagent` tool call that started this run (the same id as the diagnostics' `gen_ai.tool.call.id`). */
  toolCallId?: string
  /** First open plan step when the run started (channel `pi-code:plan-state`). Heuristic: with steps worked in parallel it can name the neighbour. Absent without a running plan. */
  planStep?: number
  /** The child's pid; it leads its own process group (spawned detached). */
  pid?: number
  /** The process that spawned the run and is the only writer of its files. */
  ownerPid: number
  exitCode?: number
  /** Cut at its maxTurns limit (SIGTERM by the parent): finished as `done`, but the output is incomplete. */
  partial?: true
  /** At most 300 characters. */
  error?: string
  /** Who stopped the run: the user (panel `x x`) or the parent agent (`subagent {cancel}`, registry or fleet path). */
  stoppedBy?: StopOrigin
}

export type TranscriptKind = 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'note'

export interface TranscriptItem {
  /** Epoch ms. */
  t: number
  kind: TranscriptKind
  /** Plain text, no ANSI. assistant: up to 20,000 chars; tool_call: a one-line
   * `tool args` preview up to 300; tool_result: up to 2,000; user and note: up to 4,000. */
  text: string
  tool?: string
  isError?: boolean
}

export interface InboxMessage {
  id: string
  t: number
  text: string
}

export interface InboxAck {
  id: string
  t: number
  /** steered: queued into the running agent; consumed: a turn began after the steer (the message reached the model);
   * too-late: the agent had already finished, or never started a turn for it. */
  outcome: 'steered' | 'consumed' | 'too-late'
}

export type StopOutcome = 'stopping' | 'not-running' | 'unknown' | 'refused'
/** queued: written to a running run's inbox; resumed: a finished background run of the
 * main session continued with the message as its new task (pi-code's resume). */
export type SendOutcome = 'queued' | 'resumed' | 'not-running' | 'unknown'
/** The model's `send` (sendFromLead): the panel outcomes plus not-delivered (the run ended before it read the
 * message and nothing could resume it) and the refusals, none of which write to the inbox. */
export type LeadSendOutcome = SendOutcome | 'not-delivered' | 'disabled' | 'empty' | 'too-long' | 'not-owned' | 'run-limit' | 'process-limit'

/** What the panel and the viewer need from the data plane; injected so the UI can be
 * tested against an in-memory fake. */
export interface FleetSource {
  /** Every run of this main session's tree, any state. A `running` record whose owner
   * process is gone is returned as `failed` with error `orphaned`. */
  list(): RunRecord[]
  /** Transcript items appended since byte offset `from`; `next` is the offset to pass next time. */
  readTranscript(id: string, from: number): { items: TranscriptItem[]; next: number }
  /** Stop a running run of any depth (marker, then SIGTERM to its process group, SIGKILL
   * after 5 s). `refused` when the pid no longer belongs to that run. */
  stop(id: string): StopOutcome
  /** Send the user's message to a run (see SendOutcome). */
  send(id: string, text: string): SendOutcome
  /** True while the main session has a foreground subagent tool call in flight. */
  hasForeground(): boolean
  /** Ctrl+B: move every foreground subagent call in flight to the background; returns how
   * many calls moved (0 when none). */
  detachForeground(): number
  /** Called (debounced) whenever the fleet dir changes; returns the unsubscribe. */
  onChange(listener: () => void): () => void
}

export type StopOrigin = 'user' | 'agent'
