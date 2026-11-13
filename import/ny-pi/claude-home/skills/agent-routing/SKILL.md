---
name: agent-routing
description: Choose complementary agents, skills and MCP tools when a task crosses domains, needs delegation, or has competing tool routes. Use for harness orchestration; keep simple local work direct.
---

# Agent routing

Choose the smallest execution shape that can finish the task reliably. This skill advises routing; it does not grant permission to delegate or mutate external state. Availability across the fleet means every capability has a route, not that every task invokes every agent or MCP.

## Resolve capabilities before execution

- Treat the current runtime tool/agent catalog as callable authority (in pi: the tools in the system prompt, MCP tools after `tool_search`, and the agents the `subagent` tool lists). Configured
  names and local files establish installation only; a missing capability may
  require a new session. Never invent tool names or assume a profile has loaded.
- Pick one primary skill for the actual outcome (in pi, `read` its
  `~/.pi/agent/claude-home/skills/<name>/SKILL.md`), then load only conditional
  references needed by that task. Skills guide direct work as well as agents.
- Choose the relevant [MCP and CLI route](references/tool-routing.md) when tools
  overlap. Pass that choice, target identity and evidence requirements to workers.
- Reuse the current task/root discovery and consulted sources while their scope,
  versions, index and relevant content remain valid. Refresh affected evidence on
  change or conflict; a cached unindexed/missing result only guides fallback,
  never proves structural completeness.
- Reuse the current thread for small edits. `swarm-worker` can handle
  bounded general implementation and built-in `Explore` a scoped code question when
  exposed by the runtime. Do not spawn a specialist just to use its skill.
- If the specialized role below is installed but absent from this session,
  continue directly with the corresponding skill, or use an available general
  worker with the same bounded assignment. Disclose the fallback.

## Decide whether to delegate

- Keep localized, sequential work in the main thread.
- Use `code-mapper` for substantial or uncertain ownership/caller reconnaissance when delegation is authorized; resolve a known local path directly.
- Delegate only substantial, independently verifiable work. Parallel writes require disjoint declared `owned_files`; otherwise serialize.
- Use at most three concurrent workers across the task tree, bounded further by the runtime limit (pi: one parallel `subagent` call runs at most 4 of its up to 8 tasks at once; at most 8 background runs) and currently occupied slots. In pi only writer agents nest, to depth 3 (`swarm-orchestration`, Nesting). Never assume three free slots. Stop fan-out when the next opinion is unlikely to change a decision.
- Give each agent one responsibility, exact scope, constraints, evidence required, and done criteria. Agents are not alone in the workspace and must preserve others' changes.
- Pass the shared research record and assigned gaps to workers. The working contract (`$CLAUDE_CONFIG_DIR/CLAUDE.md`, loaded in every pi session) owns research, TDD and structural requirements; this router does not create another quota or procedure.
- Add independent review for a concrete substantial risk or unresolved finding, not every function, branch or small change. Reuse supplied immutable evidence instead of repeating equivalent discovery or reviews; verify material conclusions against their source.

## Native fleet

Skills in each row are alternatives selected by the concrete question, not a load-all list.

| Need | Agent | Relevant skills |
| --- | --- | --- |
| Code ownership, callers and graph coverage | `code-mapper` | `codegraph` (preloaded into the agent prompt; pass the index root as `projectPath`) |
| General diff correctness and integration | `code-reviewer` | `pr-review` |
| Agent prompts, evals, tools and cost controls | `agent-systems-auditor` | `agent-systems` |
| Consequential architecture boundaries | main thread (evidence from `code-mapper`) | `architecture-decision` |
| Exploitable application, CI/IaC or tool-input risk | `security-reviewer` | `security-audit`, `supply-chain-risk-auditor` |
| API/schema compatibility and rollout | `contract-migration-reviewer` | `api-contract-design`, `db-migration-safety` |
| Backend CPU, query, memory or concurrency cost | main thread | `performance-audit` (slow queries and plans included) |
| Browser loading, rendering, CWV and heap | parent or `swarm-worker` | `web-performance-audit` |
| Resilience, races, retries and recovery | `reliability-reviewer` | `reliability-operations`, `diagnose` |
| Test strength, gaps and flakiness | `test-reviewer` | `quality-gates`, `property-based-testing` |
| Current external facts and citations | `perplexity-scout` (Perplexity-first search), `web-scout` (search without Perplexity: cross-checks, challenges), `research-scout` (versions, datasets), `scholar-scout` (papers, via `academic-search`) | `perplexity-urls`, `deep-search` and its variants, `evidence-research` |
| State-of-the-art gap audit: stable versions, practices, failure paths | `soteiros-auditor` | `soteiros`, `evidence-research` |
| CI/build failures and merge state | `ci-triage` | `diagnose`, `git-workflow` |
| UX, accessibility and visual fidelity | `ux-reviewer` | `design-review`, `accessibility-audit`, `web-ui-craft`, `review-animations`, `ux-copy`, `design-handoff` |
| Behavioral test implementation | `test-author` | `tdd`, `property-based-testing`, `browser-testing-with-devtools` |
| Legacy removal or approved SOTA transformation of assigned files (multi-module or parallel) | `zero-legado-builder` | `zero-legado`, `soteiros`, `tdd` |
| Technical documentation and ADRs | `docs-architect` | `architecture-decision`, `diagram-design`, `design-handoff`, `sdd-workflow`, `engineering-standards` |
| knowledge vault health pass (vault lint), consolidation or substantial sourced learning proposals | `knowledge-curator` | `obsidian-cli`, `obsidian-markdown`; read-only, parent writes |
| Go/Rust gateway, streaming and accounting | `gateway-engineer` | `engineering-standards`, `api-contract-design`, `observability-and-instrumentation` |
| Go services other than the gateway relay (control plane, portal, workers) | `go-service-engineer` | `engineering-standards` (go reference), `api-contract-design`, `db-migration-safety` |
| Dependency and security alert remediation (Dependabot, code scanning, GHSA/OSV) | `dependency-remediator` | `supply-chain-risk-auditor`, `security-audit`, `tdd` |
| Shared wire contract change (protobuf, OpenAPI, JSON Schema, vectors, generated clients) consumed by other repositories or services | `contract-engineer` | `wire-contract-change` (preloaded) |
| Integrating finished parallel lanes, branches or worktrees into one integration branch | `lane-integrator` | `lane-integration` (preloaded) |
| Static sweep for stale references after an edit, before the one gate run | main thread with `rg`, or `Explore`; `gate-runner` (`haiku`) then runs the gate once | `ripple-hunt` |
| Decomposing a multi-module task into units with dependencies before parallel lanes | main thread | `graph-engineering`, `swarm-orchestration` |
| Designing or running an iterative agent loop (fix until green, review and fix, plan completion, polling) | main thread (pi has no `swarm-lanes` workflow; `/goal` for a judged stop condition) | `loop-engineering` |
| Final review of a whole approved plan's execution | `plan-reviewer` (session model; no per-call tier in pi) | `pr-review`, `ripple-hunt`, `doces-ou-travessuras` |
| Web frontend (React/Next.js, HTML/CSS/JS, Astro/TS, PHP templates) or Worker application | `web-platform-engineer` | `web-ui-craft`, `impeccable`, `engineering-standards`, `browser-testing-with-devtools` |
| Phone/tablet layout fit and viewport-matrix fixes | `web-platform-engineer` | `responsive-fit` |
| Bounded Linear triage and authorized issue changes | `linear-operator` | `linear`, `to-issues` |
| Explicit paid OCR API review with verified findings | `ocr-reviewer` | `ocr-review`; `ocr-delegate-review` keeps review in the current session |
| Crawl/indexation, localization and schema | parent or `swarm-worker` | `seo-audit` |
| FastAPI and async persistence | `swarm-worker` or direct | `engineering-standards` (python reference), `api-contract-design`, `webhook-integration` |
| Flutter widgets/state/platform integration | `swarm-worker` or direct | `engineering-standards` (flutter reference), `design-handoff` (the Claude Code dart-and-flutter plugin and its MCP do not exist in pi) |
| Terraform/Kubernetes resources and state | `terraform-specialist` | `engineering-standards`, `architecture-decision` |
| Data pipelines, ML training, evaluation and serving | `swarm-worker` or direct | `engineering-standards` (data-and-ml-platforms reference), `validate-data`, `db-migration-safety` |

In pi the agent name is the frontmatter `name` in `~/.pi/agent/claude-home/agents/<name>.md` (same kebab-case names as
Claude's agents, for example `ci-triage`, `test-reviewer`) plus the built-ins `Explore`, `Plan` and
`general-purpose`; Codex TOML names keep underscores. Check that exact name in the `subagent` tool's agent list
immediately before delegating. The shared agent contract (`$CLAUDE_CONFIG_DIR/docs/agent-contract.md`, which every
ported agent reads first) owns execution limits and handoff evidence;
pi's agent inventory is `$CLAUDE_CONFIG_DIR/agents/` (tier = each file's `model:` pin,
`swarm-orchestration`); Claude retirements and their routes are in the shared contract and
~/.claude/docs/agents-sota-2026-10-25.md. Do not fan out a general review and every specialist
over the same question. Assign specialist depth only for a concrete unresolved risk.

For an authorized bounded adversarial assessment, use `security-reviewer` with `security-audit`. Prefer a project agent when the repository defines a more specific one.

Planning and delivery stay with the parent unless explicitly assigned:
`sdd-workflow` for specifications, `durable-delivery` for authorized sustained
implementation, and `to-issues` for an issue breakdown. Classify intake directly
from the available problem and evidence before choosing a workflow.
Use `code-simplification`, `legacy-modernizer`, `project-baseline`, or the relevant
platform skill only when that is the requested work; `mcp-builder`, `wizard` and
`insecure-defaults` are user-only (`/skill:<name>`, `/insecure-defaults-audit`). Specialized
and explicit-only skills retain their own triggers; this router does not activate
the entire catalog. `context-economy` applies to noisy output, not to hiding checks.

## Saved workflows (Claude Code only)

Claude Code's saved workflows (`/review-fanout`, `/impact`, `/implement`, `/research-xcheck`, `/sota-audit`) live in
`~/.claude/workflows/` and are not ported: pi has no Workflow tool. `/swarm` is ported as a command
(`~/.pi/agent/claude-home/commands/swarm.md`, skill `swarm-orchestration`); the other ported commands are listed in
`~/.pi/agent/claude-home/docs/pi-commands.md`. When the user asks for an unported workflow, run its steps by hand with `subagent`
calls (single, `{tasks: [...]}` in parallel, or `{chain: [...]}` with `{previous}`) and say so. Their results stay
input for the parent to verify, never permission to commit, merge or publish.

## Model inheritance

Tier per spawn follows skill `swarm-orchestration` (Tiers, Thinking level). In pi the `subagent` tool takes no
`model` or `effort`: a child runs on its agent file's `model:` pin (`swarm-worker` = `sonnet`, `gate-runner` and
`git-delivery` = `haiku`), else on `CLAUDE_CODE_SUBAGENT_MODEL` when set, else on the session model; choose the tier
by choosing the agent. A configured alias does not establish upstream identity or availability (an unresolved alias
silently falls back to the session model); the subagent result shows the model that actually ran. Economy comes
from bounded work, context and concurrency. Keep model identity, reasoning effort, service tier and tool access
distinct.

## Handoff contract

Include:

```text
Goal:
Owned files or read-only scope:
Constraints and preserved behavior:
Allowed tools, network and external effects:
Primary skill and tool route; exact repo/browser window/page or source:
Shared budget when available; stopping condition:
Redelegation authority (none unless explicitly granted):
Evidence to return:
Done criteria:
```

For writers, add: "You are not alone in the codebase; do not revert others' changes and adapt to concurrent edits."

For discovery, pass relevant paths/symbols, content revision, coverage gaps, and one unresolved question. Never run a read-only agent in a separate worktree: it starts without the parent's uncommitted diff; pass absolute paths or a ref (the `subagent` tool has no per-call `isolation`; `cwd` sets the directory). Refine missing context with a bounded query instead of copying the repository or spawning another reviewer.

Delegation may only reduce the parent's authorized scope, tools, external effects, remaining budget, and concurrency. Do not allocate the same remaining budget independently to every child. Missing authority is not an unrestricted grant. Verify runtime support before claiming enforcement: a prompt or handoff field is not a sandbox. Return executed checks with their content revision and distinguish missing evidence from success.

## Stop conditions

The shared agent contract (`$CLAUDE_CONFIG_DIR/docs/agent-contract.md`) owns retry budgets and termination. Keep routing to one owner per unresolved responsibility; avoid recursive reviewers and duplicate lanes. Verify returned conclusions against their evidence before synthesis.

## Output

For delegated work, state the selected responsibility, owner, evidence and stop
condition concisely. Keep routine tool selection internal; do not add a routing
report to every user response. Report unavailable capabilities and material
tradeoffs. Routing lives in `$CLAUDE_CONFIG_DIR/rules-ref/research-and-tools.md`;
inventory checks run through the `harness-audit` skill. (optional)
