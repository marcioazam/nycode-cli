//! Projeção do stream do dialeto Responses.

use std::collections::HashMap;

use serde_json::Value;

use crate::dialect::StreamDecoder;
use crate::error::{ApiError, Error, Result};
use crate::event::{StopReason, StreamEvent, Usage};

/// Decodificador de `responses`.
///
/// Aqui os eventos são nomeados em vez de posicionais, e a chamada de ferramenta
/// é identificada por `item_id` — que é distinto do `call_id` usado para casar o
/// resultado. Guardar o mapa dos dois é o que permite devolver o resultado com o
/// identificador que o backend espera.
#[derive(Debug, Default)]
pub struct ResponsesDecoder {
    /// `item_id` do stream para o `call_id` usado no protocolo.
    call_ids: HashMap<String, String>,
    usage: Usage,
    completed: bool,
}

impl ResponsesDecoder {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn absorb_usage(&mut self, usage: &Value) {
        let field = |name: &str| usage.get(name).and_then(Value::as_u64).unwrap_or(0);
        self.usage.input_tokens = field("input_tokens");
        self.usage.output_tokens = field("output_tokens");
        self.usage.cache_read_tokens = usage
            .get("input_tokens_details")
            .and_then(|d| d.get("cached_tokens"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        self.usage.reasoning_tokens = usage
            .get("output_tokens_details")
            .and_then(|d| d.get("reasoning_tokens"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
    }

    fn item_added(&mut self, value: &Value) -> Option<StreamEvent> {
        let item = value.get("item")?;
        if item.get("type").and_then(Value::as_str) != Some("function_call") {
            return None;
        }
        let call_id = item.get("call_id").and_then(Value::as_str)?.to_owned();
        // O stream endereca fragmentos por `item_id`, mas o resultado precisa
        // voltar com `call_id`. Sem o mapa, o backend recebe um id que nao casa
        // com nenhuma chamada.
        if let Some(item_id) = item.get("id").and_then(Value::as_str) {
            self.call_ids.insert(item_id.to_owned(), call_id.clone());
        }
        let name = item
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        Some(StreamEvent::ToolCallStart { id: call_id, name })
    }

    fn arguments_delta(&self, value: &Value) -> Option<StreamEvent> {
        let item_id = value.get("item_id").and_then(Value::as_str)?;
        let fragment = value.get("delta").and_then(Value::as_str)?;
        let id = self.call_ids.get(item_id)?;
        Some(StreamEvent::ToolCallDelta {
            id: id.clone(),
            json_fragment: fragment.to_owned(),
        })
    }

    fn finish(&mut self, value: &Value) -> StreamEvent {
        let response = value.get("response");
        if let Some(usage) = response.and_then(|r| r.get("usage")) {
            self.absorb_usage(usage);
        }
        self.completed = true;

        // `incomplete_details.reason` distingue estouro de limite de um fim
        // natural; sem ele, uma resposta cortada pareceria concluida.
        let reason = response
            .and_then(|r| r.get("incomplete_details"))
            .and_then(|d| d.get("reason"))
            .and_then(Value::as_str);

        let stop_reason = match reason {
            Some("max_output_tokens") => StopReason::MaxTokens,
            Some("content_filter") => StopReason::Refusal,
            Some(other) => StopReason::Unrecognized(other.to_owned()),
            None => StopReason::EndTurn,
        };
        StreamEvent::MessageEnd { stop_reason }
    }
}

impl StreamDecoder for ResponsesDecoder {
    fn decode(&mut self, raw: &str) -> Result<Option<StreamEvent>> {
        let value: Value = serde_json::from_str(raw)
            .map_err(|err| Error::MalformedStream(format!("json invalido: {err}")))?;

        let kind = value
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| Error::MalformedStream("evento sem campo `type`".to_owned()))?;

        let text = |name: &str| value.get(name).and_then(Value::as_str);

        match kind {
            "response.created" => {
                let id = value
                    .get("response")
                    .and_then(|r| r.get("id"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                Ok(Some(StreamEvent::MessageStart { id }))
            }
            "response.output_text.delta" => {
                Ok(text("delta").map(|t| StreamEvent::TextDelta(t.to_owned())))
            }
            "response.reasoning_summary_text.delta" | "response.reasoning_text.delta" => {
                Ok(text("delta").map(|t| StreamEvent::ReasoningDelta(t.to_owned())))
            }
            "response.output_item.added" => Ok(self.item_added(&value)),
            "response.function_call_arguments.delta" => Ok(self.arguments_delta(&value)),
            "response.function_call_arguments.done" => {
                let id = value
                    .get("item_id")
                    .and_then(Value::as_str)
                    .and_then(|item| self.call_ids.get(item))
                    .cloned();
                Ok(id.map(|id| StreamEvent::ToolCallEnd { id }))
            }
            "response.completed" | "response.incomplete" => Ok(Some(self.finish(&value))),
            "response.failed" | "error" => {
                let error = value
                    .get("response")
                    .and_then(|r| r.get("error"))
                    .or_else(|| value.get("error"));
                let field = |name: &str, fallback: &str| {
                    error
                        .and_then(|e| e.get(name))
                        .and_then(Value::as_str)
                        .unwrap_or(fallback)
                        .to_owned()
                };
                Err(Error::Api(ApiError {
                    status: None,
                    kind: field("code", "response_failed"),
                    message: field("message", ""),
                    retry_after: None,
                }))
            }
            other => {
                tracing::debug!(event = other, "evento Responses desconhecido, ignorado");
                Ok(None)
            }
        }
    }

    fn completed(&self) -> bool {
        self.completed
    }

    fn mark_usage_estimated(&mut self) {
        self.usage.estimated = true;
    }

    /// O usage sai aqui porque não cabe em [`Self::decode`].
    ///
    /// Neste dialeto o `stop_reason` e a contagem chegam no mesmo
    /// `response.completed`, e `decode` devolve um evento por linha do wire —
    /// aquele evento já é o `MessageEnd`. Um turno cortado não reporta nada:
    /// inventaria número que o gateway não mandou.
    fn trailing(&mut self) -> Option<StreamEvent> {
        self.completed.then_some(StreamEvent::Usage(self.usage))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode_all(events: &[&str]) -> (Vec<StreamEvent>, ResponsesDecoder) {
        let mut decoder = ResponsesDecoder::new();
        let mut out = Vec::new();
        for raw in events {
            if let Some(event) = decoder.decode(raw).expect("deveria decodificar") {
                out.push(event);
            }
        }
        // O fim do corpo é o que drena o evento final, como em `stream::decode`.
        if decoder.completed() {
            out.extend(decoder.trailing());
        }
        (out, decoder)
    }

    #[test]
    fn decodes_a_text_turn() {
        let (events, decoder) = decode_all(&[
            r#"{"type":"response.created","response":{"id":"resp_1"}}"#,
            r#"{"type":"response.output_text.delta","delta":"Ola"}"#,
            r#"{"type":"response.output_text.delta","delta":" mundo"}"#,
            r#"{"type":"response.completed","response":{"usage":{"input_tokens":9,"output_tokens":2}}}"#,
        ]);

        assert_eq!(
            events[0],
            StreamEvent::MessageStart {
                id: "resp_1".to_owned()
            }
        );
        assert_eq!(events[1], StreamEvent::TextDelta("Ola".to_owned()));
        assert_eq!(
            events[3],
            StreamEvent::MessageEnd {
                stop_reason: StopReason::EndTurn
            }
        );
        assert!(decoder.completed());
        assert_eq!(decoder.usage.input_tokens, 9);
    }

    #[test]
    fn maps_item_id_to_call_id_for_tool_arguments() {
        // O stream endereca fragmentos por `item_id`, mas o resultado precisa
        // voltar com `call_id`. Confundir os dois faz o backend receber um id
        // que nao casa com nenhuma chamada.
        let (events, _) = decode_all(&[
            r#"{"type":"response.output_item.added","item":{"type":"function_call","id":"fc_abc","call_id":"call_xyz","name":"read"}}"#,
            r#"{"type":"response.function_call_arguments.delta","item_id":"fc_abc","delta":"{\"path\":"}"#,
            r#"{"type":"response.function_call_arguments.done","item_id":"fc_abc"}"#,
        ]);

        assert_eq!(
            events[0],
            StreamEvent::ToolCallStart {
                id: "call_xyz".to_owned(),
                name: "read".to_owned()
            }
        );
        assert_eq!(
            events[1],
            StreamEvent::ToolCallDelta {
                id: "call_xyz".to_owned(),
                json_fragment: "{\"path\":".to_owned()
            }
        );
        assert_eq!(
            events[2],
            StreamEvent::ToolCallEnd {
                id: "call_xyz".to_owned()
            }
        );
    }

    #[test]
    fn an_incomplete_response_reports_the_limit_not_a_natural_stop() {
        // Sem `incomplete_details`, uma resposta cortada por teto de tokens
        // pareceria concluida.
        let (events, _) = decode_all(&[
            r#"{"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}"#,
        ]);
        assert_eq!(
            events[0],
            StreamEvent::MessageEnd {
                stop_reason: StopReason::MaxTokens
            }
        );
    }

    #[test]
    fn a_content_filter_stop_becomes_refusal() {
        let (events, _) = decode_all(&[
            r#"{"type":"response.incomplete","response":{"incomplete_details":{"reason":"content_filter"}}}"#,
        ]);
        assert_eq!(
            events[0],
            StreamEvent::MessageEnd {
                stop_reason: StopReason::Refusal
            }
        );
    }

    #[test]
    fn an_unknown_incomplete_reason_is_preserved() {
        let (events, _) = decode_all(&[
            r#"{"type":"response.incomplete","response":{"incomplete_details":{"reason":"algo_novo"}}}"#,
        ]);
        assert_eq!(
            events[0],
            StreamEvent::MessageEnd {
                stop_reason: StopReason::Unrecognized("algo_novo".to_owned())
            }
        );
    }

    #[test]
    fn reasoning_deltas_are_separate_from_visible_text() {
        let (events, _) =
            decode_all(&[r#"{"type":"response.reasoning_summary_text.delta","delta":"hmm"}"#]);
        assert_eq!(events[0], StreamEvent::ReasoningDelta("hmm".to_owned()));
    }

    #[test]
    fn a_failed_response_is_an_error_not_a_completion() {
        let mut decoder = ResponsesDecoder::new();
        let err = decoder
            .decode(r#"{"type":"response.failed","response":{"error":{"code":"server_error","message":"caiu"}}}"#)
            .expect_err("falha precisa virar Err");
        assert!(matches!(err, Error::Api(api) if api.kind == "server_error"));
        assert!(!decoder.completed());
    }

    #[test]
    fn orphan_argument_deltas_are_ignored_rather_than_misattributed() {
        // Sem o item correspondente nao ha a quem atribuir o fragmento;
        // atribui-lo a chamada errada corromperia os argumentos dela.
        let (events, _) = decode_all(&[
            r#"{"type":"response.function_call_arguments.delta","item_id":"desconhecido","delta":"{}"}"#,
        ]);
        assert!(events.is_empty());
    }

    #[test]
    fn unknown_events_are_ignored_and_malformed_ones_are_not() {
        let mut decoder = ResponsesDecoder::new();
        assert_eq!(
            decoder
                .decode(r#"{"type":"response.in_progress"}"#)
                .unwrap(),
            None
        );
        assert!(matches!(
            decoder.decode("{nao json"),
            Err(Error::MalformedStream(_))
        ));
        assert!(matches!(
            decoder.decode(r#"{"sem":"tipo"}"#),
            Err(Error::MalformedStream(_))
        ));
    }

    #[test]
    fn the_completed_stream_reports_the_usage_it_absorbed() {
        // Sem o evento, a contagem deste dialeto sai zerada: o total do turno
        // ignora os tokens e a taxa de cache que o NFR-7 exige visivel fica em
        // zero para sempre.
        let (events, _) = decode_all(&[
            r#"{"type":"response.completed","response":{"usage":{"input_tokens":9,"output_tokens":2,"input_tokens_details":{"cached_tokens":6}}}}"#,
        ]);

        let usage = events.iter().find_map(|event| match event {
            StreamEvent::Usage(usage) => Some(*usage),
            _ => None,
        });
        let usage = usage.expect("o turno concluido precisa reportar usage");
        assert_eq!(usage.input_tokens, 9);
        assert_eq!(usage.output_tokens, 2);
        assert_eq!(usage.cache_read_tokens, 6);
    }

    #[test]
    fn the_estimated_flag_reaches_the_user_in_this_dialect_too() {
        // NFR-4: um usage heuristico precisa chegar marcado como o gateway o
        // emitiu, e nao passar por medido.
        let mut decoder = ResponsesDecoder::new();
        decoder.mark_usage_estimated();
        let _ = decoder
            .decode(r#"{"type":"response.completed","response":{"usage":{"input_tokens":1}}}"#)
            .expect("deveria decodificar");

        match decoder.trailing() {
            Some(StreamEvent::Usage(usage)) => assert!(usage.estimated),
            other => panic!("esperado usage estimado, veio {other:?}"),
        }
    }

    #[test]
    fn a_stream_that_never_completed_reports_no_usage() {
        // Emitir usage de um turno cortado inventaria numero que o gateway nao
        // mandou.
        let (events, mut decoder) =
            decode_all(&[r#"{"type":"response.output_text.delta","delta":"parc"}"#]);
        assert!(!decoder.completed());
        assert!(decoder.trailing().is_none());
        assert!(
            !events
                .iter()
                .any(|event| matches!(event, StreamEvent::Usage(_))),
            "{events:?}"
        );
    }

    #[test]
    fn cache_and_reasoning_details_are_captured() {
        let (_, decoder) = decode_all(&[
            r#"{"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":40,"input_tokens_details":{"cached_tokens":60},"output_tokens_details":{"reasoning_tokens":15}}}}"#,
        ]);
        assert_eq!(decoder.usage.cache_read_tokens, 60);
        assert_eq!(decoder.usage.reasoning_tokens, 15);
    }
}
