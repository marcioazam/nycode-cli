# MCP and CLI routing

> pi note: this map was written for Codex profiles and Claude Code. pi has no `--profile` switch; the loaded
> catalog is `~/.pi/agent/mcp.json` (17 servers). Tool names are `mcp__<server>__<tool>` with every character
> outside `[A-Za-z0-9_]` turned into `_` (`mcp__brave_search__brave_web_search`, `mcp__package_version_check__…`).
> Every server is deferred: call `tool_search` with a descriptive query before its first use in a session; only
> `mcp__keenable__search_web_pages` is callable directly. Web-search provider order, readers and fallback live only
> in `~/.pi/agent/claude-home/skills/deep-search/references/providers.md`. Rows marked "not in pi" are kept for Claude Code;
> in pi use the stated substitute. Codex profile notes below are background only: pi never routes to Codex (2026-11-12). Use this table only for per-server boundaries.

This is a routing guide, not an installation or permission grant. Use the current
tool catalog, exact input schema and parent scope. A configured server, CLI or
skill may be unavailable in an already-open session. Do not install a replacement
or contact another model provider automatically. Keep local content out of public
search queries; external queries contain only task-relevant public information.

## Installed MCP responsibilities

| Server | Choose for | Boundary or fallback |
| --- | --- | --- |
| `codegraph` | Indexed structure, callers, flows and blast radius | `mcp__codegraph__codegraph_status`, then explore/callers/impact/node with `projectPath` = nearest `.codegraph` root; use `rg` for literals, config and stale/unindexed scopes. Run `codegraph init` only in authorized durable repositories, never the home or secret directories. |
| `context7` | Version-relevant library/framework documentation | Resolve the library and query the specific question; fetch official docs when absent or stale. OpenAI topics follow `openai-docs` source order. |
| `openaiDeveloperDocs` | Official OpenAI, Codex and ChatGPT documentation/API schemas | Not in pi or Claude Code: search `developers.openai.com` and `platform.openai.com` through the dev row instead. Codex: use `openai-docs`; search then fetch. |
| `perplexity` | First web-search provider: current facts (`perplexity_search`), multi-step analysis (`perplexity_reason`), broad synthesis (`perplexity_research`, 30-120 s) | Follow the `perplexity-urls` contract; tools return `{answer, sources}`. Cookie session through the keyring wrapper: never read the cookies. Pair every search with an independent provider; on a login, rate-limit or empty-answer failure use two other providers. Base profile in Codex. |
| `brave-search` (`mcp__brave_search__*`) | News (`brave_news_search`), local and places, images and video; `brave_llm_context` later in the fact row | Search plan with rate limits (429 on 15% of calls in the 30 days to 2026-10-24); row order in the provider matrix. |
| `parallel` (Codex: `parallel-search`) | Multi-hop agent web search (`web_search`, several queries per objective) and page reading (`web_fetch`) | Remote (`mcp.parallel.ai`), rate-limited. First tool of the multi-hop row; Research profile in Codex. |
| `exa` | Fact lookups, semantic discovery, companies and people in public roles (`category:company`/`people`), page reading (`web_fetch_exa`) | First tool of the fact and org rows; `agent_run` only as hosted research. |
| `octen` | Fact lookups (`search`), several sub-queries in one call (`broad_search`), news, images and video, extraction | Second in the fact and news rows (low cost per task; re-verify any ranking claim before relying on it). |
| `youcom` | Research-oriented search (`mcp__youcom__you_search`, highlights) and URL extraction (`mcp__youcom__you_contents`) | Fact and news rows; do not repeat identical searches across providers. `full_page` extraction bills each page. |
| `context-mode` (plugin) | Sandboxed execution, web fetch and search that keep raw output out of context | Not in pi: filter output at the source (`bash` into a `/tmp` file, then `tail`/`rg`) or delegate the sweep to a subagent; see `context-economy`. Read diffs, evidence and files to edit directly. |
| `fetch` | Reading a known public URL | Local gateway (`127.0.0.1:6040`); pi's native `web_fetch` and `mcp__keenable__fetch_page_content` are the usual first routes. A fetch failure is not proof a page has no content. |
| `keenable` | Default web search (`search_web_pages`, direct) and page reading (`fetch_page_content`) | pi's replacement for the built-in web search; pair it with Perplexity per the provider matrix. |
| `firecrawl` | JS-rendered/complex public pages, structured scraping, supported documents | Use available scrape/parse/search contracts. Hosted tools, limits and authentication vary; a local document may require upload and appropriate task authority. |
| `package-version-check` | Latest stable versions of packages, CI actions and tools from their registries | pi and Claude Code: HTTP via the local MCP gateway (`127.0.0.1:6040`); Codex: research profile (the base keeps <= 20 tools). Cite the registry URL; free, no key. |
| `nimble` | One closed lookup (`nimble_search`, `search_depth: "standard"`, `focus: "general"`) and page extraction (`nimble_extract`) | Remote, API key. Its own instructions keep research and datasets off `nimble_search`; agent, crawl and template tools bill per task and run only on request. |
| `mcp-debugger` | Runtime state: breakpoints, stepping, variables, expression evaluation over DAP | Not in pi (use `dlv`/`debugpy` from `bash`). Profile `debug` in Codex. It launches and attaches to local processes and `evaluate` runs code: use it only on local, authorized targets. Python needs `debugpy` in the target environment; Go uses `dlv`. |
| `linear` | Issue tracking: create, update and query Linear issues | Profile `tasks` in Codex; OAuth by the user (`codex mcp login linear`, `/mcp login linear` in pi, `/mcp` in Claude Code). Writes need task authority. |
| `rea` | Reverse engineering of binaries, packaged apps and runtime behavior | Not in pi's `mcp.json`. Profile `re` in Codex (about 170 tools, kept out of the base). Native analysis needs Ghidra, Hopper or IDA. |
| `computer-use-linux` (Codex: `cua-driver`) | Native desktop apps and OS-level GUI interactions | pi and Claude Code register this as `computer-use-linux` (`mcp__computer_use_linux__*`) (AT-SPI/portal backend); Codex exposes `cua`. Use the `cua-driver` skill, exact pid/window, fresh tokens and readback; do not substitute desktop clicks for DevTools diagnostics. (optional) |
| `chrome-devtools` | Browser DOM, console, network, performance traces and JS heap | Not in pi: use Playwright (`mcp__playwright__*`). Claude Code: only where the project enables the chrome-devtools-mcp plugin. Use browser testing or web performance skill. Isolated Chrome, exact pageId, current tool schema; local traces are not field data. |
| `playwright` | Semantic browser interaction in an isolated test session | Use profile `browser`; existing authenticated CDP requires an explicit target and the local CDP procedure. Do not share page ownership with DevTools. |
| `e2e` | Driving a project's running app (`open_session`, `observe`, `call`) for the `e2e` skill | Not in pi (neither the server nor the `e2e` skill). Profile `browser` in Codex; needs the project's `e2e.config.ts` (`CONFIG_NOT_FOUND` otherwise). Pinned `e2e@0.20.0` through absolute `npx`. |
| `paper-search` (`mcp__paper_search__*`) | Academic literature (research profile in Codex; local gateway in pi) | Uses the local stdio adapter over installed paper-search-mcp 0.1.4. Semantic Scholar failures are explicit; use Crossref/arXiv when it is rate-limited. Verify the effective runtime. |
| `serena` | Symbol-level code navigation and edits (LSP-backed): find/referencing symbols, semantic edits | Not in pi: use the `lsp_*` tools (`lsp_definition`, `lsp_references`, `lsp_symbols`). Claude Code plugin, disabled globally (2026-10-27). Prefer codegraph for structure/impact; serena for precise symbol rename/refactor. |
| `dart-mcp-server` (plugin) | Dart/Flutter: analyze, hot reload/restart, pub, widget inspector, runtime errors, DTD | Not in pi (use `dart`/`flutter` CLIs from `bash`). Claude Code dart-and-flutter plugin, enabled only in `~/source/nylla/jogai` (its `.claude/settings.local.json`). Use for Dart/Flutter projects; run hot reload/restart after code changes. |
| `browser-use` (plugin) | Driving the user's logged-in Chrome over CDP (interaction, scraping, screenshots) | Not in pi (the `browser-harness` CLI and skill cover authorized CDP work). Claude Code plugin. One owner per page; for isolated automation prefer Playwright, for DOM/console/network diagnostics use chrome-devtools. |

Base, fast, economy and 9router expose codegraph, Context7, Brave, Fetch,
OpenAI Docs and Perplexity: 20 tools.
`codex --profile research` adds Exa (search/fetch), You.com (search/contents),
Firecrawl (search/scrape/parse), Paper Search (five academic tools), Parallel
Search (search/fetch), Nimble (search/extract) and package-version-check (four
version tools).
`codex --profile ui` adds Chrome DevTools; `browser` adds isolated Playwright and e2e;
`debug` adds mcp-debugger; `re` adds rea; `tasks` adds Linear.
Cua remains disabled in every profile. An external-model second opinion from pi uses
`pi -p --no-session --model <provider/id>` (or `claude -p`), only when the task authorizes the data and the cost; it is not independent proof.

Google developer documentation has no installed MCP: fetch the official page or its
Markdown variant (`ai.google.dev/gemini-api/docs/llms.txt`, `ai.google.dev/api/<page>.md.txt`)
before general search. The Google Developer Knowledge MCP needs a Google Cloud project
and API key; propose it only if Google documentation work becomes frequent.
Profile files overlay the base in current Codex; they do not manufacture missing
tools or reload an open session. Verify the effective loaded catalog before
claiming availability. Do not change profiles mid-task by editing configuration.

Reuse a verified runtime catalog within the same session until reconnection or
configuration changes require a fresh check. For structural discovery, record
codegraph status once for each task/root, then issue only the
relevant explore/callers/impact/node queries. Refresh changed index/scope/content or
conflicting evidence; use direct reads for literals and unindexed scopes.
Cached misses are fallback hints, never completeness evidence. Reuse current
primary sources across workers; refresh version-sensitive or changed claims.

## Browser and desktop selection

- For public facts, start with search/fetch/extraction, not a desktop session.
- For web performance, console/network errors or heap leaks, use `chrome-devtools`
  (in pi: Playwright, whose console and network tools cover the diagnostics; no heap or CPU profiler)
  and `web-performance-audit` or `browser-testing-with-devtools`.
- For an already authorized CDP interaction or browser workflow, `browser-harness`
  is an existing CLI route. Follow its local integration and dedicated profile.
  Its skill remains explicit-only; reference it when invoked, and otherwise use
  the active browser-testing skill with inspected CLI contracts when appropriate.
  It is not an MCP entry. Playwright MCP is already registered for the `browser`
  profile; attaching to an existing authenticated CDP session is a separate route.
- For native application dialogs or OS windows, use Cua. Native GNOME/Wayland
  support depends on the loaded helper; do not restart a user's session to fix it.
- Assign one owner per browser page/profile or desktop window. Concurrent agents
  must not navigate the same page or reuse each other's stale element handles.
  Share immutable evidence; allocate separate isolated targets for independent work.
- A read-only reviewer can inspect supplied traces/screenshots or run disposable
  fixture observations only when the assignment permits those artifacts. Role
  `read-only` does not authorize clicking production UI or sending forms.
- `browser-harness`, Cua and Chrome DevTools have different target identifiers.
  Never carry refs, coordinates, page IDs or snapshot tokens between them. On a
  necessary handoff, resolve and observe the target anew.

## Keep native tools useful

Shell, file tools, `rg`, Git, `gh`, project tests and existing database CLIs remain
valid routes. GitHub MCP, DBHub, Grafana and Search Console were recommendations,
not installed integrations. Do not invent their tools or claim live CI, database,
production or indexation evidence from a local audit.

Research external uncertainty according to the
[task research contract](../../evidence-research/references/research-contract.md),
without a universal query quota. Search Perplexity first plus at least one
independent provider and read the primary sources for material claims. Reuse the
record across workers/continuations, and stop when the
decision is supported or a concrete limitation is recorded.
Do not load all tools, skills or agents to appear thorough.
Cloudflare and other platform skills can use an authorized CLI/API; possessing
the skill does not imply a corresponding MCP is installed.
