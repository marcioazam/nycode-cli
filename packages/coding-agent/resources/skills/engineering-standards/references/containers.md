# Containers

- Use a small, maintained base pinned as the repository requires; build in stages when that reduces the shipped artifact.
- Run as a non-root user with the minimum runtime filesystem and capabilities. Do not bake credentials, development tools, package caches, or writable application source into the final image.
- Keep `.dockerignore` intentional, expose only required ports, and use a health check when the service contract needs one.
- Build and test the image or compose configuration when practical; scan the shipped artifact according to the project's security gates.

Current specifics: set a numeric non-root `USER`. Pass build secrets only through `RUN --mount=type=secret`, never `ARG` or `ENV`, because provenance records build args. With `docker/build-push-action` set `provenance: mode=max` and `sbom: true`; `load: true` and the `docker` exporter drop attestations, so attest in the job that pushes ([Docker attestations](https://docs.docker.com/build/ci/github-actions/attestations/), read 2026-10-24). Check with `docker build --check`, `hadolint` where configured and `docker compose config -q`. Compose services gate `depends_on` on `condition: service_healthy` and take credentials through `secrets:`, not environment values.
