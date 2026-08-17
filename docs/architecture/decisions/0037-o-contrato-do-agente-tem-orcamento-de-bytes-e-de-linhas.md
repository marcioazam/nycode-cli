# ADR-0037: o contrato do agente tem orçamento de bytes e de linhas

- **Status:** aceito
- **Data:** 2026-08-17
- **Contexto relacionado:** [ADR-0032](0032-adota-padrao-externo-sota-2026-nivel-l2.md), harness de agente

## Contexto

O Codex lê `AGENTS.md` até `project_doc_max_bytes`, default **32768**.
Passou disso, só emite um `tracing::warn!` e corta o **fim** do arquivo —
onde este repositório guarda "Antes de dizer que terminou" e "Estilo".
Medido em 2026-08-17: o arquivo tinha 32541 bytes, 227 do teto.

A doc de memória do Claude Code pede alvo **abaixo de 200 linhas** por
arquivo de instrução: arquivo longo consome contexto e reduz adesão. O
mesmo `AGENTS.md` tinha 581 linhas.

Elevar o teto do Codex no `.codex/config.toml` do projeto (chave
honrada em projeto confiável; não está na lista que essa camada ignora)
remove a truncagem. Sem um orçamento *menor* que o default, elevar o
teto vira licença para crescer — e a queda de adesão continua.

## Decisão

Dois tetos, os dois no gate [`scripts/agent-harness/gate.sh`](../../../scripts/agent-harness/gate.sh):

| Grandeza | Teto | Por quê |
|---|---:|---|
| Bytes de `AGENTS.md` | **28672** (28 KiB) | 4096 de folga contra o default 32768 do Codex |
| Linhas de `AGENTS.md` | **200** | alvo documentado do Claude Code |

`.codex/config.toml` fixa `project_doc_max_bytes = 65536` só para o
arquivo atual não ser truncado se o gate falhar aberto num clone sem
hooks. O número que autoriza crescimento é o do gate, não o do Codex.

O gate também recusa `CLAUDE.md` sem `@AGENTS.md` e caminho relativo
citado no contrato que não existe na árvore.

## Consequências

Positivas: truncagem silenciosa deixa de apagar a sequência de
verificação; o tamanho do contrato passa a falhar fechado.

Negativas: compressão do `AGENTS.md` (imperativo + ID + caminho de
gate) é obrigatória para o gate passar. Racional vive em ADR e em
`docs/INDEX.md`.

Descartadas: fatiar `AGENTS.md` por crate (o Codex funde raiz→cwd;
sessão na raiz veria *menos* regra). Confiar só no teto elevado do
Codex (remove truncagem, não a queda de adesão).

## Revisão

Reabrir se o Codex mudar o default de `project_doc_max_bytes`, ou se a
doc do Claude Code deixar de pedir o alvo de 200 linhas. Ação padrão:
remedir o arquivo e ajustar os dois números no mesmo PR do gate.
