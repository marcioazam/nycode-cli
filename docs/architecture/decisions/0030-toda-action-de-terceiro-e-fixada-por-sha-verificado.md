# ADR-0030: Toda action de terceiro é fixada por SHA verificado, com carência de sete dias

- **Status:** aceito
- **Data:** 2026-08-14
- **Contexto relacionado:** [`AGENTS.md`](../../../AGENTS.md), regra de artefato de
  terceiro; [`perf-baseline.txt`](../../../scripts/perf-baseline.txt), que já cumpria
  a regra do lado do binário

## Contexto

O `AGENTS.md` já dizia, antes deste ADR: *"código que baixa artefato de terceiro
verifica o digest antes de executar, com o esperado fixado em arquivo
versionado"*. O `perf-baseline.yml` cumpre isso à risca — baixa o binário do
concorrente e confere `sha256sum -c` antes de extrair, com erro duro quando o
digest está `nao-fixado`.

E os três workflows do repositório executavam doze referências a actions de
terceiro sem fixar nenhuma, num total de 52 achados não suprimidos ao rodar
`zizmor` pela primeira vez: 31 `unpinned-uses` de severidade alta, 10
`artipacked` (credencial persistida no checkout), 10 `excessive-permissions`, e
1 `cache-poisoning` — cache restaurado no workflow que publica binário. Uma delas,
`dtolnay/rust-toolchain@stable`, é uma *branch*: qualquer force-push nela muda o
que roda em todo pull request sem que ninguém precise abrir um PR para isso.
Outra, `softprops/action-gh-release@v2`, roda no job que publica, com
`contents: write`.

Uma action é código de terceiro executado com um token do repositório. A regra
de digest do `AGENTS.md` valia para tarball e não valia para o próprio CI que a
impunha em outro lugar.

Dois precedentes concretos, e não hipotéticos: em março de 2026 a TeamPCP fez
force-push em 76 das 77 tags de `aquasecurity/trivy-action` para um ladrão de
credencial, e em março de 2025 `tj-actions/changed-files` foi reapontada do
mesmo jeito. Os dois vieram de tag reescrita, não de conta comprometida — exatamente
a superfície que um SHA fecha.

## Decisão

Toda `uses:` nos workflows deste repositório é um SHA de commit de 40
caracteres, com um comentário de versão ao lado, verificado por `pinact`.

1. **`pinact run -fix=false -no-api`** roda no nível rápido do CI local —
   checagem sintática, sem rede, alguns segundos. **`pinact run -fix=false
   --verify-comment`** roda no job `workflows` do CI remoto — confirma que o
   comentário resolve, pela API, ao mesmo commit do SHA. Um SHA sozinho não
   prova que o commit pertence ao repositório upstream, porque o SHA de um
   *fork* é igualmente fixável; o comentário verificado é o controle real.
2. **Carência de sete dias** (`min_age: 7` em `.pinact.yaml`) antes de adotar
   um release novo. Comprometimento de supply chain costuma ser detectado em
   menos de uma semana; a carência descarta a maior parte da janela em que uma
   tag envenenada fica viva.
3. **Três exceções documentadas**, não silenciosas: `dtolnay/rust-toolchain@stable`
   e as duas tags móveis de `taiki-e/install-action` (`cargo-deny`,
   `cargo-llvm-cov`, e depois `zizmor`) usam, por desenho do próprio
   mantenedor upstream, um esquema de referência sem tag semver — o nome *é* o
   seletor (de canal de Rust, ou de ferramenta). O `pinact` não tem tag contra
   a qual verificar o comentário. As três continuam fixadas por SHA; o vetor
   que o pin fecha — uma branch reescrita em silêncio — fica fechado do mesmo
   jeito. O residual, documentado em `.pinact.yaml`, é só a ausência de
   verificação automática contra uma tag que não existe.
4. **Dependabot** (`.github/dependabot.yml`) mantém os pins vivos. Fixar sem
   atualizador trocaria um risco por outro: a correção de segurança upstream
   nunca chegaria.

## Consequências

Positivas: uma action comprometida por reescrita de tag deixa de afetar este
repositório sem que um PR precise ser revisado e aceito primeiro. O `zizmor`
roda limpo em severidade média e alta, sem supressão — `zizmor.yml` nasce
vazio de `rules:` de propósito, e a política é que continue assim.

Negativas: `dtolnay/rust-toolchain`'s SHA fixado não recebe Rust estável novo
sozinho — isso passa a ser trabalho do Dependabot, não automático como o
`@stable` flutuante entregava. Um `uses:` fica bem menos legível
(`actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09  # v5.1.0` em vez de
`actions/checkout@v5`); o comentário de versão existe para compensar isso.

Descartadas: manter tag semver sem pin, aceitando o risco — rejeitado pelos
dois CVEs citados. Congelar toda action num vendoring local — rejeitado por
custo de manutenção desproporcional ao ganho, já que o SHA verificado fecha o
mesmo vetor com muito menos atrito.

## Revisão

Se o `pinact` ganhar suporte nativo a `--branch-to-tag` resolvendo para o
esquema de `dtolnay/rust-toolchain` (hoje o `v1` da action não corresponde ao
seletor de canal), as três exceções em `.pinact.yaml` podem ser revisitadas.
Até lá, qualquer SHA fixado que o Dependabot pare de conseguir atualizar por
mais de um ciclo de release do Rust é sinal de reabrir esta decisão.
