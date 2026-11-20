# bench/tasks: S2 (Terminal-Bench 2.0) and S3 (SWE-bench Pro) task lists

Generated 2026-11-13 with Harbor 0.25.0 (`uvx --from harbor==0.25.0 harbor`), seed 20261113. No LLM spend:
every task was validated with the `oracle` agent (reference solution), 4 concurrent.

## Files

- `tb2.json`: `{dataset, version, tasks, heldout}`; `terminal-bench@2.0`, all 89 tasks sorted; `heldout` = `random.Random(20261113).sample(sorted(tasks), round(0.3*n))` (27).
- `swebenchpro.json`: same shape; dataset `swebenchpro` (731 tasks, `latest`); `tasks` = `sorted(random.Random(20261113).sample(sorted(all731), 20))`; `heldout` = 6 sampled the same way from those 20.
- `*.excluded.json`: `{task: reason}`. Excluded = oracle reward != 1, or known provider refusal (TB2).

## How

```bash
harbor datasets download terminal-bench@2.0 -o /tmp/ds/tb2   # and swebenchpro -> names = directory listing
harbor run -d terminal-bench@2.0 -a oracle -n 4 -y -q -o ~/.local/state/harbor-jobs/oracle-tb2 --job-name bN -i <task> ...   # 6 batches of 15
harbor run -d swebenchpro        -a oracle -n 4 -y -q -o ~/.local/state/harbor-jobs/oracle-swepro --job-name bN -i <task> ...  # 4 batches of 5
```

Disk was checked before each batch (>= 40 GB free); only the Harbor task images (`alexgshaw/<task>:20251031`) were removed between batches.

## Counts

| suite | listed | oracle reward 1 | excluded | kept (listed - excluded) |
|---|---|---|---|---|
| S2 TB2 | 89 | 79 (10 failed) | 12 (10 oracle failures + 2 provider refusals) | 77 |
| S3 SWE-Pro | 20 | 19 | 1 | 19 |

The excluded tasks stay in `tasks`/`heldout`; consumers subtract `*.excluded.json`.

## Notes

- `bench/suites.toml` points to `tasks/terminal-bench*.json` and expects `tasks_file` to be a plain list with the split by `sha256(seed:task)`; these files use other names, a dict and a seeded `random` heldout. Align one side before `bench run`.
- Oracle failures are environment/verifier issues (missing curl/uvx in qemu-*, 1200 s timeout in caffe-cifar-10, etc.), not agent capability.
- SWE-Pro network lock (D13) is not expressible via `harbor run` flags (see suites.toml).
