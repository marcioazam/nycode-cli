//! Projeção do stream de Chat Completions.

use std::collections::{HashMap, VecDeque};

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
///
/// Este é o dialeto que mais empacota evento numa linha só: um chunk pode abrir
/// duas chamadas de uma vez, e o chunk de `finish_reason` precisa fechar todas
/// as que ficaram abertas *e* encerrar a mensagem. Como `decode` devolve um
/// evento por linha, o excedente fica na fila e sai por [`Self::drain`].
#[derive(Debug, Default)]
pub struct ChatDecoder {
    tool_ids: HashMap<u64, String>,
    open_tools: Vec<String>,
    pending: VecDeque<StreamEvent>,
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

    /// Projeta uma entrada do array `tool_calls` para a fila.
    ///
    /// Abertura e argumentos podem vir no mesmo fragmento, e são dois eventos:
    /// tratar o chunk como "ou um ou outro" trunca o JSON da chamada logo no
    /// começo, e o modelo recebe de volta um erro de parse que ele não causou.
    fn absorb_tool_call(&mut self, call: &Value) {
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
            self.pending.push_back(StreamEvent::ToolCallStart {
                id: id.to_owned(),
                name,
            });
        }

        let fragment = function
            .and_then(|f| f.get("arguments"))
            .and_then(Value::as_str)
            .filter(|fragment| !fragment.is_empty());
        if let Some(fragment) = fragment
            && let Some(id) = self.tool_ids.get(&index)
        {
            self.pending.push_back(StreamEvent::ToolCallDelta {
                id: id.clone(),
                json_fragment: fragment.to_owned(),
            });
        }
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
            // Fechar as ferramentas que ficaram abertas e encerrar a mensagem
            // sao coisas distintas que chegam na mesma linha. Entregar so uma
            // delas deixa o turno sem `stop_reason`, e o agente encerra dando o
            // pedido por concluido sem executar a ferramenta.
            for id in std::mem::take(&mut self.open_tools) {
                self.pending.push_back(StreamEvent::ToolCallEnd { id });
            }
            self.pending.push_back(StreamEvent::MessageEnd {
                stop_reason: StopReason::from_openai(reason),
            });
            return Ok(self.pending.pop_front());
        }

        let delta = choice.get("delta");
        let text = |name: &str| delta.and_then(|d| d.get(name)).and_then(Value::as_str);

        if let Some(calls) = delta
            .and_then(|d| d.get("tool_calls"))
            .and_then(Value::as_array)
        {
            for call in calls {
                self.absorb_tool_call(call);
            }
            return Ok(self.pending.pop_front());
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

    fn drain(&mut self) -> Option<StreamEvent> {
        self.pending.pop_front()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reproduz a ordem de `stream::decode`: drena antes de cada linha e de
    /// novo no encerramento. Um helper que não drenasse veria só o primeiro
    /// evento de cada linha, que é exatamente o defeito que se quer pegar.
    fn decode_all(events: &[&str]) -> (Vec<StreamEvent>, ChatDecoder) {
        let mut decoder = ChatDecoder::new();
        let mut out = Vec::new();
        for raw in events {
            while let Some(event) = decoder.drain() {
                out.push(event);
            }
            if let Some(event) = decoder.decode(raw).expect("deveria decodificar") {
                out.push(event);
            }
        }
        while let Some(event) = decoder.drain() {
            out.push(event);
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
    fn a_tool_turn_reports_tool_use_and_closes_every_open_call() {
        // O `finish_reason` e o fechamento da ferramenta caem na mesma linha do
        // wire. Emitir so um dos dois deixa o turno sem `stop_reason`, e o
        // agente encerra sem executar a ferramenta que o modelo pediu.
        let (events, _) = decode_all(&[
            r#"{"id":"c1","choices":[{"delta":{"role":"assistant"},"index":0}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"read","arguments":""}}]},"index":0}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]},"index":0}]}"#,
            r#"{"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}]}"#,
            "[DONE]",
        ]);

        assert!(
            events.contains(&StreamEvent::ToolCallEnd {
                id: "call_a".to_owned()
            }),
            "a chamada aberta precisa ser fechada: {events:?}"
        );
        assert!(
            events.contains(&StreamEvent::MessageEnd {
                stop_reason: StopReason::ToolUse
            }),
            "sem o MessageEnd o agente nao executa a ferramenta: {events:?}"
        );
    }

    #[test]
    fn two_parallel_calls_in_one_chunk_are_both_announced() {
        // O array `tool_calls` pode trazer mais de uma chamada no mesmo chunk.
        // Ler so a primeira perde a outra sem deixar rastro.
        let (events, _) = decode_all(&[
            r#"{"id":"c1","choices":[{"delta":{"role":"assistant"},"index":0}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"read","arguments":""}},{"index":1,"id":"call_b","function":{"name":"grep","arguments":""}}]},"index":0}]}"#,
            r#"{"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}]}"#,
            "[DONE]",
        ]);

        for (id, name) in [("call_a", "read"), ("call_b", "grep")] {
            assert!(
                events.contains(&StreamEvent::ToolCallStart {
                    id: id.to_owned(),
                    name: name.to_owned()
                }),
                "{id} precisa ser anunciada: {events:?}"
            );
            assert!(
                events.contains(&StreamEvent::ToolCallEnd { id: id.to_owned() }),
                "{id} precisa ser fechada: {events:?}"
            );
        }
    }

    #[test]
    fn arguments_that_ride_along_with_the_opening_fragment_are_not_lost() {
        // Backends compativeis mandam `id`, `name` e o comeco dos argumentos no
        // mesmo fragmento. Descartar o pedaco trunca o JSON da chamada.
        let (events, _) = decode_all(&[
            r#"{"id":"c1","choices":[{"delta":{"role":"assistant"},"index":0}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"read","arguments":"{\"path\":"}}]},"index":0}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"a.rs\"}"}}]},"index":0}]}"#,
            r#"{"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}]}"#,
            "[DONE]",
        ]);

        let montado: String = events
            .iter()
            .filter_map(|event| match event {
                StreamEvent::ToolCallDelta { json_fragment, .. } => Some(json_fragment.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(montado, r#"{"path":"a.rs"}"#, "{events:?}");
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
