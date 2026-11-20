# Ledger and verification

## Ledger row

```json
{"id": "C1", "item": "P2", "claim": "...", "url": "https://...", "quote": "exact sentence from the page",
 "provider": "perplexity|exa|octen|parallel|youcom|brave|firecrawl|nimble|keenable|paper_search|context7|package_version_check|gh|... (tool after a colon, e.g. octen:news_search)",
 "source_type": "official|academic|industry|press|community", "published": "YYYY-MM-DD or null",
 "origin_root": "original publisher", "caveat": "vendor|self-reported|speculative|preprint|outdated|null",
 "script_status": "verified|mismatch|blocked|unreachable|unsupported_type|invalid|unverified",
 "fetched_at": "UTC time the page was read", "sha256": "hash of the normalized page text", "via": "proxy reader or null",
 "ttl_class": "volatile|docs|archival",
 "verdict": "supported|partial|unsupported|unverifiable", "note": "verifier evidence"}
```

`quote_check.py` input is the `{id, url, quote}` subset; it prints `{id, status, reason}` plus `fetched_at` and `sha256` when the page was read, and `via` when a mismatch or blocked page was verified on its reread through the keyless `r.jina.ai` reader (`--no-proxy` skips that reread). `ttl_class` feeds `claim_store.py`: volatile for versions, prices, news and benchmarks (14 days), archival for papers and dated law (365), docs otherwise (90).

## Script status

- `verified`: the quote (after Unicode, quote-mark, dash, space and case folding; `...` splits ordered fragments) is on the page.
- `mismatch`: the page loaded, the quote is not there. Usually a paraphrase or the wrong page; the verifier rereads it.
- `blocked`: HTTP 401, 403, 429 or 451. Says nothing about the claim.
- `unreachable`: network error, timeout, 4xx/5xx, redirect loop or oversized page.
- `unsupported_type`: PDF or other non-text page; read it with a page reader.
- `invalid`: missing fields, quote under 20 characters, non-http URL or a non-public host (refused before any request).
- `unverified`: the script could not run or reach the network.

## Verdict (claim-verifier)

- `supported`: the quoted passage, read on the page, states the claim, including its numbers, dates and qualifiers.
- `partial`: the source supports part of it, or a weaker version (lost qualifier, rounded number, different scope or date). Entailment metrics miss partial support, so borderline cases are `partial`.
- `unsupported`: the page is readable and contradicts or does not contain the claim.
- `unverifiable`: the page could not be read by any available reader. Never turn `blocked` or `unreachable` into `unsupported`.

## Confidence per finding

- high: at least two `supported` claims from different `origin_root`, at least one primary, no open conflict.
- medium: one primary `supported` claim, or two secondary ones; any `vendor`, `self-reported` or `preprint` caveat caps a finding here.
- low: a single secondary source, `partial` support or an `outdated` caveat.
- contested: `supported` claims disagree; show both and say which is newer and which is primary.
- `speculative` statements (forecasts, "could", "may") are reported as expectations, never as facts.

## Source vetting

For an unfamiliar source apply SIFT: stop, investigate the publisher through other sites (lateral reading), find better coverage, trace the claim to its original. Prefer standards, official docs, filings, peer-reviewed work and the original report over aggregators, SEO content farms and AI summaries. Wikipedia's Perennial sources list (https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources) is a claim-dependent prior for a publisher's reliability, never an allowlist or blocklist: a source missing from it is not more or less reliable. Copies of one press release are one source. Search snippets never count as reading the page.

## Conflicts

Keep conflicting claims side by side. For facts that change, prefer the most recent primary source and state the date; for contested findings, give the strongest version of each side.
