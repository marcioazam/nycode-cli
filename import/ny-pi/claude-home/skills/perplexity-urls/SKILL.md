---
name: perplexity-urls
description: "Web search through the Perplexity MCP with exact, verified source URLs, paired with an independent provider. Use for any web search or perplexity_* call (Perplexity is the first provider)."
---

# Perplexity with exact URLs

The `perplexity` MCP returns `{answer, sources, filtered_out, thread_id, thread_url, model}`: each source has `index`, `url`, `title`, `snippet` (page text, empty when Perplexity sent none) and `date`, and a `[n]` marker in `answer` cites the source with `index` n (fork `~/source/perplexity-mcp`, 2026-10-14). Failures arrive as tool errors that name the cause (expired session, HTTP 429, stalled stream, timeout). The output contract below adds the URL and the supporting quote next to each sentence; verification makes them evidence.

1. **Tool.** The `perplexity` server is deferred in pi: call `tool_search` (e.g. "perplexity search reason research") once per session before the first call; the tools are then `mcp__perplexity__perplexity_search`, `_reason`, `_research`, `_ask` and `_models`. If `tool_search` finds nothing, the server is down (`pi mcp list`, `systemctl --user status mcp-perplexity`): treat it as a Perplexity failure (step 5). `perplexity_search` for current facts (default); `perplexity_reason` for multi-step analysis; `perplexity_research` only for broad synthesis (30-120 s); `perplexity_ask` for a quick lookup. `model` is optional; `perplexity_models` lists the IDs your plan allows. Options: `recency` (`day`/`week`/`month`/`year`), `domains` (`['site.org', '-exclude.com']`), `sources=['scholar']` for papers, `follow_up=<thread_id>` to continue a thread; `perplexity_search` adds `max_results` and `search_type='fast'`. Calls are incognito unless `incognito=false`. One focused question per call; send independent calls in parallel.
2. **Query.** Send only task-relevant public information (Perplexity is a third-party service). Append this block verbatim after the question:

   ```text
   Output contract (mandatory):
   1. Never write bracketed or superscript citation markers ([1], [2], ¹), not even after a URL.
   2. After each factual sentence write the exact full source URL in angle brackets, e.g. <https://example.org/docs/page>, copied verbatim from the page you read: the deepest page that supports the sentence, no shortener, no search-result or homepage URL.
   3. End with a section titled SOURCES: one line per URL as `URL | page title | verbatim sentence from that page that supports the claim`.
   4. If a claim has no exact URL, write UNSOURCED after it. Never invent or reconstruct a URL.
   ```

3. **Parse.** List every claim with its URL and quoted sentence. Resolve each `[n]` marker to `sources[index == n].url`, then delete the marker: Perplexity appends them even under rule 1. A claim without a URL is `unsourced`.
4. **Verify every URL.** Open it with a page reader (the Readers of providers.md in their order; load each MCP reader with `tool_search` first) and look for the quoted sentence or the claim. Status: `verified` (the page states it), `mismatch` (page loads, claim absent or different), `blocked` (401, 403, 429, 451, paywall), `unreachable` (error, 404, timeout). This step is done when every URL has a status.
5. **Report.** One row per claim: `claim | URL | quote | status | provider`. Use only `verified` rows as evidence and list the others as gaps. Perplexity counts as one provider: run every web search with at least one independent provider in parallel, taken from the task's row (fact, multi-hop, dev, news, papers, org, law) of `$CLAUDE_CONFIG_DIR/skills/deep-search/references/providers.md`, which also lists the readers, the fallback order and the status vocabulary (`blocked` for HTTP 401/403/429/451). If Perplexity fails (login, rate limit, empty answer), use two providers from that row and say so.

Never read or print the Perplexity cookies or the keyring entry; test only through the MCP tools. To audit or upgrade the server, ask the user to type `/skill:perplexity-mcp-sota`: it is user-invoked only (hidden from the model), and its workflow is not replicated by hand. (optional)
