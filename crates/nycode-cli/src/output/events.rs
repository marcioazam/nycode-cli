//! Modo de eventos JSON (FR-12).
//!
//! Uma linha de JSON por evento, em stdout. Existe para quem integra o binário:
//! um script que precisa saber quais ferramentas rodaram, ou quanto o turno
//! custou, não deveria ter de inferir isso de texto formatado para humano.
//!
//! A regra de que stdout carrega só a resposta continua valendo — o formato da
//! resposta é que muda, e só quando o usuário pede. O progresso de ferramenta
//! deixa de ir para stderr neste modo porque ele passou a ser parte do
//! contrato, e um consumidor que lesse dois fluxos perderia a ordem entre eles.

use std::io::Write;

use nycode_agent::{Observer, Outcome, ToolOutput};
use nycode_ai::Usage;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Um evento do stream de saída.
///
/// A etiqueta é `type`, que é a convenção que os outros harnesses usam e a que
/// um consumidor já espera encontrar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// Fragmento de texto visível.
    Text {
        text: String,
    },
    /// Fragmento de raciocínio, quando o backend o expõe em canal separado.
    Reasoning {
        text: String,
    },
    ToolStart {
        name: String,
        input: Value,
    },
    ToolEnd {
        name: String,
        is_error: bool,
        output: String,
    },
    /// Algo aconteceu com a sessão.
    Notice {
        text: String,
    },
    /// Fim do pedido, com o contrato observável completo.
    Result {
        stop_reason: String,
        usage: Usage,
        tool_rounds: usize,
    },
    /// O pedido terminou em erro.
    Error {
        message: String,
    },
}

/// Observador que publica eventos NDJSON.
#[derive(Debug)]
pub struct Json<W: Write = std::io::Stdout> {
    out: W,
}

impl Json {
    pub fn new() -> Self {
        Self::to(std::io::stdout())
    }
}

impl<W: Write> Json<W> {
    pub const fn to(out: W) -> Self {
        Self { out }
    }

    /// Publica um evento.
    ///
    /// Uma falha de escrita normalmente é um pipe fechado. Derrubar o turno por
    /// isso perderia o trabalho que as ferramentas já fizeram.
    pub fn emit(&mut self, event: &Event) {
        let Ok(line) = serde_json::to_string(event) else {
            return;
        };
        let _ = writeln!(self.out, "{line}");
        let _ = self.out.flush();
    }

    /// Publica o evento final a partir do desfecho do pedido.
    pub fn finish(&mut self, outcome: &Result<Outcome, nycode_agent::Error>) {
        let event = match outcome {
            Ok(outcome) => Event::Result {
                stop_reason: outcome.stop_reason.to_string(),
                usage: outcome.usage,
                tool_rounds: outcome.tool_rounds,
            },
            Err(err) => Event::Error {
                message: err.to_string(),
            },
        };
        self.emit(&event);
    }

    #[cfg(test)]
    pub fn into_inner(self) -> W {
        self.out
    }
}

impl<W: Write + Send> Observer for Json<W> {
    fn on_text(&mut self, chunk: &str) {
        if chunk.is_empty() {
            return;
        }
        self.emit(&Event::Text {
            text: chunk.to_owned(),
        });
    }

    fn on_reasoning(&mut self, chunk: &str) {
        if chunk.is_empty() {
            return;
        }
        self.emit(&Event::Reasoning {
            text: chunk.to_owned(),
        });
    }

    fn on_tool_start(&mut self, name: &str, input: &Value) {
        self.emit(&Event::ToolStart {
            name: name.to_owned(),
            input: input.clone(),
        });
    }

    fn on_tool_end(&mut self, name: &str, output: &ToolOutput) {
        self.emit(&Event::ToolEnd {
            name: name.to_owned(),
            is_error: output.is_error,
            output: output.content.clone(),
        });
    }

    fn on_notice(&mut self, text: &str) {
        self.emit(&Event::Notice {
            text: text.to_owned(),
        });
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use nycode_ai::StopReason;
    use serde_json::json;

    fn sink() -> Json<Vec<u8>> {
        Json::to(Vec::new())
    }

    fn lines(sink: Json<Vec<u8>>) -> Vec<Event> {
        String::from_utf8(sink.into_inner())
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).expect("cada linha e um evento"))
            .collect()
    }

    #[test]
    fn every_event_is_one_json_object_on_its_own_line() {
        // O consumidor le linha a linha; um objeto quebrado em duas linhas
        // exigiria dele um parser de streaming.
        let mut sink = sink();
        sink.on_text("parte um");
        sink.on_text("parte dois");

        let raw = String::from_utf8(sink.into_inner()).unwrap();
        assert_eq!(raw.lines().count(), 2);
        for line in raw.lines() {
            let _: Event = serde_json::from_str(line).unwrap();
        }
    }

    #[test]
    fn the_tool_sequence_is_part_of_the_contract() {
        // E a dimensao que o harness de paridade nao conseguia comparar; sem
        // ela a comparacao era vazia dos dois lados.
        let mut sink = sink();
        sink.on_tool_start("read", &json!({ "path": "a.rs" }));
        sink.on_tool_end("read", &ToolOutput::ok("conteudo"));

        let events = lines(sink);
        assert_eq!(
            events[0],
            Event::ToolStart {
                name: "read".to_owned(),
                input: json!({ "path": "a.rs" })
            }
        );
        assert_eq!(
            events[1],
            Event::ToolEnd {
                name: "read".to_owned(),
                is_error: false,
                output: "conteudo".to_owned()
            }
        );
    }

    #[test]
    fn a_tool_failure_keeps_its_flag_in_the_stream() {
        let mut sink = sink();
        sink.on_tool_end("bash", &ToolOutput::error("codigo de saida 1"));

        assert_eq!(
            lines(sink)[0],
            Event::ToolEnd {
                name: "bash".to_owned(),
                is_error: true,
                output: "codigo de saida 1".to_owned()
            }
        );
    }

    #[test]
    fn the_final_event_carries_the_stop_reason_and_the_usage() {
        let mut sink = sink();
        sink.finish(&Ok(Outcome {
            text: "pronto".to_owned(),
            stop_reason: StopReason::EndTurn,
            tool_rounds: 2,
            usage: Usage {
                input_tokens: 100,
                output_tokens: 20,
                ..Usage::default()
            },
        }));

        match &lines(sink)[0] {
            Event::Result {
                stop_reason,
                usage,
                tool_rounds,
            } => {
                assert_eq!(stop_reason, "end_turn");
                assert_eq!(usage.input_tokens, 100);
                assert_eq!(*tool_rounds, 2);
            }
            other => panic!("esperava Result, veio {other:?}"),
        }
    }

    #[test]
    fn an_unrecognized_stop_reason_survives_into_the_stream() {
        // Achatar para `end_turn` faria uma parada desconhecida parecer
        // conclusao normal, que e o que o NFR-4 proibe.
        let mut sink = sink();
        sink.finish(&Ok(Outcome {
            text: String::new(),
            stop_reason: StopReason::Unrecognized("novo_motivo".to_owned()),
            tool_rounds: 0,
            usage: Usage::default(),
        }));

        match &lines(sink)[0] {
            Event::Result { stop_reason, .. } => {
                assert!(stop_reason.contains("novo_motivo"), "{stop_reason}");
            }
            other => panic!("esperava Result, veio {other:?}"),
        }
    }

    #[test]
    fn a_failed_run_ends_with_an_error_event_not_a_result() {
        // Terminar com `Result` faria um consumidor tratar a falha como turno
        // concluido.
        let mut sink = sink();
        sink.finish(&Err(nycode_agent::Error::Cancelled));

        match &lines(sink)[0] {
            Event::Error { message } => assert!(message.contains("cancelado"), "{message}"),
            other => panic!("esperava Error, veio {other:?}"),
        }
    }

    #[test]
    fn a_session_notice_reaches_the_stream() {
        let mut sink = sink();
        sink.on_notice("contexto compactado");
        assert_eq!(
            lines(sink)[0],
            Event::Notice {
                text: "contexto compactado".to_owned()
            }
        );
    }

    #[test]
    fn reasoning_stays_a_separate_kind_from_the_answer() {
        // Mistura-lo com o texto visivel entregaria o raciocinio ao usuario
        // como se fosse resposta.
        let mut sink = sink();
        sink.on_reasoning("deixa eu pensar");
        sink.on_text("a resposta");

        let events = lines(sink);
        assert!(matches!(events[0], Event::Reasoning { .. }));
        assert!(matches!(events[1], Event::Text { .. }));
    }

    #[test]
    fn empty_chunks_do_not_become_events() {
        // Um delta vazio nao e informacao; publicá-lo so gasta linha.
        let mut sink = sink();
        sink.on_text("");
        sink.on_reasoning("");
        assert!(sink.into_inner().is_empty());
    }

    #[test]
    fn a_closed_pipe_does_not_take_the_turn_down() {
        // As ferramentas ja rodaram; morrer aqui perderia o trabalho delas.
        struct Broken;
        impl Write for Broken {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::Error::from(std::io::ErrorKind::BrokenPipe))
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Err(std::io::Error::from(std::io::ErrorKind::BrokenPipe))
            }
        }

        let mut sink = Json::to(Broken);
        sink.on_text("nao chega a lugar nenhum");
        sink.finish(&Err(nycode_agent::Error::Cancelled));
    }

    #[test]
    fn the_events_round_trip_through_serde() {
        // O harness de paridade le de volta o que o binario escreveu; uma
        // etiqueta que nao desserializa quebraria a comparacao em silencio.
        let events = [
            Event::Text {
                text: "a".to_owned(),
            },
            Event::Reasoning {
                text: "b".to_owned(),
            },
            Event::ToolStart {
                name: "read".to_owned(),
                input: json!({}),
            },
            Event::ToolEnd {
                name: "read".to_owned(),
                is_error: false,
                output: "c".to_owned(),
            },
            Event::Notice {
                text: "d".to_owned(),
            },
            Event::Result {
                stop_reason: "end_turn".to_owned(),
                usage: Usage::default(),
                tool_rounds: 0,
            },
            Event::Error {
                message: "e".to_owned(),
            },
        ];

        for event in events {
            let raw = serde_json::to_string(&event).unwrap();
            let back: Event = serde_json::from_str(&raw).unwrap();
            assert_eq!(back, event);
        }
    }
}
