# Facet: container

## Targets seen 2026-10-30 (re-resolve)
- CIS Docker Benchmark 1.9.0 (cisecurity.org/benchmark/docker).
- Base image: the official image of the runtime's stable target (see runtime-deps), minimal variant (`-slim`,
  distroless or another hardened minimal image), pinned by digest
  (`docker buildx imagetools inspect <image>:<tag>`).

## Checks
- `FROM` tag equals the runtime target. Pinned by `@sha256:` digest; never `latest`.
- Multi-stage build: build tools and dev dependencies stay out of the final stage.
- Lockfile install (`npm ci --omit=dev`, `uv sync --locked --no-dev`); `COPY` of manifests before sources for
  caching.
- A non-root `USER` in the final stage. Never an explicit `USER root` at the end. No `--privileged`, no
  added capabilities, read-only root filesystem where the runtime allows it.
- No secrets in `ENV`, `ARG` or layers (use build secrets). A `.dockerignore` excludes `.git`, `.env` and
  `node_modules`.
- Exec-form `CMD`/`ENTRYPOINT` for signal handling. `HEALTHCHECK` or a probe when an orchestrator or restart
  policy acts on it; with neither in the repository, a missing health check is a note.

## Tools
`hadolint Dockerfile`; `trivy image` or `grype` for image CVEs; `docker scout` when available.

## Severity
- High: root final user; secrets in layers; `latest` or unpinned base in production; base image on an
  end-of-life runtime.
- Medium: no digest pin; single-stage image with build tooling; missing `.dockerignore`.

Depth: `containerization`.
