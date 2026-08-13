# Fontes — o que "SOTA 2026" exige de um harness de terminal

Acesso em 2026-08-13. Passagens citadas em inglês, no original, para que a
tradução não vire a fonte. Alimenta
[`research-sota-2026.md`](../.specs/nycode-rs/research-sota-2026.md).

---

## State of CLI Coding Agents, Mid-2026

<https://blog.arcbjorn.com/state-of-cli-coding-agents-2026> · 2026-07-04

Levantamento de 35 agentes ativos, com comparação por área entre Claude Code,
Codex CLI, Copilot CLI, OpenCode e Omp.

> By 2025 every serious agent had the same skeleton: edit-run-test loop, project
> instructions file, MCP, plan mode, permission prompts, headless mode. None of
> that separates anyone anymore.

Sobre o `pi`:

> Mario Zechner argues a modern model needs 4 tools (read, write, edit, bash), a
> system prompt under 1,000 tokens, and nothing else in core — MCP included
> belongs in a TypeScript extension SDK. Personal project to 67k stars in under
> a year, which says the audience for harness bloat had thinned.

Sobre sandbox, na tabela "Safety and trust":

> There is no clean option. Codex CLI is the only lab agent that's open source,
> OS-sandboxed, and local-model-capable at once. Claude Code and Copilot sandbox
> well but stay closed and cloud-bound. OpenCode and Omp are fully open and run
> local models, but permissions instead of kernel isolation.

Sobre engenharia de custo:

> Most harnesses treat provider-side caching as luck. Reasonix treats it as
> design — byte-stable context so DeepSeek's prefix cache keeps hitting, 99.82%
> on heavy days per their reports.

Sobre governança de padrão e risco de descontinuidade:

> Maintenance risk gets ignored. Aider, Open Interpreter, and Continue all show
> slowed cadence. Google retired a 106k-star tool's consumer access with a
> month's notice. [...] MCP, AGENTS.md, and ACP under AAIF governance turn that
> migration into an afternoon, not a quarter.

Subagentes aparecem como "Yes" na linha de orquestração das cinco ferramentas
comparadas.

---

## What I learned building an opinionated and minimal coding agent

<https://mariozechner.at/posts/2025-11-30-pi-coding-agent/> · 2025-11-30

O autor do `pi`, referência declarada na spec.

Sobre as duas famílias de TUI:

> One is to take ownership of the terminal viewport [...] and treat it like a
> pixel buffer. [...] I call these full screen TUIs. Amp and opencode use this
> approach.
>
> The second approach is to just write to the terminal like any CLI program,
> appending content to the scrollback buffer, only occasionally moving the
> "rendering cursor" back up a little within the visible viewport [...] This is
> what Claude Code, Codex, and Droid do.

Sobre por que o modelo linear se encaixa:

> Coding agents have this nice property that they're basically a chat interface.
> [...] Everything is nicely linear, which lends itself well to working with the
> "native" terminal emulator. You get to use all the built-in functionality like
> natural scrolling and search within the scrollback buffer.

Sobre flicker:

> To prevent flicker during updates, pi-tui wraps all rendering in synchronized
> output escape sequences (`CSI ?2026h` and `CSI ?2026l`). This tells the
> terminal to buffer all the output and display it atomically.

Sobre o conjunto de ferramentas — o ponto que desmonta a leitura de "quatro
ferramentas":

> There are additional read-only tools (grep, find, ls) if you want to restrict
> the agent from modifying files or running arbitrary commands. By default these
> are disabled, so the agent only gets the four tools above.

Sobre a divisão do resultado de ferramenta entre modelo e interface:

> pi-ai's tool implementation allows returning both content blocks for the LLM
> and separate content blocks for UI rendering.

---

## pi — README do pacote coding-agent

<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md>

Superfície de comandos e formato de sessão.

> Sessions are stored as JSONL files with a tree structure. Each entry has an
> `id` and `parentId`, enabling in-place branching without creating new files.

> **`/tree`** - Navigate the session tree in-place. Select any previous point,
> continue from there, and switch between branches. All history preserved in a
> single file.

> **`/fork`** - Create a new session file from a previous user message on the
> active branch. [...] **`/clone`** - Duplicate the current active branch into a
> new session file at the current position.

> Available built-in tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`

> Compaction is lossy. The full history remains in the JSONL file; use `/tree`
> to revisit.

Da página do projeto, <https://pi.dev/>, sobre modos e sobre subagentes:

> Four modes: interactive, print/JSON, RPC, and SDK.

> `Enter` sends a steering message (delivered after current tool, interrupts
> remaining tools). `Alt+Enter` sends a follow-up (waits until the agent
> finishes).

> ### No sub-agents
> Spawn Pi instances via tmux, or build your own with extensions, or install a
> package that does it your way.

Rodapé da interface, que é o contrato de contabilidade de custo:

> **Footer** - Working directory, session name, total token/cache usage (`↑`
> input, `↓` output, `R` cache read, `W` cache write, `CH` latest cache hit
> rate), cost, context usage, current model.

---

## Codex — Sandbox

<https://developers.openai.com/codex/concepts/sandboxing>

> Sandboxing and approvals are different controls that work together. The
> sandbox defines technical boundaries. The approval policy decides when the
> agent must stop and ask before crossing them.

> The sandbox applies to spawned commands, not just to built-in file operations.
> If the agent runs tools like `git`, package managers, or test runners, those
> commands inherit the same sandbox boundaries.

> The sandbox reduces approval fatigue. Instead of asking you to confirm every
> low-risk command, the agent can read files, make edits, and run routine
> project commands within the boundary you already approved.

Enforcement por plataforma:

> On **macOS**, sandboxing works out of the box using the built-in Seatbelt
> framework. On **Windows**, Codex uses the native Windows sandbox [...] and the
> Linux sandbox implementation when you run in WSL2. On **Linux and WSL2**,
> install `bubblewrap` [...] Codex uses the first `bwrap` executable it finds on
> `PATH`.

Sobre avisar quando o confinamento não está disponível — o precedente para a
regra de falha ruidosa do ADR-0005:

> Codex surfaces a startup warning when `bwrap` is missing or when the helper
> can't create the needed user namespace.

Política padrão, que é o modelo do `workspace-write`:

> Codex can read and edit files in the current workspace and run routine local
> commands. It asks before using the internet or going beyond the workspace
> boundary. Sandbox `workspace-write`, Approvals policy `on-request`.

---

## The 2026-07-28 MCP Specification

<https://blog.modelcontextprotocol.io/posts/2026-07-28> e
<https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate>

> The headline change is that MCP is now stateless at the protocol layer.

> Method and tool names travel in the `Mcp-Method` and `Mcp-Name` HTTP headers,
> so gateways can route and authorize on headers directly.

> MRTR replaces the server-initiated `elicitation/create`,
> `sampling/createMessage`, and `roots/list` requests that previously required a
> held-open stream.

> Tool `inputSchema` and `outputSchema` are lifted to full JSON Schema 2020-12
> (SEP-2106). [...] Separately, the error code for a missing resource changes
> from the MCP-custom `-32002` to the JSON-RPC standard `-32602` Invalid Params
> (SEP-2164).

Complemento sobre a política de depreciação, de
<https://stacktr.ee/blog/mcp-2026-spec-changes>:

> the 2026-07-28 specification deprecates the Roots, Sampling, and Logging
> features (SEP-2577) and reclassifies the older HTTP+SSE transport as
> Deprecated (SEP-2596). Deprecated does not mean gone: these features remain in
> the specification for at least the twelve-month window.

Histórico de revisões, de
<https://hidekazu-konishi.com/entry/mcp_specification_version_timeline.html> —
o dado que sustenta "revisa a cada poucos meses": 2024-11-05, 2025-03-26,
2025-06-18, 2025-11-25, 2026-07-28.

---

## Harness design for long-running application development

<https://www.anthropic.com/engineering/harness-design-long-running-apps> · 2026-03-24

Sobre compactação contra reset:

> Some models also exhibit "context anxiety," in which they begin wrapping up
> work prematurely as they approach what they believe is their context limit.
> [...] This differs from compaction, where earlier parts of the conversation
> are summarized in place so the same agent can keep going on a shortened
> history. While compaction preserves continuity, it doesn't give the agent a
> clean slate, which means context anxiety can still persist.

Sobre autoavaliação — o argumento que sustenta contexto próprio no subagente:

> When asked to evaluate work they've produced, agents tend to respond by
> confidently praising the work—even when, to a human observer, the quality is
> obviously mediocre.

> tuning a standalone evaluator to be skeptical turns out to be far more
> tractable than making a generator critical of its own work

---

## Opções de confinamento em Rust

- **`landlock`** · <https://crates.io/crates/landlock> · 0.4.5, 2026-07-27.
  "This Rust crate provides a safe abstraction for the Landlock system calls."
  ABI v9 a partir do Linux 7.1. Modo best-effort determina compatibilidade com a
  interseção entre o kernel corrente e o que o chamador pede; `all_threads()`
  exige ABI v8.
- **`seccompiler`** · <https://crates.io/crates/seccompiler> · 0.5.0. Filtra
  syscall, não caminho: "They don't allow you to filter by path name in `open`
  calls, or indeed any syscall arguments that are pointers".
- **`extrasafe`** · <https://crates.io/crates/extrasafe> · combina seccomp,
  Landlock e user namespaces. "Currently extrasafe only supports x86_64."
- **`birdcage`** · <https://crates.io/crates/birdcage> · "Linux via namespaces,
  macOS via `sandbox_init()` (aka Seatbelt)". Depende de `seccompiler ^0.3.0`.
  "It is not a complete sandbox preventing all side-effects or permanent damage."

## rmcp — SDK oficial em Rust

<https://docs.rs/rmcp> · Apache-2.0

> The official Rust SDK for the Model Context Protocol.

Features de transporte relevantes ao cliente: `transport-child-process` para
stdio, `transport-streamable-http-client-reqwest` para HTTP com backend
`reqwest`. Backends de TLS: `reqwest` usa rustls, descrito como o padrão
recomendado — o mesmo que o `nycode-ai` já usa.

## Benchmarks

- <https://www.tbench.ai/leaderboard/terminal-bench/2.0> — 142 entradas; o
  `Terminus 2`, agente mínimo de referência, aparece em 42,8% com Claude Sonnet
  4.5, à frente de vários harnesses completos.
- <https://www.swebench.com/verified.html> — "we evaluate all LMs using
  mini-SWE-agent in a minimal bash environment. No tools, no special scaffold
  structure; just a simple ReAct agent loop."
- <https://medium.com/@allahverdiyev.tural/beyond-swe-bench-how-to-actually-evaluate-ai-coding-agents-in-2026-8233940530f1>
  — relata que 19,78% dos casos rotulados como resolvidos entre as 30 primeiras
  entradas seriam semanticamente incorretos. Fonte secundária; usada apenas para
  sustentar a decisão negativa de não perseguir leaderboard.
