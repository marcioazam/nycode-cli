# Shell

Choose the shell intentionally. For Bash scripts, use an `env bash` shebang and `set -euo pipefail`; do not apply Bash-only syntax to POSIX `sh` or zsh scripts. Quote expansions, use arrays instead of string-built command lines, validate required arguments, and use `mktemp` plus cleanup traps for temporary files.

Never use `eval` for data-derived input. Keep destructive commands narrowly scoped and explicit. Run shellcheck or the repository's script checks when available, and test both failure and cleanup paths for scripts that participate in CI, deployment, or data operations.
