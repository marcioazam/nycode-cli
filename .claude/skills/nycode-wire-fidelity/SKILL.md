---
name: nycode-wire-fidelity
description: "Preserva fidelidade de wire ao gateway (NFR-4): erro in-band, stop_reason e usage estimado chegam como o gateway os emitiu. Use when changing nycode-ai transport, dialects, streaming, or timeouts. Triggers: \"NFR-4\", \"stop_reason\", \"fidelidade\", \"wire\", \"degradar em silencio\". Not for REST/OpenAPI breaking-change review (use api-contract-compat-reviewer)."
---

# Fidelidade de wire

Nada se degrada em silêncio (NFR-4). Um erro in-band, um `stop_reason` fora
do vocabulário, ou um usage estimado chega ao usuário **como o gateway o
emitiu**. Traduzir para um enum "amigo" que descarta o desconhecido é o
defeito que esta skill existe para impedir.

## Onde costuma partir

- Dialetos Anthropic / OpenAI em `crates/nycode-ai`: mapeamento de
  `stop_reason`, erros de API, usage.
- Stream (`transport/stream.rs`, `openai/responses_stream.rs`): um evento
  desconhecido não pode ser engolido.
- Prazos (ADR-0014): são de **ociosidade**, não de duração total do turno.
  Um teto de duração mata resposta longa e saudável; um gateway mudo distingue-se
  por deixar de mandar bytes.
- `stdout` leva só a resposta; progresso vai para `stderr`.

## O que não fazer

- Normalizar um `stop_reason` desconhecido para `end_turn` (ou equivalente)
  "para o cliente não quebrar".
- Engolir um erro in-band e continuar o turno como se tivesse havido texto.
- Trocar prazo de ociosidade por prazo de duração para "simplificar".

## Evaluation

**Pass:** valor desconhecido do gateway sobrevive até à superfície do
usuário, e um timeout de ociosidade não corta um stream que ainda emite.
**Fail:** o harness escolhe um vocabulário próprio e descarta o que o
gateway enviou.
