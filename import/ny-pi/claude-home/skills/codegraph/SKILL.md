---
name: codegraph
description: "Use the codegraph MCP index for symbols, callers, flows and blast radius. Use for structural code questions in an indexed repo; read it before the first codegraph_* call (status check for negative claims)."
---

# Codegraph

Use the graph for structural questions and direct text search for literals, configuration, non-code files, or coverage fallback.

## Reliable workflow

0. Load the tools: the `codegraph` MCP server is deferred in pi, so call `tool_search` (e.g. "codegraph status explore callers impact node") once per session before the first call; the tools are `mcp__codegraph__codegraph_status`, `_explore`, `_callers`, `_impact` and `_node`. If they do not load, use the CLI below and say so.
1. Locate the index: the nearest `.codegraph/` at or above the working directory. Pass that root as `projectPath` on every call. If none exists, only the main session runs `codegraph init`, and only in an authorized durable repository; never index the home directory, secret directories, ephemeral job directories, or disposable worktrees.
2. Call `codegraph_status` before relying on an index for consequential, negative or exhaustive conclusions. Pending changes or `reindexRecommended` mean degraded: confirm affected files directly. The MCP watcher keeps indexes fresh; `codegraph sync` is only for scripts outside a session.
3. Start with `codegraph_explore`: one call returns the relevant symbols' verbatim source, the call paths between them and a blast-radius summary. Name the symbols or files you already know in the query.
4. Use `codegraph_callers` for exact callers and `codegraph_impact` (raise `depth` when needed) for what a change can break. Narrow same-named symbols with `file`.
5. Read one symbol or a file range with `codegraph_node` (`includeCode` for the body, `symbolsOnly` for a cheap file overview).
6. Spot-check load-bearing negative/exhaustive conclusions with `rg`. Absence from the graph is never proof of absence. Confirm load-bearing callers with the pi LSP tools (`lsp_references`, `lsp_definition`, `lsp_symbols`, `lsp_hover`; zero-based `line`/`character`) where a language server is configured (`~/.pi/agent/lsp.json`, 2026-11-11: TypeScript, Python via pyright, Go, Rust); an LSP error means degraded coverage, not absence. (optional)

## Tool routing

| Question | Tool |
| --- | --- |
| How does X work, how does X reach Y, survey an area | `codegraph_explore` |
| Exact callers of a symbol | `codegraph_callers` |
| What a change can break (transitive dependents) | `codegraph_impact` |
| One symbol's source and call trail, or a file range | `codegraph_node` |
| Index freshness, pending changes, languages | `codegraph_status` |
| Exact text, config, non-code files | `rg` |

`codegraph_explore` returns a lot of source (several thousand tokens); prefer `callers`/`impact`/`node` for narrow questions. The CLI mirrors every tool (`codegraph explore|callers|impact|node -p ROOT`, `codegraph status --json ROOT`) through `bash`, for subagents without MCP access or when the MCP server is down.

## Confidence classification

- `pass`: index complete with no pending changes. This means no known failure signal, not proven completeness.
- `degraded`: pending changes, `reindexRecommended`, a dynamic or reflective call path, or truncated output. Verify the affected source directly.
- `blocked`: no index, or graph unavailable. Use direct source evidence and say the graph was not relied upon.

Always state the classification when graph evidence supports a consequential, negative, or exhaustive conclusion.

If graph tools are unavailable, report the limitation and use bounded direct inspection without claiming graph verification. Return an evidence packet with paths/symbols, current content revision, known gaps, and the next discriminating query; stop refining when the question is answered or the existing retry budget is exhausted.

## Multi-repository rule

Query another indexed repository by passing its root as `projectPath`. Never infer write ownership or safe parallelism from graph clusters or missing edges.
