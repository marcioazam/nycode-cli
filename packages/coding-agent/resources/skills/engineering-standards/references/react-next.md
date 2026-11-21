# React and Next.js

Respect the repository's React and Next.js versions and routing conventions. Prefer server components and server-side data access by default; introduce client components only for browser state, effects, or event handling. Keep auth and authorization on the server, validate every action or route input, and never use middleware/proxy as the only authorization boundary.

Preserve accessibility, loading, error, and empty states. Avoid unnecessary client-side fetching, prop drilling, and global state. Verify changed user flows with the repository's test, build, and browser tooling when available.

For reusable component APIs, prefer composition and explicit variants over accumulating boolean mode props. Lift shared state into a provider while keeping the state implementation behind a stable interface; apply React 19-only guidance only when the repository actually uses React 19.

When narrowing props, inspect every non-test, non-Storybook consumer, exports, wrappers, and indirect public boundary first. Required and nullable differ: retain `value: T | null` when absence is real instead of using `value?: T`. Remove optional callbacks or fallback branches only when live behavior proves they are impossible, then update support code and typecheck all consumers. Local absence alone does not authorize removing a public or library contract.

Adapted from HumanLayer `skills@3c2629142c5d437428269b1b722b08c0b87f574d` (`narrow-react-prop-types`), MIT; no upstream files copied.

For a demonstrated performance concern, investigate data waterfalls before micro-optimizing renders. Parallelize only independent, authorized I/O while preserving concurrency bounds, cancellation and failure semantics. Pass only necessary and authorized fields across Server/Client boundaries. Distinguish request-local deduplication from shared caching; verify framework-version semantics and user isolation before caching private data or authorization results.

These independently worded general recommendations were checked against Vercel `agent-skills@063bee94c3f4df8453406c830b0a7df0f2860278`, selected `react-best-practices` rules. Those SKILL metadata declare MIT, but no complete root LICENSE was found; no upstream text or examples are copied. [Research and license caveat]($CLAUDE_CONFIG_DIR/docs/third-party/frontend-research-20260920.md). (optional)

Current specifics: the version-matched docs bundled in `node_modules/next/dist/docs/` (when present) win over this file. In [Next.js 16](https://nextjs.org/docs/app/guides/upgrading/version-16) (read 2026-10-24) request interception is `proxy.ts`, which runs only on the Node runtime, so keep `middleware.ts` only where the edge runtime is required; `cookies`, `headers`, `draftMode`, `params` and `searchParams` are async-only; `next lint` is gone and `next build` no longer lints, so run the ESLint CLI or Biome separately; `next build` no longer reports route size or First Load JS, so measure bundles with `web-performance-audit`. Never enable `reactCompiler` or `cacheComponents` just to finish an upgrade.
