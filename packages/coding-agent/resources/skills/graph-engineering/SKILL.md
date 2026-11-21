---
name: graph-engineering
description: "Decompose a multi-file task into a unit graph (disjoint files, dependency edges from the code graph, waves) before delegation. Use for multi-module or parallel-lane work. Not for swarm-orchestration or lane-integration."
---

# Graph engineering

1. The unit graph is the plan. Nodes are units with one owner per file. `after` edges are data or symbol
   dependencies. State is the lanes' structured handbacks. The only cycle allowed is the bounded fix loop.
2. Cut units: one acceptance item and about 100 tool calls each; disjoint files. A shared file (registry, router,
   barrel export) belongs to one unit the others follow through `after`. Units that share a decision inside one
   blast radius merge. Skip the graph for a single known file or a sequential task (one worker; multi-agent loses up to 70% there).
   Graph answers earn their cost at name lookup and one hop (callers, impact), not in chained expansions: stop after one
   expansion and read the `file:line` slices. Map scope with `mcp__codegraph__codegraph_explore` / `mcp__codegraph__codegraph_impact` (load them with `tool_search` first; `projectPath` = the repository root) on the symbols each unit changes.
3. Edges: `python3 ~/.pi/agent/claude-home/skills/graph-engineering/scripts/unit_graph.py suggest UNITS.json --db <repo>/.codegraph/codegraph.db`
   (read-only; `--kinds`, `--root` for absolute index paths). It adds `after` edges from calls, imports,
   references, extends and instantiates edges across owned files. Merge every `mutual` pair (a cycle cannot be
   scheduled). Treat `unindexed` files as unverified and check them with `rg`.
4. Check: `unit_graph.py check UNITS.json [--max-units 12] [--max-writers 4]` (default 4: pi runs at most 4 subagents of one parallel call at once). Fix every error (missing id or
   files, duplicate id, file owned twice, unknown or self `after`, cycle). Read `waves`, `critical_path`, `width`
   and the warnings. Exit 0 ok, 1 graph errors, 2 invalid input.
5. Width: parallelize a wave only when its units are independent and the critical path plus re-exploration and
   alignment overhead beats running them serially. Keep at most 4 implementers (pi's parallel cap); returns plateau beyond four and
   extra implementers fragment the code. Otherwise run one worker.
6. Run the ready batch, then re-plan the next batch from the handbacks instead of fixing the whole graph upfront.
   Merge lanes in producer-to-consumer order. Run one gate on the integrated head: disjoint files remove textual
   conflicts, not semantic ones.
7. Output: the checked units JSON (kept in the task's `/docs` record when the work spans more than one call) and, per wave, the briefs for one parallel `subagent` call `{tasks: [{agent, task, cwd?}, ...]}` (at most 8 tasks, 4 at once; `swarm-orchestration` picks each unit's agent and tier). Unit shape:
   `{id, goal, files: [], after?: [], tier?, acceptance?, agent?, risk?}`, paths repository-relative.

## Evidence (read 2026-11-08)
- https://arxiv.org/abs/2503.21710, https://arxiv.org/abs/2502.00350 (repository graphs: +30-156% relative resolve, +6.33 pp; preprints) and https://arxiv.org/html/2610.33958 (embedding index carries the gain, graph tools add nothing for small open models; 1 hop dominates); https://arxiv.org/abs/2512.08296 (+80.8% decomposable, -70% sequential). Research 2026-11-13: `~/.pi/agent/claude-home/docs/research/2026-11-13-graph-loop-harness-sota.md`

- https://arxiv.org/abs/2610.08647 (SquidAgent: parallel multi-agent often slower than one agent from re-exploration and alignment overhead; parallelize a layer only when critical path plus overheads beats serial; 2.6x mean wall-time speedup over Claude Code; preprint, self-reported)
- https://arxiv.org/abs/2610.17471 (implementers and verifiers plateau beyond four workers; extra implementers fragment code; preprint)
- https://arxiv.org/abs/2610.07261 (declared disjoint scopes plus producer-to-consumer merge order: conflicts 13 to 0, clean integration 1/9 to 9/9; single author, small n)
- https://arxiv.org/abs/2510.18893 (CodeCRDT: zero textual merge failures but about 5-10% semantic conflicts; parallel speedup up to 21.1% or slowdown up to 39.4% depending on interdependence; preliminary)
- https://arxiv.org/abs/2605.06320 (LATTE: an evolving shared task-dependency graph beats static decomposition and leader-worker on tokens, time and coordination failures; abstract only)
- https://arxiv.org/abs/2604.17111 (uncoordinated parallel agents on one rate-limited endpoint fail 72-100%; cap concurrency)
- https://arxiv.org/abs/2610.10263 and https://arxiv.org/abs/2604.02460 (parallel coding agents spend 1.41-3.31x tokens; one agent matches several at equal thinking tokens)
