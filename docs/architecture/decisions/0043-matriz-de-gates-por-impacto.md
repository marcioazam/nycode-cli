# ADR-0043: Matriz de gates por impacto

- **Status:** aceito
- **Data:** 2026-08-22

## Decisão

PRs executam gates completos apenas quando o diff toca seu escopo. Todo check
obrigatório continua presente como sentinela explícita; se o classificador de
mudanças falhar, o job falha. `push` em `main` e `merge_group` executam todos
os gates aplicáveis ao evento; gates que exigem a base de um PR, como mutation
e cobertura de diff, não são executados em `push`.

| Escopo | Gates completos |
|---|---|
| Rust ou Cargo | test, default-build, mutation, coverage, perf e parity |
| Cargo.toml, crates/*/Cargo.toml, Cargo.lock ou deny.toml | supply-chain e dependency-age |
| crates, Cargo, scripts, hooks ou workflows | layout |
| Dockerfile, imagem, crates ou artefato | docker |

Documentação pura recebe as sentinelas e os controles de workflow, segredos e
tamanho de PR. A proteção de `main` mantém os mesmos nomes de checks.
