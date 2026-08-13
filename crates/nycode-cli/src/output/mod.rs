//! Para onde vai o que um turno produz.
//!
//! Dois destinos que mudam juntos: acrescentar um evento ao contrato JSON exige
//! decidir o que o texto mostra no lugar dele, e o [`Sink`] é o que impede os
//! dois de divergirem sem ninguém notar.

pub mod events;
pub mod text;

use nycode_agent::{Observer, Outcome, ToolOutput};
use serde_json::Value;

pub use events::Json;
pub use text::Stdout;

/// Como a resposta é apresentada (FR-12).
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum Format {
    /// A resposta em texto, progresso em `stderr`.
    Text,
    /// Um evento JSON por linha, para quem integra o binário.
    Json,
}

/// O destino do turno, escolhido pelo formato.
///
/// Um enum e não dois caminhos em `headless` porque tudo o mais — rodar,
/// persistir, traduzir o código de saída — é idêntico nos dois formatos, e
/// duplicar isso deixaria os dois divergirem com o tempo.
#[derive(Debug)]
pub enum Sink {
    Text(Stdout),
    Json(Json),
}

impl Sink {
    #[must_use]
    pub fn new(format: Format, quiet: bool) -> Self {
        match format {
            Format::Text => Self::Text(Stdout::new(quiet)),
            Format::Json => Self::Json(Json::new()),
        }
    }

    /// Fecha a saída com o desfecho do pedido.
    pub fn finish(&mut self, outcome: &Result<Outcome, nycode_agent::Error>) {
        match self {
            Self::Text(sink) => sink.finish(),
            Self::Json(sink) => sink.finish(outcome),
        }
    }
}

impl Observer for Sink {
    fn on_text(&mut self, chunk: &str) {
        match self {
            Self::Text(sink) => sink.on_text(chunk),
            Self::Json(sink) => sink.on_text(chunk),
        }
    }
    fn on_reasoning(&mut self, chunk: &str) {
        match self {
            Self::Text(sink) => sink.on_reasoning(chunk),
            Self::Json(sink) => sink.on_reasoning(chunk),
        }
    }
    fn on_tool_start(&mut self, name: &str, input: &Value) {
        match self {
            Self::Text(sink) => sink.on_tool_start(name, input),
            Self::Json(sink) => sink.on_tool_start(name, input),
        }
    }
    fn on_tool_end(&mut self, name: &str, output: &ToolOutput) {
        match self {
            Self::Text(sink) => sink.on_tool_end(name, output),
            Self::Json(sink) => sink.on_tool_end(name, output),
        }
    }
    fn on_notice(&mut self, text: &str) {
        match self {
            Self::Text(sink) => sink.on_notice(text),
            Self::Json(sink) => sink.on_notice(text),
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    fn call() -> Value {
        serde_json::json!({ "path": "a.rs" })
    }

    /// O que cada formato escreve, para o mesmo turno.
    fn produced(format: Format) -> Sink {
        let mut sink = Sink::new(format, true);
        sink.on_reasoning("pensando");
        sink.on_text("a resposta");
        sink.on_tool_start("read", &call());
        sink.on_tool_end("read", &ToolOutput::ok("conteudo"));
        sink.on_notice("contexto compactado");
        sink.finish(&Ok(Outcome {
            text: "a resposta".to_owned(),
            stop_reason: nycode_ai::StopReason::EndTurn,
            tool_rounds: 1,
            usage: nycode_ai::Usage::default(),
        }));
        sink
    }

    #[test]
    fn the_format_chooses_the_destination() {
        assert!(matches!(Sink::new(Format::Text, true), Sink::Text(_)));
        assert!(matches!(Sink::new(Format::Json, true), Sink::Json(_)));
    }

    #[test]
    fn every_event_reaches_both_destinations_without_panicking() {
        // O `Sink` existe para impedir que os dois formatos divirjam; um
        // metodo esquecido num dos bracos so apareceria em producao.
        let _ = produced(Format::Text);
        let _ = produced(Format::Json);
    }

    #[test]
    fn a_failed_run_is_reported_by_both() {
        for format in [Format::Text, Format::Json] {
            let mut sink = Sink::new(format, true);
            sink.finish(&Err(nycode_agent::Error::Cancelled));
        }
    }

    #[test]
    fn the_debug_view_names_which_destination_is_in_use() {
        assert!(format!("{:?}", Sink::new(Format::Text, true)).contains("Text"));
        assert!(format!("{:?}", Sink::new(Format::Json, true)).contains("Json"));
    }
}
