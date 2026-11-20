## What changes and why

<!-- One or two sentences. Link the issue: Closes #123 -->

## Evidence

- [ ] Bug fix: a test that fails before the fix (red) and passes after (green); paste both results
- [ ] `npm run check` result (code changes): <!-- rc and last line -->
- [ ] `./test.sh` result, or the specific test files run: <!-- rc and last line -->
- [ ] Checks not run or only verified in CI: <!-- list, or "none" -->

## Effect on the benchmark

<!-- Does it change the always-loaded prompt, turns or cost per task? The `bench-pr` gate runs on this PR; say what you expect, or "none". -->

## How to revert

<!-- e.g. delete the extension directory, or revert this commit. State anything that is not reversible. -->

## Checklist

- [ ] Docs updated where behavior, configuration or a contract changed
- [ ] No secrets, credentials, personal identifiers or absolute home paths in the diff (gitleaks runs in the pre-commit hook and in CI)
- [ ] Workflow changes: actions pinned to full SHAs, minimal `permissions:`
- [ ] Breaking change marked with `!` in the title and described above
