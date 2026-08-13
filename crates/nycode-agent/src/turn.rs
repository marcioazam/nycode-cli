//! Acumulação de um turno a partir do stream de eventos.

use std::collections::HashMap;

use nycode_ai::{StopReason, StreamEvent, Usage};
use serde_json::Value;

use crate::tool::ToolCall;

/// Uma chamada de ferramenta ainda sendo montada a partir de fragmentos.
#[derive(Debug, Clone)]
struct PartialCall {
    name: String,
    /// Ordem de chegada, preservada para que a execução siga a ordem em que o
    /// modelo pediu. `HashMap` não tem ordem e duas chamadas trocadas mudam o
    /// resultado quando uma depende do efeito da outra.
    seq: usize,
    json: String,
}

/// Estado observável de um turno em andamento.
#[derive(Debug, Default)]
pub struct Turn {
    text: String,
    reasoning: String,
    partial: HashMap<String, PartialCall>,
    completed: Vec<String>,
    stop_reason: Option<StopReason>,
    usage: Usage,
    next_seq: usize,
}

impl Turn {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Absorve um evento do stream.
    pub fn absorb(&mut self, event: StreamEvent) {
        match event {
            StreamEvent::TextDelta(chunk) => self.text.push_str(&chunk),
            StreamEvent::ReasoningDelta(chunk) => self.reasoning.push_str(&chunk),
            StreamEvent::ToolCallStart { id, name } => {
                let seq = self.next_seq;
                self.next_seq += 1;
                self.partial.insert(
                    id,
                    PartialCall {
                        name,
                        seq,
                        json: String::new(),
                    },
                );
            }
            StreamEvent::ToolCallDelta { id, json_fragment } => {
                if let Some(call) = self.partial.get_mut(&id) {
                    call.json.push_str(&json_fragment);
                }
            }
            StreamEvent::ToolCallEnd { id } => self.completed.push(id),
            StreamEvent::Usage(usage) => self.usage = usage,
            StreamEvent::MessageEnd { stop_reason } => self.stop_reason = Some(stop_reason),
            StreamEvent::MessageStart { .. } => {}
        }
    }

    #[must_use]
    pub fn text(&self) -> &str {
        &self.text
    }

    #[must_use]
    pub fn reasoning(&self) -> &str {
        &self.reasoning
    }

    #[must_use]
    pub const fn usage(&self) -> Usage {
        self.usage
    }

    #[must_use]
    pub const fn stop_reason(&self) -> Option<&StopReason> {
        self.stop_reason.as_ref()
    }

    /// Chamadas prontas para execução, na ordem em que o modelo as pediu.
    ///
    /// Uma chamada cujos argumentos não formam JSON válido é devolvida com
    /// `input` nulo e o erro de parse chega ao modelo como resultado, em vez de
    /// derrubar o turno: o modelo consegue corrigir a própria chamada.
    #[must_use]
    pub fn tool_calls(&self) -> Vec<ToolCall> {
        let mut calls: Vec<_> = self
            .completed
            .iter()
            .filter_map(|id| self.partial.get(id).map(|call| (id, call)))
            .collect();
        calls.sort_by_key(|(_, call)| call.seq);

        calls
            .into_iter()
            .map(|(id, call)| ToolCall {
                id: id.clone(),
                name: call.name.clone(),
                // Uma chamada sem argumentos chega com string vazia, que nao e
                // JSON valido mas significa objeto vazio.
                input: if call.json.trim().is_empty() {
                    Value::Object(serde_json::Map::new())
                } else {
                    serde_json::from_str(&call.json).unwrap_or(Value::Null)
                },
            })
            .collect()
    }

    /// Se o turno terminou pedindo execução de ferramentas.
    #[must_use]
    pub fn wants_tools(&self) -> bool {
        self.stop_reason
            .as_ref()
            .is_some_and(StopReason::wants_tools)
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    fn turn_from(events: Vec<StreamEvent>) -> Turn {
        let mut turn = Turn::new();
        for event in events {
            turn.absorb(event);
        }
        turn
    }

    #[test]
    fn concatenates_text_deltas_in_order() {
        let turn = turn_from(vec![
            StreamEvent::TextDelta("Ola".into()),
            StreamEvent::TextDelta(", ".into()),
            StreamEvent::TextDelta("mundo".into()),
        ]);
        assert_eq!(turn.text(), "Ola, mundo");
    }

    #[test]
    fn keeps_reasoning_out_of_the_visible_text() {
        let turn = turn_from(vec![
            StreamEvent::ReasoningDelta("pensando".into()),
            StreamEvent::TextDelta("resposta".into()),
        ]);
        assert_eq!(turn.text(), "resposta");
        assert_eq!(turn.reasoning(), "pensando");
    }

    #[test]
    fn assembles_tool_arguments_from_fragments() {
        let turn = turn_from(vec![
            StreamEvent::ToolCallStart {
                id: "t1".into(),
                name: "read".into(),
            },
            StreamEvent::ToolCallDelta {
                id: "t1".into(),
                json_fragment: "{\"path\":".into(),
            },
            StreamEvent::ToolCallDelta {
                id: "t1".into(),
                json_fragment: "\"a.rs\"}".into(),
            },
            StreamEvent::ToolCallEnd { id: "t1".into() },
        ]);

        let calls = turn.tool_calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "read");
        assert_eq!(calls[0].input["path"], "a.rs");
    }

    #[test]
    fn preserves_the_order_the_model_requested() {
        // Duas chamadas onde a segunda depende do efeito da primeira mudam de
        // resultado se executadas trocadas. HashMap nao tem ordem, entao a
        // sequencia precisa ser explicita.
        let mut events = vec![
            StreamEvent::ToolCallStart {
                id: "primeira".into(),
                name: "write".into(),
            },
            StreamEvent::ToolCallStart {
                id: "segunda".into(),
                name: "read".into(),
            },
        ];
        events.push(StreamEvent::ToolCallEnd {
            id: "segunda".into(),
        });
        events.push(StreamEvent::ToolCallEnd {
            id: "primeira".into(),
        });

        let calls = turn_from(events).tool_calls();
        assert_eq!(
            calls[0].id, "primeira",
            "a ordem de pedido do modelo foi perdida"
        );
        assert_eq!(calls[1].id, "segunda");
    }

    #[test]
    fn interleaved_fragments_stay_with_their_own_call() {
        let turn = turn_from(vec![
            StreamEvent::ToolCallStart {
                id: "a".into(),
                name: "read".into(),
            },
            StreamEvent::ToolCallStart {
                id: "b".into(),
                name: "read".into(),
            },
            StreamEvent::ToolCallDelta {
                id: "a".into(),
                json_fragment: "{\"path\":\"a".into(),
            },
            StreamEvent::ToolCallDelta {
                id: "b".into(),
                json_fragment: "{\"path\":\"b".into(),
            },
            StreamEvent::ToolCallDelta {
                id: "a".into(),
                json_fragment: ".rs\"}".into(),
            },
            StreamEvent::ToolCallDelta {
                id: "b".into(),
                json_fragment: ".rs\"}".into(),
            },
            StreamEvent::ToolCallEnd { id: "a".into() },
            StreamEvent::ToolCallEnd { id: "b".into() },
        ]);

        let calls = turn.tool_calls();
        assert_eq!(calls[0].input["path"], "a.rs");
        assert_eq!(calls[1].input["path"], "b.rs");
    }

    #[test]
    fn an_unfinished_call_is_not_executed() {
        // Sem `content_block_stop` os argumentos podem estar pela metade.
        // Executar assim rodaria a ferramenta com parametros truncados.
        let turn = turn_from(vec![
            StreamEvent::ToolCallStart {
                id: "t1".into(),
                name: "bash".into(),
            },
            StreamEvent::ToolCallDelta {
                id: "t1".into(),
                json_fragment: "{\"cmd\":\"rm ".into(),
            },
        ]);
        assert!(turn.tool_calls().is_empty());
    }

    #[test]
    fn empty_arguments_become_an_empty_object_not_null() {
        let turn = turn_from(vec![
            StreamEvent::ToolCallStart {
                id: "t1".into(),
                name: "ls".into(),
            },
            StreamEvent::ToolCallEnd { id: "t1".into() },
        ]);
        assert_eq!(
            turn.tool_calls()[0].input,
            Value::Object(serde_json::Map::new())
        );
    }

    #[test]
    fn malformed_arguments_surface_as_null_rather_than_panicking() {
        let turn = turn_from(vec![
            StreamEvent::ToolCallStart {
                id: "t1".into(),
                name: "read".into(),
            },
            StreamEvent::ToolCallDelta {
                id: "t1".into(),
                json_fragment: "{isto nao e json".into(),
            },
            StreamEvent::ToolCallEnd { id: "t1".into() },
        ]);
        assert_eq!(turn.tool_calls()[0].input, Value::Null);
    }

    #[test]
    fn wants_tools_reflects_the_stop_reason() {
        let mut turn = Turn::new();
        assert!(
            !turn.wants_tools(),
            "sem stop_reason nao ha pedido de ferramenta"
        );

        turn.absorb(StreamEvent::MessageEnd {
            stop_reason: StopReason::ToolUse,
        });
        assert!(turn.wants_tools());

        let mut done = Turn::new();
        done.absorb(StreamEvent::MessageEnd {
            stop_reason: StopReason::EndTurn,
        });
        assert!(!done.wants_tools());
    }

    #[test]
    fn records_usage_and_stop_reason() {
        let usage = Usage {
            input_tokens: 100,
            output_tokens: 20,
            ..Usage::default()
        };
        let turn = turn_from(vec![
            StreamEvent::MessageEnd {
                stop_reason: StopReason::Refusal,
            },
            StreamEvent::Usage(usage),
        ]);
        assert_eq!(turn.usage(), usage);
        assert_eq!(turn.stop_reason(), Some(&StopReason::Refusal));
    }
}
