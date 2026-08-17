# Ferramentas de investigação (não são o gate)

O instrumento de record é `scripts/perf-gate.sh` (`hyperfine` + RSS + tamanho
do binário de release). O que segue é para achar *onde* o tempo ou a memória
vão, em máquina local. Não adicionar estas crates ao workspace sem ADR.

## Wall-clock do processo

- **hyperfine** — já usado pelo gate. Carga `--probe-startup` para a sessão
  montada; `--version` só para a chegada do processo.
- **Criterion.rs** — microbenchmark estatístico de uma função. Bom localmente
  (`--save-baseline` / comparação). Ruído alto em runner partilhado; não
  substitui o gate. `black_box` evita que o compilador elimine o trabalho.
  Documentação: https://bheisler.github.io/criterion.rs/book/

## Onde o tempo vai

- **samply** — sampling, Firefox Profiler. Compilar em release **com** debug
  info; o perfil `[profile.bench]` deste repo já faz isso. Frame pointers:
  `RUSTFLAGS="-C force-frame-pointers=yes"` se as stacks vierem partidas.
  https://github.com/mstange/samply
- **cargo flamegraph** — visão em largura = tempo. Mesmo requisito de debug
  info. https://nnethercote.github.io/perf-book/profiling.html

## Instruções e alocações (Linux / Valgrind)

- **iai-callgrind / Gungraun** — Callgrind, uma execução, estável em CI
  ruidoso para *micro*. Mede instruções, não wall-clock, e não vê syscall/IO.
  Por isso não fecha NFR-1 da sessão montada.
  https://gungraun.github.io/gungraun/latest/html/index.html
- **DHAT** — sítios de alocação e pico de heap. Útil quando o RSS do gate
  sobe e o CPU flamegraph não explica.

## Tamanho do binário

- **cargo-bloat** — quem ocupa o artefato de release (NFR-3). O perfil
  release já usa LTO fat, uma codegen-unit, `panic = abort` e `strip`.
  Mexer nisso para "passar" o gate é violar a regra, não otimizar.
