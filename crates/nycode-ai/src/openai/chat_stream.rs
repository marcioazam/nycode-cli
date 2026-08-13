//! Projeção do stream de Chat Completions.

use std::collections::HashMap;

use serde_json::Value;

use crate::dialect::StreamDecoder;
use crate::error::{Error, Result};
use crate::event::{StopReason, StreamEvent, Usage};

/// Sentinela de fim de stream do dialeto.
const DONE: &str = "[DONE]";

/// Decodificador de `chat/completions`.
///
/// Chamadas de ferramenta chegam indexadas por posição no array `tool_calls`,
/// e só o primeiro fragmento traz `id` e `name`. Sem guardar o mapa de índice
/// para id, os argumentos de chamadas paralelas se misturam.
#[derive(Debug, Default)]
pub struct ChatDecoder {
    tool_ids: HashMap<u64, String>,
    open_tools: Vec<String>,
    usage: Usage,
    saw_done: bool,
    announced_start: bool,
}

impl ChatDecoder {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn absorb_usage(&mut self, usage: &Value) {
        let field = |name: &str| usage.get(name).and_then(Value::as_u64).unwrap_or(0);
        self.usage.input_tokens = field("prompt_tokens");
        self.usage.output_tokens = field("completion_tokens");
        self.usage.cache_read_tokens = usage
            .get("prompt_tokens_details")
            .and_then(|d| d.get("cached_tokens"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        self.usage.reasoning_tokens = usage
            .get("completion_tokens_details")
            .and_then(|d| d.get("reasoning_tokens"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
    }

    fn decode_tool_delta(&mut self, calls: &[Value]) -> Option<StreamEvent> {
        let call = calls.first()?;
        let index = call.get("index").and_then(Value::as_u64).unwrap_or(0);
        let function = call.get("function");

        // Primeiro fragmento: traz id e nome, os seguintes so argumentos.
        if let Some(id) = call.get("id").and_then(Value::as_str)
            && !self.tool_ids.contains_key(&index)
        {
            let name = function
                .and_then(|f| f.get("name"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            self.tool_ids.insert(index, id.to_owned());
            self.open_tools.push(id.to_owned());
            return Some(StreamEvent::ToolCallStart {
                id: id.to_owned(),
                name,
            });
        }

        let fragment = function
            .and_then(|f| f.get("arguments"))
            .and_then(Value::as_str)?;
        let id = self.tool_ids.get(&index)?;
        Some(StreamEvent::ToolCallDelta {
            id: id.clone(),
            json_fragment: fragment.to_owned(),
        })
    }
}

impl StreamDecoder for ChatDecoder {
    fn decode(&mut self, raw: &str) -> Result<Option<StreamEvent>> {
        if raw.trim() == DONE {
            self.saw_done = true;
            return Ok(Some(StreamEvent::Usage(self.usage)));
        }

        let value: Value = serde_json::from_str(raw)
            .map_err(|err| Error::MalformedStream(format!("json invalido: {err}")))?;

        // Erro in-band: o backend desistiu no meio de um stream ja aberto.
        if let Some(error) = value.get("error") {
            let field = |name: &str, fallback: &str| {
                error
                    .get(name)
                    .and_then(Value::as_str)
                    .unwrap_or(fallback)
                    .to_owned()
            };
            return Err(Error::Api(crate::error::ApiError {
                status: None,
                kind: field("type", "unknown_error"),
                message: field("message", ""),
                retry_after: None,
            }));
        }

        if let Some(usage) = value.get("usage").filter(|u| !u.is_null()) {
            self.absorb_usage(usage);
        }

        if !self.announced_start {
            self.announced_start = true;
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            return Ok(Some(StreamEvent::MessageStart { id }));
        }

        let Some(choice) = value.get("choices").and_then(|c| c.get(0)) else {
            return Ok(None);
        };

        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            // Um turno pode encerrar com ferramentas ainda abertas; fecha-las
            // aqui garante que o acumulador as considere completas.
            if let Some(id) = self.open_tools.pop() {
                return Ok(Some(StreamEvent::ToolCallEnd { id }));
            }
            return Ok(Some(StreamEvent::MessageEnd {
                stop_reason: StopReason::from_openai(reason),
            }));
        }

        let delta = choice.get("delta");
        let text = |name: &str| delta.and_then(|d| d.get(name)).and_then(Value::as_str);

        if let Some(calls) = delta
            .and_then(|d| d.get("tool_calls"))
            .and_then(Value::as_array)
        {
            return Ok(self.decode_tool_delta(calls));
        }
        // O gateway emite `reasoning_content` em canal separado quando o pedido
        // sinaliza thinking; misturar com o texto visivel entregaria ao usuario
        // conteudo que o modelo nao pretendia mostrar.
        if let Some(chunk) = text("reasoning_content").filter(|c| !c.is_empty()) {
            return Ok(Some(StreamEvent::ReasoningDelta(chunk.to_owned())));
        }
        if let Some(chunk) = text("content").filter(|c| !c.is_empty()) {
            return Ok(Some(StreamEvent::TextDelta(chunk.to_owned())));
        }
        Ok(None)
    }

    fn completed(&self) -> bool {
        self.saw_done
    }

    fn mark_usage_estimated(&mut self) {
        self.usage.estimated = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode_all(events: &[&str]) -> (Vec<StreamEvent>, ChatDecoder) {
        let mut decoder = ChatDecoder::new();
        let mut out = Vec::new();
        for raw in events {
            if let Some(event) = decoder.decode(raw).expect("deveria decodificar") {
                out.push(event);
            }
        }
        (out, decoder)
    }

    #[test]
    fn decodes_a_text_turn_and_reports_usage_at_done() {
        let (events, decoder) = decode_all(&[
            r#"{"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant"},"index":0}]}"#,
            r#"{"choices":[{"delta":{"content":"Ola"},"index":0}]}"#,
            r#"{"choices":[{"delta":{"content":" mundo"},"index":0}]}"#,
            r#"{"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}"#,
            r#"{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4}}"#,
            "[DONE]",
        ]);

        assert_eq!(
            events[0],
            StreamEvent::MessageStart {
                id: "chatcmpl-1".to_owned()
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
        assert_eq!(decoder.usage.input_tokens, 10);
        assert_eq!(decoder.usage.output_tokens, 4);
    }

    #[test]
    fn assembles_a_tool_call_from_indexed_fragments() {
        let (events, _) = decode_all(&[
            r#"{"id":"c1","choices":[{"delta":{"role":"assistant"},"index":0}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"read","arguments":""}}]},"index":0}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"path\":"}}]},"index":0}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"a.rs\"}"}}]},"index":0}]}"#,
            r#"{"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}]}"#,
        ]);

        assert_eq!(
            events[1],
            StreamEvent::ToolCallStart {
                id: "call_a".to_owned(),
                name: "read".to_owned()
            }
        );
        assert_eq!(
            events[2],
            StreamEvent::ToolCallDelta {
                id: "call_a".to_owned(),
                json_fragment: "{\"path\":".to_owned()
            }
        );
        assert_eq!(
            events[4],
            StreamEvent::ToolCallEnd {
                id: "call_a".to_owned()
            }
        );
    }

    #[test]
    fn reasoning_is_kept_out_of_the_visible_text() {
        let (events, _) = decode_all(&[
            r#"{"id":"c","choices":[{"delta":{},"index":0}]}"#,
            r#"{"choices":[{"delta":{"reasoning_content":"pensando"},"index":0}]}"#,
            r#"{"choices":[{"delta":{"content":"resposta"},"index":0}]}"#,
        ]);
        assert_eq!(
            events[1],
            StreamEvent::ReasoningDelta("pensando".to_owned())
        );
        assert_eq!(events[2], StreamEvent::TextDelta("resposta".to_owned()));
    }

    #[test]
    fn content_filter_becomes_refusal_not_a_natural_stop() {
        let (events, _) = decode_all(&[
            r#"{"id":"c","choices":[{"delta":{},"index":0}]}"#,
            r#"{"choices":[{"delta":{},"index":0,"finish_reason":"content_filter"}]}"#,
        ]);
        assert_eq!(
            events[1],
            StreamEvent::MessageEnd {
                stop_reason: StopReason::Refusal
            }
        );
    }

    #[test]
    fn in_band_errors_stop_the_stream() {
        let mut decoder = ChatDecoder::new();
        let err = decoder
            .decode(r#"{"error":{"type":"server_error","message":"caiu"}}"#)
            .expect_err("erro in-band precisa virar Err");
        assert!(matches!(err, Error::Api(api) if api.kind == "server_error"));
        assert!(!decoder.completed());
    }

    #[test]
    fn a_stream_without_done_is_not_complete() {
        // Sem a sentinela, o corpo pode ter sido cortado; declarar completo
        // apresentaria resposta truncada como resposta.
        let (_, decoder) = decode_all(&[r#"{"id":"c","choices":[{"delta":{},"index":0}]}"#]);
        assert!(!decoder.completed());
    }

    #[test]
    fn cache_and_reasoning_details_are_captured_as_subsets() {
        let (_, decoder) = decode_all(&[
            r#"{"id":"c","choices":[{"delta":{},"index":0}]}"#,
            r#"{"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":30,"prompt_tokens_details":{"cached_tokens":80},"completion_tokens_details":{"reasoning_tokens":12}}}"#,
        ]);
        assert_eq!(decoder.usage.cache_read_tokens, 80);
        assert_eq!(decoder.usage.reasoning_tokens, 12);
        assert!(decoder.usage.cache_read_tokens <= decoder.usage.input_tokens);
    }

    #[test]
    fn malformed_json_is_rejected() {
        let mut decoder = ChatDecoder::new();
        assert!(matches!(
            decoder.decode("{nao json"),
            Err(Error::MalformedStream(_))
        ));
    }

    #[test]
    fn the_estimated_flag_propagates() {
        let mut decoder = ChatDecoder::new();
        decoder.mark_usage_estimated();
        assert!(decoder.usage.estimated);
    }
}
