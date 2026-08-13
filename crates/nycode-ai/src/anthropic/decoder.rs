//! Projeção do stream SSE de `/v1/messages` no vocabulário canônico.

use std::collections::HashMap;

use serde_json::Value;

use crate::error::{ApiError, Error, Result};
use crate::event::{StopReason, StreamEvent, Usage};

/// Decodificador do stream SSE de `/v1/messages`.
///
/// Anthropic identifica blocos de conteúdo por índice, não por id, então o
/// decodificador precisa manter o mapa de índice para id de ferramenta enquanto
/// os deltas chegam. Sem isso, os argumentos de duas chamadas paralelas se
/// misturam.
#[derive(Debug, Default)]
pub struct Decoder {
    tool_ids: HashMap<u64, String>,
    usage: Usage,
    saw_message_stop: bool,
}

impl Decoder {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Se o stream chegou ao encerramento explícito.
    #[must_use]
    pub const fn completed(&self) -> bool {
        self.saw_message_stop
    }

    /// Contabilidade acumulada até aqui.
    #[must_use]
    pub const fn usage(&self) -> Usage {
        self.usage
    }

    /// Marca a contabilidade como estimada.
    ///
    /// Chamado quando a resposta traz `x-nylla-usage-estimated`, que o gateway
    /// emite ao substituir uma contagem ausente por heurística.
    pub const fn mark_usage_estimated(&mut self) {
        self.usage.estimated = true;
    }

    /// Projeta um evento SSE no vocabulário canônico.
    ///
    /// Retorna `Ok(None)` para eventos sem correspondência observável, como
    /// `ping` e o fechamento de um bloco de texto.
    pub fn decode(&mut self, raw: &str) -> Result<Option<StreamEvent>> {
        let value: Value = serde_json::from_str(raw)
            .map_err(|err| Error::MalformedStream(format!("json invalido: {err}")))?;

        let kind = value
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| Error::MalformedStream("evento sem campo `type`".to_owned()))?;

        match kind {
            "message_start" => Ok(Some(self.decode_message_start(&value))),
            "content_block_start" => self.decode_block_start(&value),
            "content_block_delta" => self.decode_block_delta(&value),
            "content_block_stop" => {
                let index = block_index(&value)?;
                Ok(self
                    .tool_ids
                    .remove(&index)
                    .map(|id| StreamEvent::ToolCallEnd { id }))
            }
            "message_delta" => Ok(self.decode_message_delta(&value)),
            "message_stop" => {
                self.saw_message_stop = true;
                Ok(Some(StreamEvent::Usage(self.usage)))
            }
            "error" => Err(Error::Api(in_band_error(&value))),
            "ping" => Ok(None),

            // Um tipo desconhecido nao e erro: o gateway documenta que campos
            // desconhecidos sao aceitos e ignorados, e um evento novo do
            // upstream nao deve derrubar a sessao.
            other => {
                tracing::debug!(event = other, "evento SSE desconhecido, ignorado");
                Ok(None)
            }
        }
    }

    fn decode_message_start(&mut self, value: &Value) -> StreamEvent {
        let message = value.get("message");
        if let Some(usage) = message.and_then(|m| m.get("usage")) {
            self.absorb_usage(usage);
        }
        let id = message
            .and_then(|m| m.get("id"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        StreamEvent::MessageStart { id }
    }

    fn decode_message_delta(&mut self, value: &Value) -> Option<StreamEvent> {
        if let Some(usage) = value.get("usage") {
            self.absorb_usage(usage);
        }
        value
            .get("delta")
            .and_then(|d| d.get("stop_reason"))
            .and_then(Value::as_str)
            .map(|raw| StreamEvent::MessageEnd {
                stop_reason: StopReason::from_anthropic(raw),
            })
    }

    fn decode_block_start(&mut self, value: &Value) -> Result<Option<StreamEvent>> {
        let index = block_index(value)?;
        let block = value.get("content_block");

        if block.and_then(|b| b.get("type")).and_then(Value::as_str) != Some("tool_use") {
            return Ok(None);
        }

        let field = |name: &str| -> Result<String> {
            block
                .and_then(|b| b.get(name))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .ok_or_else(|| Error::MalformedStream(format!("tool_use sem `{name}`")))
        };

        let id = field("id")?;
        let name = field("name")?;
        self.tool_ids.insert(index, id.clone());
        Ok(Some(StreamEvent::ToolCallStart { id, name }))
    }

    fn decode_block_delta(&mut self, value: &Value) -> Result<Option<StreamEvent>> {
        let index = block_index(value)?;
        let delta = value.get("delta");
        let text = |name: &str| delta.and_then(|d| d.get(name)).and_then(Value::as_str);

        match delta.and_then(|d| d.get("type")).and_then(Value::as_str) {
            Some("text_delta") => Ok(text("text").map(|t| StreamEvent::TextDelta(t.to_owned()))),
            Some("thinking_delta") => {
                Ok(text("thinking").map(|t| StreamEvent::ReasoningDelta(t.to_owned())))
            }
            Some("input_json_delta") => {
                // Sem o id no mapa, este fragmento pertenceria a ferramenta
                // nenhuma. Silenciar seria corromper os argumentos.
                let id = self.tool_ids.get(&index).ok_or_else(|| {
                    Error::MalformedStream(format!(
                        "input_json_delta no indice {index} sem tool_use correspondente"
                    ))
                })?;
                Ok(Some(StreamEvent::ToolCallDelta {
                    id: id.clone(),
                    json_fragment: text("partial_json").unwrap_or_default().to_owned(),
                }))
            }
            _ => Ok(None),
        }
    }

    fn absorb_usage(&mut self, usage: &Value) {
        // `message_delta` reemite `output_tokens` de forma cumulativa e omite os
        // campos de entrada. Sobrescrever com zero apagaria a contagem inicial,
        // e com ela o custo reportado do turno.
        let absorb = |name: &str, slot: &mut u64| {
            if let Some(v) = usage.get(name).and_then(Value::as_u64)
                && v > 0
            {
                *slot = v;
            }
        };

        absorb("input_tokens", &mut self.usage.input_tokens);
        absorb("output_tokens", &mut self.usage.output_tokens);
        absorb("cache_read_input_tokens", &mut self.usage.cache_read_tokens);
        absorb(
            "cache_creation_input_tokens",
            &mut self.usage.cache_write_tokens,
        );
    }
}

/// Erro emitido no meio de um stream já iniciado.
///
/// Deixar isso passar como fim normal é o modo clássico de um cliente apresentar
/// resposta truncada como resposta completa.
fn in_band_error(value: &Value) -> ApiError {
    let err = value.get("error");
    let field = |name: &str, fallback: &str| {
        err.and_then(|e| e.get(name))
            .and_then(Value::as_str)
            .unwrap_or(fallback)
            .to_owned()
    };
    ApiError {
        status: None,
        kind: field("type", "unknown_error"),
        message: field("message", ""),
        retry_after: None,
    }
}

fn block_index(value: &Value) -> Result<u64> {
    value
        .get("index")
        .and_then(Value::as_u64)
        .ok_or_else(|| Error::MalformedStream("evento de bloco sem `index`".to_owned()))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    fn decode_all(events: &[&str]) -> (Vec<StreamEvent>, Decoder) {
        let mut decoder = Decoder::new();
        let mut out = Vec::new();
        for raw in events {
            if let Some(event) = decoder.decode(raw).expect("evento deveria decodificar") {
                out.push(event);
            }
        }
        (out, decoder)
    }

    #[test]
    fn decodes_a_plain_text_turn() {
        let (events, decoder) = decode_all(&[
            r#"{"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10}}}"#,
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Ola"}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" mundo"}}"#,
            r#"{"type":"content_block_stop","index":0}"#,
            r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}"#,
            r#"{"type":"message_stop"}"#,
        ]);

        assert_eq!(
            events,
            vec![
                StreamEvent::MessageStart {
                    id: "msg_1".to_owned()
                },
                StreamEvent::TextDelta("Ola".to_owned()),
                StreamEvent::TextDelta(" mundo".to_owned()),
                StreamEvent::MessageEnd {
                    stop_reason: StopReason::EndTurn
                },
                StreamEvent::Usage(Usage {
                    input_tokens: 10,
                    output_tokens: 5,
                    ..Usage::default()
                }),
            ]
        );
        assert!(decoder.completed());
    }

    #[test]
    fn keeps_parallel_tool_calls_separate() {
        // Anthropic identifica blocos por indice. Sem o mapa indice->id, os
        // argumentos de duas chamadas se misturam e o agente executa a
        // ferramenta errada com os parametros da outra.
        let (events, _) = decode_all(&[
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t_a","name":"read"}}"#,
            r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t_b","name":"bash"}}"#,
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"cmd\":"}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"path\":"}}"#,
            r#"{"type":"content_block_stop","index":0}"#,
        ]);

        assert_eq!(
            events[0],
            StreamEvent::ToolCallStart {
                id: "t_a".into(),
                name: "read".into()
            }
        );
        assert_eq!(
            events[1],
            StreamEvent::ToolCallStart {
                id: "t_b".into(),
                name: "bash".into()
            }
        );
        assert_eq!(
            events[2],
            StreamEvent::ToolCallDelta {
                id: "t_b".into(),
                json_fragment: "{\"cmd\":".into()
            }
        );
        assert_eq!(
            events[3],
            StreamEvent::ToolCallDelta {
                id: "t_a".into(),
                json_fragment: "{\"path\":".into()
            }
        );
        assert_eq!(events[4], StreamEvent::ToolCallEnd { id: "t_a".into() });
    }

    #[test]
    fn in_band_error_becomes_an_error_not_a_clean_end() {
        let mut decoder = Decoder::new();
        decoder
            .decode(r#"{"type":"message_start","message":{"id":"m"}}"#)
            .unwrap();
        let err = decoder
            .decode(
                r#"{"type":"error","error":{"type":"overloaded_error","message":"sobrecarga"}}"#,
            )
            .expect_err("erro in-band precisa virar Err");

        match err {
            Error::Api(api) => {
                assert_eq!(api.status, None);
                assert_eq!(api.kind, "overloaded_error");
                assert!(
                    !api.is_retryable(),
                    "turno ja comecou, repetir duplicaria ferramentas"
                );
            }
            other => panic!("esperado Error::Api, veio {other:?}"),
        }
        assert!(
            !decoder.completed(),
            "erro in-band nao pode marcar o stream como completo"
        );
    }

    #[test]
    fn refusal_survives_decoding_without_becoming_end_turn() {
        let (events, _) =
            decode_all(&[r#"{"type":"message_delta","delta":{"stop_reason":"refusal"}}"#]);
        assert_eq!(
            events,
            vec![StreamEvent::MessageEnd {
                stop_reason: StopReason::Refusal
            }]
        );
    }

    #[test]
    fn cumulative_usage_does_not_erase_input_count() {
        let (_, decoder) = decode_all(&[
            r#"{"type":"message_start","message":{"id":"m","usage":{"input_tokens":1200,"cache_read_input_tokens":900}}}"#,
            r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}"#,
            r#"{"type":"message_stop"}"#,
        ]);

        let usage = decoder.usage();
        assert_eq!(
            usage.input_tokens, 1200,
            "input_tokens foi apagado pelo message_delta"
        );
        assert_eq!(usage.output_tokens, 42);
        assert_eq!(usage.cache_read_tokens, 900);
    }

    #[test]
    fn estimated_usage_flag_propagates() {
        let mut decoder = Decoder::new();
        assert!(!decoder.usage().estimated);
        decoder.mark_usage_estimated();
        assert!(decoder.usage().estimated);
    }

    #[test]
    fn unknown_event_types_are_ignored_not_fatal() {
        let mut decoder = Decoder::new();
        assert_eq!(decoder.decode(r#"{"type":"ping"}"#).unwrap(), None);
        assert_eq!(
            decoder
                .decode(r#"{"type":"some_future_event","x":1}"#)
                .unwrap(),
            None
        );
    }

    #[test]
    fn orphan_tool_delta_is_a_malformed_stream() {
        let mut decoder = Decoder::new();
        let err = decoder
            .decode(
                r#"{"type":"content_block_delta","index":7,"delta":{"type":"input_json_delta","partial_json":"{}"}}"#,
            )
            .expect_err("delta orfao precisa falhar");
        assert!(matches!(err, Error::MalformedStream(_)));
    }

    #[test]
    fn malformed_json_and_missing_type_are_rejected() {
        let mut decoder = Decoder::new();
        assert!(matches!(
            decoder.decode("nao e json"),
            Err(Error::MalformedStream(_))
        ));
        assert!(matches!(
            decoder.decode(r#"{"sem":"tipo"}"#),
            Err(Error::MalformedStream(_))
        ));
    }

    #[test]
    fn tool_use_missing_required_fields_is_rejected() {
        let mut decoder = Decoder::new();
        let err = decoder
            .decode(
                r#"{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","name":"read"}}"#,
            )
            .expect_err("tool_use sem id precisa falhar");
        assert!(matches!(err, Error::MalformedStream(msg) if msg.contains("id")));
    }

    #[test]
    fn thinking_deltas_are_kept_separate_from_visible_text() {
        // Misturar raciocinio com texto visivel entregaria ao usuario conteudo
        // que o modelo nao pretendia mostrar.
        let (events, _) = decode_all(&[
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}"#,
        ]);
        assert_eq!(events, vec![StreamEvent::ReasoningDelta("hmm".to_owned())]);
    }
}
