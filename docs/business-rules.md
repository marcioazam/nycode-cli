# Regras de negócio — NyCode CLI

Isto não duplica a tabela de requisitos funcionais e não-funcionais — ela vive
em [`docs/requirements/REQUIREMENTS.md`](requirements/REQUIREMENTS.md), com
`.specs/nycode-rs/spec.md` como fonte normativa. O que está aqui são as
regras que **atravessam** requisitos individuais: políticas e invariantes que
não são uma feature, mas decidem como qualquer feature se comporta quando
duas forças colidem, ou o que nunca é aceitável independente do requisito em
jogo.

Cada regra tem um ID estável (`BR-N`), citável em revisão de código e em
commit, e um link para onde ela é verificada — o mesmo princípio de
rastreabilidade que os IDs de regra do padrão externo (`GATE-N`, `SEC-N`) já
seguem neste repositório.

| ID | Regra | Onde é verificada |
|---|---|---|
| BR-1 | Segurança precede performance. Quando as duas se opõem e não há forma de atender às duas, a segurança define o que é aceitável e a performance se acomoda ao que sobra | [ADR-0011](architecture/decisions/0011-seguranca-antes-de-performance.md); `needs: [supply-chain]` no job `perf` do [`ci.yml`](../.github/workflows/ci.yml) |
| BR-2 | Nada é degradado em silêncio: um erro in-band, um `stop_reason` fora do vocabulário ou um usage estimado chega ao usuário exatamente como o gateway o emitiu | NFR-4; testes de dialeto em `crates/nycode-ai` |
| BR-3 | Um requisito não é declarado entregue em documento sem que o caminho de produção o execute. Um módulo implementado, testado e nunca chamado é pendência, não entrega | Critério de aceite da spec; auditoria manual por trimestre |
| BR-4 | Ausência de confinamento do shell é dita ao usuário, nunca assumida ou silenciada | FR-11; testes de `policy::confinement` |
| BR-5 | O código-fonte vazado do Claude Code e qualquer derivado dele são proibidos como referência, para qualquer contribuidor, humano ou agente, em qualquer circunstância | Non-goals de proveniência da spec; seção "Proveniência" do [`AGENTS.md`](../AGENTS.md) |
| BR-6 | A feature `subscription-oauth` é um risco aceito formalmente — fora do build padrão, nunca alcançável transitivamente | [ADR-0001](architecture/decisions/0001-subscription-oauth-is-a-flagged-accepted-risk.md); job `default-build-has-no-subscription-oauth` do CI |
| BR-7 | Qualquer comportamento observável divergente do harness de referência é uma decisão registrada (ADR), nunca um acidente | NFR-6; harness `nycode-parity`, job `parity` |
| BR-8 | Um diretório de código comporta no máximo sete arquivos; nome vago (`utils`, `helpers`, `common`) é sinal de parada, não solução | Seção "Layout" do [`AGENTS.md`](../AGENTS.md); [`scripts/layout-gate.sh`](../scripts/layout-gate.sh) |
| BR-9 | Uma dependência nova entre crates internos exige revisão explícita antes de existir no `Cargo.toml` | Seção "Fronteira de arquitetura" do [`AGENTS.md`](../AGENTS.md); [`scripts/architecture-boundary-gate.sh`](../scripts/architecture-boundary-gate.sh) |
| BR-10 | Todo commit assistido por IA carrega o rodapé `Assisted-by: <agente>:<modelo>`; nenhum agente adiciona rodapé de certificação de origem humana | Seção "Estilo" do [`AGENTS.md`](../AGENTS.md) — convenção, sem gate mecânico ainda |

## Por que ID próprio, e não reaproveitar FR/NFR

FR e NFR descrevem *o que o produto faz* e *sob que orçamento*. Uma regra de
negócio descreve *o que nunca muda*, mesmo quando o requisito muda — BR-1
continuaria valendo ainda que NFR-1 a NFR-3 fossem revistos amanhã, porque a
prioridade entre segurança e performance é anterior a qualquer número
específico. Misturar os dois esquemas de ID faria uma revisão de PR precisar
adivinhar se `NFR-4` é o requisito de fidelidade de wire ou a proibição de
degradar em silêncio que o sustenta — são coisas diferentes, com granularidade
diferente.
