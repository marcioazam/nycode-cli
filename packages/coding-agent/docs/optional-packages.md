# Optional Packages

Four third-party packages extend nycode without being bundled with it: `ponytail`, `ralph-loop`, `pr-review-toolkit` and `claude-red`. Each installs from its source repository at a fixed commit, so a clone never moves without a change here. Nothing in this page is needed for nycode to run. The embedded commands `/ralph-loop`, `/cancel-ralph`, `/ralph-help` and `/review-pr`, and the `offensive-*` references of the `security-audit` skill, use these packages when present.

Installing a package runs no code, but packages can ship extensions and skills that instruct the model to run programs: read the source before you install. See [Nycode Packages](packages.md) for how `nycode install` works.

## Install

```bash
nycode install git:github.com/marcioazam/ponytail@a75382edeb22ec2917cdfa487c6202d8b6f26c99
nycode install git:github.com/marcioazam/ralph-loop@9e7f895c7a806e4648b172d18b2d3bd8d39101df
nycode install git:github.com/anthropics/claude-plugins-official@893173fb82a7184fcf3f08ae55930016d84fd588
nycode install git:github.com/SnailSploit/Claude-Red@a8de813edc9f66f60d44cfe42d47750e89d9930b
```

Each clone lands in `~/.nycode/agent/git/github.com/<owner>/<repo>` and the declaration is written to `packages` in `~/.nycode/agent/settings.json`. The installer loads only extensions, skills, prompt templates and themes, and registers no hooks, so the steps under each package below are manual.

| Package | Source | Pinned commit | License | What it adds |
| --- | --- | --- | --- | --- |
| ponytail | `marcioazam/ponytail`, fork of `DietrichGebert/ponytail` v4.10.3 (`ef8ca48`), branch `nycode` | `a75382e` | MIT | Extension and 6 skills (`ponytail`, `-audit`, `-debt`, `-gain`, `-help`, `-review`) |
| ralph-loop | `marcioazam/ralph-loop`, fork of `anthropics/claude-plugins-official` `893173f`, `plugins/ralph-loop` with history | `9e7f895` | Apache-2.0 | `Stop` hook and `scripts/start-ralph-loop.sh` for `/ralph-loop` |
| pr-review-toolkit | `anthropics/claude-plugins-official`, directory `plugins/pr-review-toolkit` | `893173f` | Apache-2.0 | 6 reviewer prompts for `/review-pr` |
| claude-red | `SnailSploit/Claude-Red` (Copyright (c) 2024-2025 SnailSploit / Kai Aizen) | `a8de813` | MIT | 79 offensive-security skills |

The forks differ from their upstreams as follows: ponytail carries the subagent matcher fix, recognizes nycode child processes through `NYCODE_SUBAGENT` and declares its extension and skills under a `nycode` key in `package.json`; ralph-loop passes the command arguments through a quoted heredoc, so `<promise>X</promise>` in a prompt is no longer shell syntax (upstream issue [anthropics/claude-plugins-official#748](https://github.com/anthropics/claude-plugins-official/issues/748)). The authors' licenses and notices stay in each repository and in `NOTICE`.

## ponytail

The extension and skills load after the install. To scope the subagent instruction to some subagents, set a regular expression (unanchored, case-insensitive, matched against the subagent name) in `env`, which nycode exports to every process:

```json
{
  "env": { "PONYTAIL_SUBAGENT_MATCHER": "general|plan" }
}
```

## ralph-loop

`/ralph-loop` and `/cancel-ralph` work after the install, but the loop only continues with its `Stop` hook. `/ralph-loop` writes the loop state; the hook returns the same prompt on each stop until the completion promise or the iteration limit. The hook needs `bash` and `jq`.

Add it to `hooks.Stop` in `~/.nycode/agent/settings.json`. An entry for an event replaces the default list of that event, and the default `Stop` list holds the embedded impeccable gate, so keep that entry next to the loop:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "bash \"$HOME/.nycode/agent/git/github.com/marcioazam/ralph-loop/hooks/stop-hook.sh\"" }
        ]
      },
      {
        "hooks": [
          { "type": "command", "command": "sh \"${NYCODE_RESOURCES}/hooks/impeccable_gate.sh\" hook", "timeout": 30 }
        ]
      }
    ]
  }
}
```

`/hooks` lists both entries after a restart. See [Settings](settings.md#embedded-hooks-and-status-line) for how hook lists merge.

## pr-review-toolkit

The repository installs whole (the installer takes no subdirectory) and exposes no resource itself. `/review-pr` reads the reviewer prompts from `~/.nycode/agent/git/github.com/anthropics/claude-plugins-official/plugins/pr-review-toolkit/agents/`: `code-reviewer.md`, `code-simplifier.md`, `comment-analyzer.md`, `pr-test-analyzer.md`, `silent-failure-hunter.md` and `type-design-analyzer.md`. They are not registered as agents.

## claude-red

The skills sit in a `Skills` directory with a capital letter, which the installer does not discover. Add it to `skills` in `~/.nycode/agent/settings.json`:

```json
{
  "skills": ["~/.nycode/agent/git/github.com/SnailSploit/Claude-Red/Skills"]
}
```

This loads 79 skills. They are offensive-security material; the `security-audit` skill stays defensive and does not use them.

## Remove

`nycode remove git:github.com/marcioazam/ralph-loop@9e7f895c7a806e4648b172d18b2d3bd8d39101df` removes the clone and the declaration. Delete the `hooks.Stop`, `skills` and `env` entries above by hand.
