# Search providers (canonical, pi)

The single provider map for every search skill and agent in the pi harness: `perplexity-urls`, `deep-search` and its variants (`fact-check`, `academic-search`, `tech-search`, `entity-search`, `legal-search`, `wide-search`), `evidence-research`, the scouts and `claim-verifier`. Other files point here instead of listing providers.

Tool names are the real pi names (`mcp__<server>__<tool>`, every character outside `[A-Za-z0-9_]` turned into `_`), confirmed with `tool_search` on 2026-11-11. Every MCP server is deferred: call `tool_search` with a descriptive query (for example "perplexity search", "exa web search company", "octen news broad", "brave news llm context", "firecrawl scrape gov", "paper search arxiv", "package versions registry") before the first call in a session. A tool missing from `tool_search` results is not available: say so and take the next tool; never assume.

Every web search: Perplexity first under `perplexity-urls`, plus at least one independent provider from the task's row, in the same turn. Take the first tool of the row; workers in one run take different tools of the row. "Next" means the next tool in the row, then the `fact` row.

Parallel: the Claude Code plugin is disabled (owner decision 2026-11-04), but in pi the `parallel` server is registered in `~/.pi/agent/mcp.json` and its tools load (free tier, rate-limited). Use it where the row lists it; on 429 or an error take the next tool.

## Rows by task class

Short names below drop the `mcp__<server>__` prefix only when the server is obvious; the full names are in the tool index at the end.

| class | Perplexity | independent providers, in order | notes |
|---|---|---|---|
| fact | `mcp__perplexity__perplexity_search` (`search_type: "fast"` for a single fact) | `mcp__keenable__search_web_pages` → `mcp__exa__web_search_exa` → `mcp__octen__search` → `mcp__youcom__you_search` → `mcp__brave_search__brave_llm_context` → `mcp__firecrawl__firecrawl_search` → `mcp__nimble__nimble_search` | default row; keenable leads it (AA Search Index #1, 2026-11-09, and the mcp.json default); `nimble_search` only for one closed lookup (its own instructions; `search_depth: "standard"` needs `focus: "general"`) |
| multi-hop | `perplexity_search` or `mcp__perplexity__perplexity_reason` | `mcp__parallel__web_search` (2-3 `search_queries` per objective) → `web_search_exa` → `mcp__octen__broad_search` (several sub-queries in one call) | comparisons, chains of facts, landscape questions |
| dev | `perplexity_search` with the vendor in `domains` | `mcp__parallel__web_search` → `web_search_exa` → `mcp__firecrawl__firecrawl_developer_search` or `firecrawl_search` with `categories: ["developer"]` (when credits remain) | libraries, APIs, errors, issues; latest stable versions and release dates: `mcp__package_version_check__get_latest_package_versions` first (CLI tools: `get_latest_tool_versions`; Actions: `get_github_action_versions_and_args`; cite the registry URL); `mcp__context7__resolve_library_id` then `mcp__context7__query_docs` for library docs; `gh` (read-only, through `bash`) and registries for code; Brave and You.com rank last here |
| news | `perplexity_search` with `recency` | `mcp__brave_search__brave_news_search` (`freshness`) → `mcp__octen__news_search` → `you_search` (`freshness`) | record publication dates; the original report beats aggregators and syndicated copies |
| papers | `perplexity_search` with `sources: ["scholar"]` | paper_search (`mcp__paper_search__search_papers` with an explicit `sources` list, `search_semantic`, `search_openalex`, `search_arxiv`, `search_pubmed`, `search_crossref`, `search_europepmc`, `search_core`) → `mcp__firecrawl__firecrawl_research_search_papers` | DOI or arXiv id is the identity; paper_search counts as the independent provider; DOI check: `mcp__paper_search__get_crossref_paper_by_doi`; citation graph: `mcp__firecrawl__firecrawl_research_related_papers` |
| org | `perplexity_search` | `web_search_exa` with `category:company` (people in public roles: `category:people`) → `mcp__octen__business_search` → `mcp__parallel__web_search` → `mcp__octen__search` | entity-search ethics gate; never the paid people-enrichment tools (`mcp__firecrawl__people_company_search`, `people_company_enrich`): they return contact data and bill per record |
| law | `perplexity_search` with official `domains` | `mcp__firecrawl__firecrawl_gov_search` (US) → `web_search_exa` or `mcp__parallel__web_search` restricted to official domains | owned by `legal-search` |
| local | — | `mcp__brave_search__brave_place_search` → `mcp__octen__place_search` → `mcp__brave_search__brave_local_search` (Brave Pro plan only) | places, opening hours, addresses of businesses |
| media | — | `mcp__brave_search__brave_image_search`, `mcp__brave_search__brave_video_search`, `mcp__octen__image_search`, `mcp__octen__video_search` (beta), `mcp__parallel__image_search` | |

Regional or Portuguese-language results: Brave `country: "BR"` and `search_lang: "pt-br"`, octen `language: ["pt"]`, Perplexity `domains` with `.br` sites.

## Readers

In order: `mcp__exa__web_fetch_exa` → `mcp__parallel__web_fetch` (several URLs, one objective) → `mcp__youcom__you_contents` → `mcp__keenable__fetch_page_content` (`live: true` for current facts; `prompt` to pull one detail from a long page) or the pi `web_fetch` tool → the same readers on `https://r.jina.ai/<url>` for JavaScript-rendered or empty shell pages and some bot walls (keyless, 20 requests a minute, public URLs only; `quote_check.py` already retries a mismatch or blocked page this way) → `mcp__octen__extract` (`mode: "advanced"` for anti-bot or JavaScript sites) → `mcp__firecrawl__firecrawl_scrape` only for what the others cannot read: bot walls (in.gov.br, congress.gov, ecfr.gov), `parsers: ["pdf"]` (for papers try the arXiv `/abs` or `/html` page first, or `mcp__firecrawl__firecrawl_research_read_paper`), `formats: ["query"]` with a direct-quote prompt for long pages (check `mcp__firecrawl__firecrawl_credit_usage` first) → `mcp__fetch__fetch` (robots.txt blocks github.com) → `mcp__nimble__nimble_extract`. A reader confirms a page; it is never the independent provider. Bulky pages: cap the size (`max_chars`, `maxCharacters`, `max_length`) and read in slices instead of loading the whole page.

## Hosted research

`mcp__exa__agent_run`, `mcp__firecrawl__firecrawl_agent` (poll `firecrawl_agent_status`), `mcp__parallel__web_research` and, inside deep-search, `mcp__perplexity__perplexity_research` run only with `--hosted` or when the user names them; they are slow and billed, and their claims are verified like any other. Parallel FindAll and `parallel-cli` are not installed. Nimble agent, crawl and template tools bill per task and run only on request.

## Failures and limits

- Perplexity fails (login, 429, empty answer): use two providers from the row and report it.
- A provider returns 429, nothing, or an out-of-credits error: retry once at most, then take the next tool in the row and say so.
- Known on 2026-11-11: `mcp__firecrawl__firecrawl_credit_usage` reports 0 remaining credits (plan 1000, period ends 2026-12-04): skip billed Firecrawl calls until it shows credits again.
- Known on 2026-11-04: the owner installed a new Firecrawl key (1025 credits, period 2026-11-04 to 2026-12-04) and a new Octen key (Octen `extract` had returned 403 "Payment method required"); a running session keeps the old headers until `/mcp` reconnects the server.
- Known on 2026-10-29: Brave has plan rate limits (`brave_local_search` needs a Pro plan); Firecrawl credits are scarce (one claim-verifier run that read Firecrawl first used about 95 credits for 23 reads): keep it the last search and reader choice; Parallel is rate-limited (free tier); package_version_check runs on the local MCP gateway with no key (GitHub API rate limits apply without a PAT); openaiDeveloperDocs is not registered (use `developers.openai.com` and `platform.openai.com` as `domains`).
- Independence: a page reached through two providers counts once; pages repeating one origin count once (`origin_root`).

## Shared vocabulary

- Page status: `verified` (the page states it), `mismatch` (page loads, claim absent or different), `blocked` (HTTP 401, 403, 429, 451), `unreachable` (error, 404, timeout), `unsourced` (no URL).
- Claim verdict: `supported`, `partial`, `unsupported`, `unverifiable`. A `blocked` or `unreachable` page never makes a claim `unsupported`.
- Record the provider and tool per claim (`provider:tool`, for example `octen:news_search`).

## Tool index (pi, confirmed 2026-11-11)

| server | search / research | readers and helpers |
|---|---|---|
| perplexity | `perplexity_search`, `perplexity_ask`, `perplexity_reason`, `perplexity_research` (hosted) | `perplexity_models` |
| keenable | `search_web_pages` | `fetch_page_content` |
| exa | `web_search_exa` (`objective` is required), `agent_run` (hosted) | `web_fetch_exa` |
| octen | `search`, `broad_search`, `news_search`, `business_search`, `pulse_search` (URL lookup), `place_search`, `image_search`, `video_search` | `extract` |
| youcom | `you_search` | `you_contents` |
| brave_search | `brave_web_search`, `brave_llm_context`, `brave_news_search`, `brave_place_search`, `brave_local_search`, `brave_image_search`, `brave_video_search` | — |
| parallel | `web_search`, `web_research` (hosted), `web_decisions` (on request), `find_verticals` + `search_vertical` (PubMed, ClinicalTrials.gov, ChEMBL, NPI…), `image_search` | `web_fetch` |
| firecrawl | `firecrawl_search`, `firecrawl_developer_search`, `firecrawl_gov_search`, `firecrawl_research_search_papers`, `firecrawl_research_related_papers`, `firecrawl_agent` (hosted) | `firecrawl_scrape`, `firecrawl_research_read_paper`, `firecrawl_research_inspect_paper`, `firecrawl_credit_usage` |
| nimble | `nimble_search` | `nimble_extract` |
| paper_search | `search_papers`, `search_semantic`, `search_openalex`, `search_arxiv`, `search_pubmed`, `search_crossref`, `search_europepmc`, `search_core`, `search_base`, `search_zenodo`, `search_hal`, `search_iacr`, `search_google_scholar` | `get_crossref_paper_by_doi`, `read_arxiv_paper`, `read_semantic_paper` |
| package_version_check | `get_latest_package_versions`, `get_latest_tool_versions`, `get_github_action_versions_and_args` | — |
| context7 | `resolve_library_id` | `query_docs` |
| fetch | — | `fetch` |

## Evidence for the order (accessed 2026-10-24)

- Artificial Analysis Search Index, same agent harness per provider (https://artificialanalysis.ai/agents/search-api), data of 2026-11-09 (read 2026-11-11): Keenable pro 83 and realtime 82 (BrowseComp 87/86, DeepSearchQA 88, 15.6 s per task); Exa auto 80 (BrowseComp 83, DeepSearchQA 86); Perplexity medium 80 (BrowseComp 87); Octen 77 (BrowseComp 86, fastest at 14.6 s per task, $9.07 per 1k queries); Parallel advanced 75; Brave LLM context 75; You.com 74. The 2026-10-19 page also listed Nimble 74 and Firecrawl 73. The row order above predates Keenable's entry and still puts it last: reordering is an owner decision.
- Openbenchmarks, measured 2026-10-21 (https://openbenchmarks.com/web-search): factual lookup Exa fast 99.3%, Perplexity 97.3%, Firecrawl 95.3%, Brave LLM context 94.0%; multi-hop search-only led by Parallel; developer tickets (https://openbenchmarks.com/web-search/best-search-tools-for-ai-agents) Perplexity 77.3%, Firecrawl 70.3%, Parallel 66.7%, Exa 66.3%, You.com 41.3%, Brave 38.0%.
- Contested, 2026-10-29 (no reorder): Vals Web Search Index, 2026-10-21 (https://www.vals.ai/benchmarks/web_search), tested only native search, Exa and Keenable (Keenable 49.08%, Exa 48.45% with Claude Fable 5). Keenable's own needle benchmark, 2026-10-29 (https://keenableai.github.io/needle/results/), scores returned snippets only and puts Octen at 50%, below Brave LLM context (64%) and You.com (55%); Artificial Analysis grades every provider with one GPT-5.6 Luna model (https://artificialanalysis.ai/methodology/search-api).
- Local errors, 30 days to 2026-10-24 (Claude Code telemetry): Brave 45 of 310 calls (429 plan limit), Firecrawl 165 of 1258 (credits, 429), Exa 4 of 305, Perplexity 7 of 360.
