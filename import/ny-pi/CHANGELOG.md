# Changelog

All notable changes to this project are documented here, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. There are no tagged releases yet; everything below
is on `main`.

## [Unreleased]

### Added

- Benchmark: arms (ny-pi, plain pi, Claude Code), gate statistics, S1–S7 orchestrator, audited suites,
  Terminal-Bench 4.1, per-run evidence, a parallel runner, failure signatures and a contract checker.
- Benchmark gate: a three-rule scoreboard, a precise gate rule, run records, a status poller and a gate summary posted
  as a PR comment.
- Frozen baselines: `baseline-main` (recorded with the baseline tier) and the vanilla baseline of 2026-11.
- CI: `ci-static`, `ci-security`, `instruction-budget` and `bench-pr` as required checks; local CI with a 15 minute cap
  (`bash scripts/ci/local.sh`) and a status fallback when the remote CI cannot run.
- `todo-sync`: a reminder when the task list stays idle with an open item.
- README for users, with benchmark results and the gates.
- Community files: security policy, code of conduct, support guide, issue and discussion forms, pull request
  template, code owners, release-note categories, and scheduled Scorecard and CodeQL scans.

### Changed

- The benchmark gate fails on turns (model round trips) above 1.10x instead of wall-clock time, which is now
  published for information only.
- Headless runs act without asking permission and check the result against the request.
- The benchmark runs the vanilla tier at PR scale, resumes honoring the S1 repetitions and never reuses an existing
  Harbor job.
- The project was renamed from `pi-harness` to `ny-pi` (the benchmark arm from `my-pi` to `ny-pi`); runtime
  identifiers keep the old name.

### Fixed

- Headless runs no longer stall on `plan_mode_complete` or `question`, and the working directory is out of the cached
  system block.
- Benchmark: infra-run detection, stop rules, `--resume`, disk preflight, OAuth preflight, zero-cost steps marked as
  infra, the poller skipping closed PRs, and the ny-pi Harbor bundle using the checked-out stage.
- Gate: eight verdict corrections and stage under the service.

### Removed

- The `bash-clamp` shell-output clamp: shell output now uses pi's own cut (2000 lines or 50 KB, keeping the end and the
  full log in a file), which measured cheaper on the harder multi-file suite.
