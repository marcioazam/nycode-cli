# Research Summary: performance competitiva de harness

**Data:** 2026-08-13 | **Passes:** 4 | **Confiança:** 96%

Pesquisa RECON para decidir contra quem o NyCode CLI mede performance, com que
método e com que margem. Conduzida com Tavily e Exa como co-primários (Pass 1 e
2), cross-validation contra os documentos do próprio repositório (Pass 3) e
medição local como Pass 4 — o gap-fill aqui não foi mais uma busca, foi rodar o
instrumento, porque a pergunta que restava era numérica.

Motiva o [ADR-0011](../../docs/architecture/decisions/0011-seguranca-antes-de-performance.md)
e o [ADR-0012](../../docs/architecture/decisions/0012-performance-e-medida-contra-um-concorrente-nomeado.md).

## Ressalva de proveniência — ler antes dos achados

A suíte de benchmark de overhead de runtime mais completa que existe publicamente
hoje é `devswha/claw-bench`, e ela é o repositório de benchmark do `claw-code` —
nomeado explicitamente como material proibido no
[`AGENTS.md`](../../AGENTS.md) e no non-goal de proveniência da
[spec](../nycode-rs/spec.md). Ela apareceu no Pass 1 e **não foi usada como fonte
de método nem de número**. Está registrada aqui porque a próxima pessoa que
pesquisar este assunto vai encontrá-la no primeiro resultado, e precisa saber
antes de abrir que não pode abrir.

O método adotado não depende dela: `hyperfine` para tempo e `/usr/bin/time -f %M`
para memória residente são o instrumental óbvio, o segundo já estava em uso no
[`perf-gate.sh`](../../scripts/perf-gate.sh) desde a Wave 0.

## Key Findings

1. **Performance de harness e eficácia de agente são eixos independentes, e só o
   primeiro é do NyCode CLI.** Overhead do harness — startup, memória residente,
   tamanho do binário — é decidido pelo código deste repositório. Eficácia
   agêntica (Terminal-Bench, SWE-bench) é decidida pelo modelo, e o modelo vem do
   gateway. O paper do Terminal-Bench mede exatamente isso: *"model selection is
   usually more important than agent scaffold"*.
   Fonte: [Terminal-Bench, ICLR 2026](https://arxiv.org/html/2601.11868v1) | Confiança: high | Impacto: critical

2. **O líder em overhead de harness entre os CLIs de IA relevantes é o Codex
   CLI.** É o único dos grandes reescrito em linguagem nativa: a OpenAI removeu
   Node.js e TypeScript em 2025 declarando quatro motivos — *"zero-dependency
   install, native security bindings, optimized performance, extensible
   protocol"*. Os demais líderes seguem em Node.js ou Bun e medem uma ordem de
   grandeza pior.
   Fonte: [openai/codex discussion #1174](https://github.com/openai/codex/discussions/1174), [InfoQ](https://www.infoq.com/news/2025/06/codex-cli-rust-native-rewrite), [DevClass](https://www.devclass.com/ai-ml/2025/06/02/nodejs-frustrating-and-inefficient-openai-rewrites-ai-coding-tool-in-rust/1619589) | Confiança: high | Impacto: critical

3. **O Codex é referência permitida; os outros líderes não são, ou não valem a
   medição.** O [`AGENTS.md`](../../AGENTS.md) lista `codex` (Apache-2.0) entre as
   cinco referências permitidas. O Claude Code está do lado proibido. Gemini CLI
   foi descontinuado em favor do Antigravity, closed-source. Escolher o Codex
   resolve simultaneamente a pergunta técnica — quem é o mais rápido — e a
   pergunta de proveniência.
   Fonte: [`AGENTS.md`](../../AGENTS.md), [spec](../nycode-rs/spec.md) | Confiança: high | Impacto: critical

4. **Medição local, mesmo método nos dois lados.** `hyperfine --shell=none
   --warmup 20 --runs 200` sobre `--version`, e `/usr/bin/time -f %M` para RSS de
   pico. Ambos os binários são ELF stripped, então a comparação de tamanho é entre
   artefatos comparáveis.

   | Métrica | nycode 0.1.0 | codex-cli 0.147.0 | Razão |
   |---|---:|---:|---:|
   | Startup, mediana | **0,60 ms** | 13,09 ms | **21,8x** |
   | RSS de pico | **5.032 KB** | 22.212 KB | **4,4x** |
   | Binário stripped | **12.017.944 B** | 258.278.208 B | **21,5x** |

   Fonte: medição local, 2026-08-13 | Confiança: high | Impacto: critical

5. **O número de startup que o repositório publicava estava inflado ~3x pelo
   instrumento.** O gate media com `date +%s%N` em volta da invocação, o que
   soma o `fork`/`exec` do subshell à amostra. O
   [`README.md`](../../README.md) declarava 2 ms; `hyperfine --shell=none`, que
   exclui o shell, mede mediana de 0,60 ms. O erro era conservador — reportava
   pior do que a realidade —, mas um orçamento que se pretende apertado não pode
   ser calibrado por um instrumento com essa granularidade.
   Fonte: medição local comparativa | Confiança: high | Impacto: high

6. **A vantagem de memória é muito menor que a de tempo, e isso decide onde a
   margem competitiva pode ser apertada.** 21,8x em startup contra 4,4x em RSS.
   Uma margem relativa uniforme reprovaria hoje em memória e seria decorativa em
   tempo. As margens precisam ser por métrica, derivadas da razão medida.
   Fonte: medição local | Confiança: high | Impacto: high

7. **O Codex publica binário estático musl, mas o `SHA256SUMS` publicado não
   cobre esse artefato.** `codex-x86_64-unknown-linux-musl.tar.gz` existe em toda
   release e dispensa Node; o `codex-package_SHA256SUMS` só lista os archives
   `*-package-*`, que embutem `rg` e `bwrap`. Consequência de desenho: o digest
   do artefato medido é fixado no baseline deste repositório e revisado em diff
   de PR, em vez de conferido contra um arquivo que não o menciona.
   Fonte: `gh api repos/openai/codex/releases/latest` | Confiança: high | Impacto: high

8. **`hyperfine` entra no CI pelo mesmo idioma que o repositório já usa.** Está
   na lista de ferramentas do `taiki-e/install-action`, que o
   [`ci.yml`](../../.github/workflows/ci.yml) já invoca para `cargo-llvm-cov` e
   `cargo-deny`.
   Fonte: [install-action TOOLS.md](https://github.com/taiki-e/install-action/blob/main/TOOLS.md) | Confiança: high | Impacto: medium

## Contradições entre fontes

Os números de terceiros para o Codex divergem entre si e da medição local:
~34,5 ms e ~37,7 ms em duas suítes públicas, ~32 ms numa terceira, contra 13,09
ms medidos aqui. As causas prováveis são versão do Codex, hardware e — a maior
delas — se a medição inclui ou não o `fork` do shell. Nenhuma das fontes
publicou a versão exata medida junto do número.

Isso não foi resolvido, foi contornado: o baseline deste repositório é sempre
medido pelo próprio repositório, com o método do próprio gate, e carrega a versão
e o digest do artefato. Número de terceiro serve para escolher contra quem medir,
nunca como valor do gate.

## Open Questions

- **Variância do runner do GitHub Actions.** A mediana de 0,60 ms foi medida numa
  máquina ociosa. Runner compartilhado é mais barulhento, e não há como estimar
  daqui o fator. Impacto: high — decide se o piso absoluto de startup é
  sustentável. Mitigado por mediana sobre muitas execuções e por `--shell=none`;
  se ainda assim oscilar, o piso sobe com o número medido registrado no ADR.
- **Verificação de atestação em vez de digest fixado.** O Codex publica bundles
  `.sigstore` por artefato, e `gh attestation verify` cobriria a cadeia inteira
  em vez de só o digest. O `gh` disponível aqui é 2.46, anterior ao subcomando.
  Impacto: medium — o digest fixado já barra artefato trocado; a atestação
  barraria também release forjada.

## Sources

- [Terminal-Bench: Benchmarking Agents on Hard, Realistic Tasks](https://arxiv.org/html/2601.11868v1) — o paper que separa scaffold de modelo
- [Codex CLI is Going Native — openai/codex #1174](https://github.com/openai/codex/discussions/1174) — os quatro motivos do rewrite, na fonte primária
- [InfoQ: OpenAI's Codex CLI Goes Native](https://www.infoq.com/news/2025/06/codex-cli-rust-native-rewrite) — cobertura independente do mesmo anúncio
- [DevClass: Node.js frustrating and inefficient?](https://www.devclass.com/ai-ml/2025/06/02/nodejs-frustrating-and-inefficient-openai-rewrites-ai-coding-tool-in-rust/1619589) — detalha o sandbox Landlock/Seatbelt como motivo de segurança
- [taiki-e/install-action TOOLS.md](https://github.com/taiki-e/install-action/blob/main/TOOLS.md) — confirma `hyperfine` na lista
- [openai/codex releases](https://github.com/openai/codex/releases) — artefatos e checksums, consultados via `gh api`

## Recommended Approach

Medir contra o Codex CLI, com baseline fixado em arquivo versionado carregando
versão e digest, e dois pisos por métrica no molde do
[ADR-0003](../../docs/architecture/decisions/0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md):
um absoluto perto do valor medido, que pega regressão nossa, e um relativo ao
baseline, que pega o mercado passando na frente. As margens relativas saem da
razão medida e diferem por métrica, porque as razões diferem por quase cinco
vezes entre tempo e memória.
