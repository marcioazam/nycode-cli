# Composable CLI contracts

Use for a durable command-line interface, not every one-off script. Preserve the project's runtime, parser, packaging and command conventions; check for an existing command before choosing an install name.

Design commands around actual jobs: discover collections, resolve a name to a stable identifier, read an object, and perform a specific requested write. Keep writes visible in command names and support preview or dry-run when the underlying service can do so honestly. A generic request command may complement useful verbs; it must not bypass authorization or hide side effects.

Define exit statuses, stdout/stderr, JSON success and error shapes, and pagination defaults as public contracts. Machine-readable mode must emit valid JSON without progress chatter; send diagnostics to stderr and exclude credentials from both streams. Bound page sizes, automatic pagination, retries, output and polling. Preserve underlying failures through pipes and wrappers rather than returning success after formatting an error.

Use the service's existing authentication mechanism without printing secrets or putting them in command examples. A doctor command should distinguish local configuration, fixture mode, connectivity and verified authentication; an offline result cannot certify a live endpoint. CLI implementation does not authorize secret-store inspection, installation into PATH, or external writes.

Verify help and invalid arguments, exit status and JSON errors, request construction, pagination limits and secret redaction with fixtures where possible. For a requested installable tool, also check invocation from outside its source directory so assets and configuration do not accidentally depend on cwd. Test the actual packaging path when authorized; otherwise report the unverified installation boundary.

Adapted 2026-09-20 from OpenAI [cli-creator](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/cli-creator/SKILL.md), [Apache-2.0](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/cli-creator/LICENSE.txt). Modified for project-selected runtimes, local authorization and bounded execution; no upstream code copied.
