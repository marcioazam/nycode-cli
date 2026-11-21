---
name: release
description: Prepare, publish, verify, and recover nycode releases. Use for release preparation, local release smoke tests, publishing, and a failed release workflow.
---

# Releasing nycode

Run repository commands from the repo root (two directories above this skill), unless instructed otherwise.

**Lockstep versioning**: all packages share one version; every release updates all together. `patch` = fixes + additions, `minor` = breaking changes. No major releases, with one exception: `2.0.0` (D-13) is the first release with the embedded harness and ships once, through `npm run release:major` from `1.x`, after a complete `release:local` run (step 2, no skipped checks or tests). After it, `major` is closed again.

The repository is the only channel: a GitHub Release of `marcioazam/nycode` with self-contained binaries, `SHA256SUMS` and a provenance attestation. Nothing is published to npm and no long-lived token exists.

1. **Update CHANGELOGs**: ask the user whether they ran the `/cl` prompt on the latest commit on `main`. If not, they must run `/cl` first to audit and update each package's `[Unreleased]` section before releasing.

2. **Local smoke test**: build an unpublished release and smoke test from outside the repo (so it can't resolve workspace files):

   ```bash
   npm run release:local -- --out /tmp/nycode-local-release --force
   cd /tmp

   # Node package install smoke tests
   /tmp/nycode-local-release/node/nycode --help
   /tmp/nycode-local-release/node/nycode --version
   /tmp/nycode-local-release/node/nycode --list-models
   /tmp/nycode-local-release/node/nycode -p "Say exactly: ok"
   /tmp/nycode-local-release/node/nycode

   # Bun binary smoke tests
   /tmp/nycode-local-release/bun/nycode --help
   /tmp/nycode-local-release/bun/nycode --version
   /tmp/nycode-local-release/bun/nycode --list-models
   /tmp/nycode-local-release/bun/nycode -p "Say exactly: ok"
   /tmp/nycode-local-release/bun/nycode
   ```

   Verify both Node and Bun startup, model/account listing, interactive startup, and at least one real prompt with the intended default provider. The bare commands `/tmp/nycode-local-release/node/nycode` and `/tmp/nycode-local-release/bun/nycode` start interactive mode; run each in tmux, submit a prompt, and wait for the model reply before considering the interactive smoke test passed. Failures are release blockers unless the user explicitly accepts the risk.

   Load and follow [interactive-testing.md](interactive-testing.md) for the tmux workflow. Start each release binary from `/tmp`, not the repo root.

3. **Prepare the release commit**: the ruleset of `main` requires a pull request, so the script never pushes and never tags. From an up-to-date `main`, create the branch and run the script:

   ```bash
   git switch -c release/vX.Y.Z origin/main
   NYCODE_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:patch    # fixes + additions
   NYCODE_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:minor    # breaking changes
   ```

   For `2.0.0` only: `npm run release:major` on the branch `release/v2.0.0`; the exception goes in the PR description.

   If the test suite already passed in `npm run release:local` and only fails from machine load, `NYCODE_RELEASE_SKIP_TESTS=1` skips `./test.sh` in the release script; checks and the packed install check still run. Use it only with the user's approval (never for `2.0.0`).

   Use `npm_config_min_release_age=0` only for the release command. The repo's normal npm age gate can otherwise block the release lockfile refresh when the current workspace package version was published recently. Review any lockfile or install lock diffs the release creates before opening the PR.

   The script bumps all package versions, updates changelogs, regenerates release artifacts, runs `npm run check`, the tests and the packed install check, and stops at the commit `Release vX.Y.Z` on the current branch. Do not rerun it for the same version: if it failed, reset the branch to `origin/main` and start over.

4. **Merge and tag**: open the PR from `release/vX.Y.Z`, wait for the required checks and squash-merge it. Create the tag on the commit the squash left on `main`, never on the branch commit:

   ```bash
   git fetch origin main
   git show origin/main:packages/coding-agent/package.json | jq -r .version    # must print X.Y.Z
   git tag -a vX.Y.Z <sha-on-main> -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

5. **CI builds and publishes the Release**: pushing the `vX.Y.Z` tag triggers `.github/workflows/publish.yml` (`workflow_dispatch` with the tag recovers a failed run). It builds the 6 binaries, `SHA256SUMS` and the source archive, smoke-tests the binaries on Linux, macOS and Windows, attests the artifacts and publishes the GitHub Release. Follow it with `gh run watch`. The only secret is the run's `GITHUB_TOKEN`.

6. **Verify and open the next cycle**: confirm the Release and its provenance (`gh` 2.49 or newer):

   ```bash
   gh release view vX.Y.Z -R marcioazam/nycode --json assets,isDraft,isPrerelease
   gh release download vX.Y.Z -R marcioazam/nycode -D /tmp/nycode-release
   (cd /tmp/nycode-release && sha256sum -c SHA256SUMS)
   gh attestation verify /tmp/nycode-release/nycode-linux-x64.tar.gz -R marcioazam/nycode
   ```

   Then add the fresh `## [Unreleased]` section after `# Changelog` in each package CHANGELOG, commit `Add [Unreleased] section for next cycle` and open it as a second PR, after the tag.

7. **If the workflow fails**: inspect the failed job and rerun it, or dispatch `publish.yml` again with the same tag; the draft Release is published only after every asset is uploaded. A published Release with a wrong asset is removed with `gh release delete vX.Y.Z --cleanup-tag -R marcioazam/nycode` and the fix ships as the next patch version. Never move or reuse a tag and never rerun the release script for the same version.
