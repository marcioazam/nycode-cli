# Security policy

## Supported versions

ny-pi has no tagged releases yet. Only the `main` branch receives security fixes.

## Reporting a vulnerability

Do not report a vulnerability through a public issue, discussion or pull request.

1. Open the repository's **Security** tab and select **Report a vulnerability**
   ([direct link](../../security/advisories/new); how it works:
   <https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability>).
   Private vulnerability reporting is enabled; the report stays between you and the maintainer.
2. Include what you can: the commit, reproduction steps or a proof of concept, the impact, and whether you know of
   active exploitation. An early partial report is better than a late complete one.

## What to expect

ny-pi is maintained by one person, so these are targets, not guarantees.

| Step | Target |
| --- | --- |
| Acknowledgement | Within 7 days |
| Initial assessment and severity | Within 14 days |
| Fix or mitigation on `main` | As soon as practical, by severity; you are told if it will take longer |
| Disclosure | Coordinated with you, after a fix is on `main`; a GitHub Security Advisory credits you unless you prefer to stay anonymous |

## Scope

In scope:

- The guard hook (`claude-home/hooks/guard.py`): a way to run a command or read a file that its always-deny list is
  meant to block.
- The `bin/pi` wrapper: permission bypass turning on without the documented opt-in, or `local.env` accepting keys it
  should reject.
- The installer (`install.sh`, `scripts/install-lib.sh`): any way to install an unverified third-party component, or
  to write under `~/.pi` after a failed hash, license or patch check (it must fail closed).
- The extensions under `extensions/` and the shipped agents, skills and rules in `claude-home/`.
- The CI workflows under `.github/workflows/`: injection, excessive permissions, unpinned actions, secret exposure.

Not a vulnerability:

- Anything that needs bypass mode you turned on yourself (`PI_BYPASS_PERMISSIONS=1` or `pi --bypass`): the "ask"
  list is auto-approved there by design; the always-deny list still applies.
- Flaws in pi, pi-code, a model provider or another third party: report them to their owners. A flaw in how ny-pi
  pins or patches them is in scope.
- Commands a user runs by hand, or content the model produces, outside what the guard claims to block.
- Findings that need an already compromised machine or account, denial of service, and scanner output with no
  demonstrated impact.

## Threat model

- Permission bypass is off by default; the wrapper starts with it off.
- The guard hook has an always-deny list (for example forced recursive deletion, writes to disk devices, piping a
  download into a shell, force-push to `main`, reading credential files) that holds even under bypass. `bash` can
  still read what the `read` tool cannot, so the guard is a safety net, not a sandbox.
- Secrets never belong in the repository: gitleaks, trufflehog and a local identifier check run before commit and in CI.
- The installer verifies pinned commit and tarball hashes, license hashes and patches before touching `~/.pi`.
- GitHub Actions are pinned by full commit SHA with minimal permissions.
