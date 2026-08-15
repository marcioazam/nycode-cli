# syntax=docker/dockerfile:1
#
# Canal de distribuicao adicional, nao o principal -- o binario auto-contido
# por release.yml continua sendo a instalacao padrao (ver README.md). Esta
# imagem ainda nao e publicada em nenhum registry; o job `docker` do CI so
# builda e testa, nunca faz push (publicar exige pedido explicito, mesma
# regra ja aplicada ao resto deste repositorio).
#
# Duas escolhas vem direto do que o proprio codigo deste repositorio exige,
# nao de preferencia generica:
#   - release.yml:27 compila para x86_64-unknown-linux-gnu (glibc dinamico),
#     entao a imagem final NAO pode ser `scratch`/`distroless/static`, que
#     nao tem libc nenhuma.
#   - crates/nycode-ai/Cargo.toml usa reqwest com a feature `rustls`, que
#     desde a 0.13 le o trust store do sistema operacional em runtime
#     (rustls-platform-verifier) em vez de embutir um conjunto de raizes --
#     `scratch` tambem nao tem trust store nenhum. `distroless/cc-debian12`
#     e' a variante com glibc E ca-certificates ao mesmo tempo.

FROM rust:1.96-slim-bookworm@sha256:e18a79fc84dfcfc3ab5ba72290398a644c135c97eaa881447fddc354ee4701a3 AS builder
WORKDIR /build

# cargo-auditable embute a arvore de dependencias resolvida (Cargo.lock) num
# trecho do proprio binario, sem custo de runtime -- consumivel por
# `cargo audit`, Trivy, Grype e osv-scanner mesmo fora do Docker, e e' o que
# o BuildKit usa pra montar o SBOM quando --sbom=true e' passado no build.
RUN cargo install cargo-auditable --locked

COPY Cargo.toml Cargo.lock ./
COPY crates crates

RUN cargo auditable build --release --locked --bin nycode

FROM gcr.io/distroless/cc-debian12@sha256:adcd20c7b4c988b73cbfbddb26d2eee574571e6d7c9ffea29b3821e0690efb77

COPY --from=builder /build/target/release/nycode /usr/local/bin/nycode
COPY LICENSE NOTICE /

# UID numerico, nao a string "nonroot": um checador downstream de
# runAsNonRoot verifica sem precisar resolver /etc/passwd. A tag :nonroot da
# imagem base ja usa este UID por padrao -- declarado aqui mesmo assim, pra
# nao depender de configuracao implicita herdada num arquivo que rege
# postura de seguranca.
USER 65532:65532

ENTRYPOINT ["/usr/local/bin/nycode"]
