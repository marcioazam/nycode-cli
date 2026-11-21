/**
 * Agent team contract (local patch, claude-home/patches/pi-code/team.patch). Opt-in
 * (PI_CODE_TEAMS=1 or /team on): every run of the fleet tree can message any other run,
 * share a board and claim tasks, all through files under the fleet dir (fleet/types.ts):
 *   <id>.inbox.jsonl         team messages, delivered by the fleet inbox watcher (steer)
 *   main.inbox.jsonl         messages to the lead (main session), delivered as one followUp
 *   team/messages.jsonl      log of every message (UI: ✉n badge, viewer conversation)
 *   team/board.jsonl         append-only board entries
 *   team/task-N.json         a task (created with O_EXCL so ids are unique)
 *   team/claim-N.json        exclusive claim of task N (O_EXCL: one winner)
 *   team/done-N.json         completion of task N
 *   team/sends.<id|tree>     one byte per send: the file size is the budget counter
 * Record: docs/pi-agents-ui-teams-sota-2026-11-13.md (Time).
 */
export const KINDS = ['question', 'answer', 'info', 'blocker', 'handoff'] as const
export type MessageKind = (typeof KINDS)[number]

export const BOARD_KINDS = ['fact', 'fail', 'done'] as const
export type BoardKind = (typeof BOARD_KINDS)[number]

export const LIMITS = { text: 2000, board: 1000, perRun: 30, perTree: 300, feedMs: 20_000, digest: 600 } as const

/** The main session's id in team addressing (it has no run id). */
export const LEAD_ID = 'main'

export const teamEnabled = (): boolean => process.env.PI_CODE_TEAMS === '1'

/** Team mode: a tools allowlist must not hide the team tool (it grants messaging, not write access). No allowlist = all tools. */
export const withTeamTool = <T extends { tools?: string[] }>(agent: T): T =>
  teamEnabled() && agent.tools && agent.tools.length > 0 ? { ...agent, tools: [...agent.tools, 'team'] } : agent

export interface Self {
  /** Run id, or LEAD_ID for the main session. */
  id: string
  /** Agent name, `lead` for the main session. */
  agent: string
  depth: number
}

export interface TeamMessage {
  id: string
  t: number
  from: string
  fromAgent: string
  to: string
  toAgent: string
  kind: MessageKind
  text: string
}

export interface BoardEntry {
  t: number
  by: string
  agent: string
  kind: BoardKind
  text: string
}

export interface TeamTask {
  id: string
  title: string
  files: string[]
  by: string
  t: number
  claimedBy?: string
  claimedAgent?: string
  done?: { by: string; note: string }
}

export interface RosterEntry {
  id: string
  agent: string
  depth: number
  parent: string
  state: string
  task: string
  claimed?: string
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string }
