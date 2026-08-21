# syntax=docker/dockerfile:1
#
# Canal de distribuicao adicional, nao o principal -- o binario auto-contido
# por release.yml continua sendo a instalacao padrao (ver README.md). Esta
# imagem ainda nao e publicada em nenhum registry; o job `docker` do CI so
# builda e testa, nunca faz push (publicar exige pedido explicito, mesma
# regra ja aplicada ao resto deste repositorio).
#
# A imagem final e montada a partir de `scratch`, copiando somente as bibliotecas
# que o binario dinamico e a verificacao TLS realmente usam. Isso evita carregar
# o `libssl` da imagem Debian, que o Trivy sinaliza enquanto o CVE nao tem versao
# corrigida publicada. As escolhas abaixo vem direto do codigo deste repositorio:
#   - release.yml:27 compila para x86_64-unknown-linux-gnu (glibc dinamico),
#     entao a imagem precisa carregar glibc, o loader e as bibliotecas NSS.
#   - crates/nycode-ai/Cargo.toml usa reqwest com a feature `rustls`, que
#     desde a 0.13 le o trust store do sistema operacional em runtime
#     (rustls-platform-verifier) em vez de embutir um conjunto de raizes --
#     o trust store e copiado da imagem base junto com as bibliotecas de DNS.

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

FROM gcr.io/distroless/base-debian13@sha256:f4a335ca209e1d2ee873102c17c389ad0142e3d5b21aee2817e9cc9c01d87d20 AS runtime

FROM scratch

COPY --from=runtime /usr/lib/x86_64-linux-gnu/libc.so.6 /usr/lib/x86_64-linux-gnu/
COPY --from=runtime /usr/lib/x86_64-linux-gnu/libm.so.6 /usr/lib/x86_64-linux-gnu/
COPY --from=runtime /usr/lib/x86_64-linux-gnu/libnss_dns.so.2 /usr/lib/x86_64-linux-gnu/
COPY --from=runtime /usr/lib/x86_64-linux-gnu/libnss_files.so.2 /usr/lib/x86_64-linux-gnu/
COPY --from=runtime /usr/lib/x86_64-linux-gnu/libresolv.so.2 /usr/lib/x86_64-linux-gnu/
COPY --from=runtime /usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2 /lib64/
COPY --from=builder /usr/lib/x86_64-linux-gnu/libgcc_s.so.1 /usr/lib/x86_64-linux-gnu/
COPY --from=runtime /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

COPY --from=builder /build/target/release/nycode /usr/local/bin/nycode
COPY LICENSE NOTICE /

# UID numerico, nao a string "nonroot": um checador downstream de
# runAsNonRoot verifica sem precisar resolver /etc/passwd. A tag :nonroot da
# imagem base ja usa este UID por padrao -- declarado aqui mesmo assim, pra
# nao depender de configuracao implicita herdada num arquivo que rege
# postura de seguranca.
USER 65532:65532

ENTRYPOINT ["/usr/local/bin/nycode"]
