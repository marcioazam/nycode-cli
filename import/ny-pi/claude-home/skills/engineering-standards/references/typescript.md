# TypeScript

Honor the repository's TypeScript version, package manager, lockfile, and `tsconfig`. Keep strictness enabled where the project supports it; avoid `any`, unsafe assertions, and unvalidated casts at public or external boundaries.

Model states with narrow types and discriminated unions, handle errors deliberately, and keep runtime validation separate from compile-time types. If adopting TypeScript 7, first verify compatibility of tools that depend on the compiler API; otherwise preserve the declared compatible toolchain. Run the repository's type check, lint, and tests for changed behavior.

Current specifics: [TypeScript 7](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) (read 2026-10-24) has no compiler API until 7.1, so Astro, MDX, Vue and Svelte projects stay on 6.0 and API consumers such as typescript-eslint use the `@typescript/typescript6` alias. It removes `baseUrl` and `moduleResolution: node`, defaults `types` to `[]` and turns `strict` on by default: review `tsconfig` and rerun type checks after any bump. [Astro 7](https://docs.astro.build/en/guides/upgrade-to/v7/) errors on unclosed tags, no longer auto-corrects invalid HTML and defaults `compressHTML` to `'jsx'`; [astro@7.4.2](https://github.com/withastro/astro/releases/tag/astro%407.4.2) requires Node.js >= 22.23.4.
