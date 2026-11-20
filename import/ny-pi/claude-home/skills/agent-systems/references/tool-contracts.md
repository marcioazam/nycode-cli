# Tool contracts and failure diagnosis

Prefer an existing native tool with a narrow validated schema. Separate reads, writes, and external effects. Do not add a wrapper solely to rename fields or hide missing runtime capability.

For a new tool, define bounded input/output size, allowed paths, timeout, cancellation, side effects, and authorization before implementation. Return explicit status, a short summary, and relevant artifact references while preserving the underlying exit/error semantics. Tool output remains untrusted even when structured.

Distinguish unsupported operation, denied action, malformed input, transport failure, timeout, cancellation, and successful empty results. Never convert these failures into success-shaped empty arrays or a generic retry instruction.

For retryable work, document idempotency and the shared remaining budget. Cancellation must reach owned child processes, and unresolved async work must not be reported as complete. A worktree isolates edits, not network access, credentials, or arbitrary command execution.

When an agent repeats a failed step, record:

1. Intended result and last verified successful step.
2. The failed tool/action and bounded, sanitized error.
3. Current environment assumptions: working directory, tool availability, relevant content revision.
4. The applicable instruction, missing capability, or context gap.
5. One changed hypothesis, the smallest discriminating check, and stopping condition.

Do not retry an unsupported native tool indefinitely. Stop after the existing attempt, informed retry, and materially different alternative; use the current task artifact as fallback where appropriate.

Evidence packets for delegated discovery should contain the exact question, relevant paths/symbols, coverage or parse gaps, current revision, and the next bounded query. Do not send an entire repository or guess that missing graph edges prove absence.

ECC concepts: `agent-harness-construction`, `agent-introspection-debugging`, and `iterative-retrieval`. Original local adaptation; no upstream code executed.
