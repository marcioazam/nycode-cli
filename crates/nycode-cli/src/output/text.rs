//! Apresentação de um turno em texto, para quem lê a saída.

use std::io::Write;

use nycode_agent::{Observer, ToolOutput, sanitize};
use serde_json::Value;

/// Escreve texto incrementalmente e anota chamadas de ferramenta no progresso.
///
/// A separação importa: stdout carrega só a resposta, o que torna
/// `nycode -p "..."` utilizável num pipe. O ruído de progresso vai para stderr.
/// Os dois destinos são parâmetros de tipo porque é o único jeito de afirmar num
/// teste o que a apresentação produz — inclusive que o modo silencioso não
/// produz nada.
///
/// O padrão guarda o `Stdout` e não um `StdoutLock`: o guard não é `Send`, e o
/// observador precisa atravessar o `await` do loop de agente.
#[derive(Debug)]
pub struct Stdout<W: Write = std::io::Stdout, P: Write = std::io::Stderr> {
    out: W,
    progress: P,
    quiet: bool,
    wrote_any_text: bool,
}

impl Stdout {
    pub fn new(quiet: bool) -> Self {
        Self::with_writers(std::io::stdout(), std::io::stderr(), quiet)
    }
}

impl<W: Write, P: Write> Stdout<W, P> {
    pub fn with_writers(out: W, progress: P, quiet: bool) -> Self {
        Self {
            out,
            progress,
            quiet,
            wrote_any_text: false,
        }
    }

    /// Fecha a saída.
    ///
    /// A newline final só sai se algum texto foi escrito: um turno que só
    /// executou ferramentas não deve terminar com uma linha em branco solta.
    pub fn finish(&mut self) {
        if self.wrote_any_text {
            let _ = self.out.write_all(b"\n");
        }
        let _ = self.out.flush();
    }

    /// Devolve os dois destinos. Existe para o teste afirmar o que foi escrito;
    /// o binário nunca desmonta o observador.
    #[cfg(test)]
    pub fn into_inner(self) -> (W, P) {
        (self.out, self.progress)
    }
}

impl<W: Write + Send, P: Write + Send> Observer for Stdout<W, P> {
    fn on_text(&mut self, chunk: &str) {
        if !chunk.is_empty() {
            self.wrote_any_text = true;
        }
        // Um erro de escrita em stdout normalmente e um pipe fechado. Derrubar o
        // turno por isso perderia o trabalho ja feito pelas ferramentas.
        let _ = self.out.write_all(chunk.as_bytes());
        let _ = self.out.flush();
    }

    fn on_tool_start(&mut self, name: &str, input: &Value) {
        if self.quiet {
            return;
        }
        let summary = summarize(input);
        let _ = writeln!(self.progress, "  \u{2022} {name}({summary})");
    }

    fn on_notice(&mut self, text: &str) {
        // Aparece mesmo em modo silencioso: compactar muda o que o modelo
        // lembra, e o usuario precisa poder explicar um esquecimento.
        let _ = writeln!(self.progress, "  \u{2139} {text}");
    }

    fn on_tool_end(&mut self, name: &str, output: &ToolOutput) {
        if self.quiet || !output.is_error {
            return;
        }
        // Falha de ferramenta sempre aparece, mesmo em modo silencioso reduzido:
        // e a informacao que explica um resultado estranho.
        let _ = writeln!(
            self.progress,
            "  \u{2717} {name}: {}",
            sanitize::plain(first_line(&output.content))
        );
    }
}

/// Resumo de uma linha dos argumentos, para não despejar JSON no terminal.
///
/// Chave e valor vêm do modelo, então passam pela limpeza — e passam **antes**
/// do corte: limpar depois deixaria um escape partido ao meio, cujo resto
/// chegaria à tela como texto.
fn summarize(input: &Value) -> String {
    let Some(obj) = input.as_object() else {
        return String::new();
    };
    obj.iter()
        .map(|(key, value)| {
            let rendered = match value {
                Value::String(s) => truncate(&sanitize::plain(s), 60),
                other => truncate(&sanitize::plain(&other.to_string()), 60),
            };
            format!("{}={rendered}", sanitize::plain(key))
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn first_line(text: &str) -> &str {
    text.lines().next().unwrap_or(text)
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let kept: String = text.chars().take(max).collect();
    format!("{kept}...")
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Observador ligado a buffers, para afirmar o que a apresentação produz.
    fn sink(quiet: bool) -> Stdout<Vec<u8>, Vec<u8>> {
        Stdout::with_writers(Vec::new(), Vec::new(), quiet)
    }

    fn written(sink: Stdout<Vec<u8>, Vec<u8>>) -> (String, String) {
        let (out, progress) = sink.into_inner();
        (
            String::from_utf8(out).unwrap(),
            String::from_utf8(progress).unwrap(),
        )
    }

    #[test]
    fn the_answer_goes_to_stdout_and_nothing_else_does() {
        // A separacao e o que torna `nycode -p` utilizavel num pipe.
        let mut sink = sink(false);
        sink.on_text("resposta");
        sink.on_tool_start("read", &json!({ "path": "a.rs" }));

        let (out, progress) = written(sink);
        assert_eq!(out, "resposta");
        assert!(progress.contains("read"));
    }

    #[test]
    fn a_turn_that_produced_text_ends_with_a_newline() {
        let mut sink = sink(false);
        sink.on_text("resposta");
        sink.finish();

        assert_eq!(written(sink).0, "resposta\n");
    }

    #[test]
    fn a_turn_that_produced_no_text_does_not_end_with_a_blank_line() {
        // So ferramentas rodaram: uma newline solta poluiria o pipe.
        let mut sink = sink(false);
        sink.on_tool_start("bash", &json!({ "cmd": "ls" }));
        sink.finish();

        assert_eq!(written(sink).0, "");
    }

    #[test]
    fn an_empty_chunk_does_not_count_as_text() {
        let mut sink = sink(false);
        sink.on_text("");
        sink.finish();

        assert_eq!(written(sink).0, "");
    }

    #[test]
    fn quiet_mode_silences_tool_progress() {
        let mut sink = sink(true);
        sink.on_tool_start("bash", &json!({ "cmd": "ls" }));
        sink.on_tool_end("bash", &ToolOutput::error("falhou"));

        let (out, progress) = written(sink);
        assert_eq!(progress, "", "modo silencioso nao escreve progresso");
        assert_eq!(out, "");
    }

    #[test]
    fn a_session_notice_appears_even_in_quiet_mode() {
        // Compactar muda o que o modelo lembra. Esconder isso deixaria o
        // usuario sem explicacao para um esquecimento.
        let mut sink = sink(true);
        sink.on_notice("contexto estourou; 12 mensagens antigas foram compactadas");

        let (out, progress) = written(sink);
        assert!(progress.contains("compactadas"), "{progress}");
        assert_eq!(out, "", "aviso nao pode poluir o stdout de um pipe");
    }

    #[test]
    fn a_tool_failure_is_reported_but_a_success_is_not() {
        // O sucesso ja aparece na resposta; a falha e o que explica um
        // resultado estranho.
        let mut sink = sink(false);
        sink.on_tool_end("read", &ToolOutput::ok("conteudo"));
        sink.on_tool_end("bash", &ToolOutput::error("comando nao encontrado"));

        let progress = written(sink).1;
        assert!(!progress.contains("read"));
        assert!(progress.contains("bash: comando nao encontrado"));
    }

    #[test]
    fn a_multiline_tool_failure_is_reported_by_its_first_line_only() {
        let mut sink = sink(false);
        sink.on_tool_end("bash", &ToolOutput::error("erro\nstack\ntrace"));

        let progress = written(sink).1;
        assert!(progress.contains("erro"));
        assert!(!progress.contains("stack"));
    }

    #[test]
    fn a_tool_failure_cannot_repaint_the_terminal_on_its_way_to_the_screen() {
        // A mensagem de erro carrega saida do comando, que e conteudo de
        // terceiro. Com o escape intacto ela sobe duas linhas e escreve por
        // cima do que ja estava ali — que pode ter sido a pergunta de aprovacao.
        let mut sink = sink(false);
        sink.on_tool_end(
            "bash",
            &ToolOutput::error("\u{1b}[2A\u{1b}[2Kaprovar? (s/n)"),
        );

        let progress = written(sink).1;
        assert!(!progress.contains('\u{1b}'), "{progress:?}");
        assert!(progress.contains("aprovar? (s/n)"), "{progress}");
    }

    #[test]
    fn an_argument_cannot_smuggle_terminal_control_into_the_progress_line() {
        // O argumento vem do modelo, que pode ser induzido a emiti-lo.
        let summary = summarize(&json!({ "command": "echo \u{1b}]0;titulo\u{7}oi" }));
        assert_eq!(summary, "command=echo oi");
    }

    #[test]
    fn cleaning_happens_before_truncation_so_no_escape_is_cut_in_half() {
        // Limpar depois do corte deixaria o resto de uma sequencia partida
        // chegar a tela como texto.
        let escape_longo = format!("\u{1b}[38;2;255;0;0m{}", "a".repeat(80));
        let summary = summarize(&json!({ "x": escape_longo }));

        assert!(!summary.contains('\u{1b}'), "{summary:?}");
        assert!(summary.starts_with("x=aaa"), "{summary}");
    }

    #[test]
    fn summarizes_object_arguments_as_key_values() {
        let summary = summarize(&json!({ "path": "src/main.rs" }));
        assert_eq!(summary, "path=src/main.rs");
    }

    #[test]
    fn truncates_long_arguments_instead_of_flooding_the_terminal() {
        let long = "x".repeat(200);
        let summary = summarize(&json!({ "cmd": long }));
        assert!(summary.ends_with("..."));
        assert!(summary.len() < 100);
    }

    #[test]
    fn non_string_argument_values_are_rendered_as_json() {
        // Um numero ou booleano nao passa pelo braco de string; renderizar
        // errado aqui despejaria `Value` cru no terminal.
        let summary = summarize(&json!({ "limit": 42 }));
        assert_eq!(summary, "limit=42");
        assert_eq!(summarize(&json!({ "all": true })), "all=true");
    }

    #[test]
    fn non_object_arguments_summarize_to_empty() {
        assert_eq!(summarize(&Value::Null), "");
        assert_eq!(summarize(&json!("texto")), "");
    }

    #[test]
    fn truncation_counts_characters_not_bytes() {
        // Cortar por bytes partiria um caractere multibyte ao meio.
        let acentos = "á".repeat(80);
        let out = truncate(&acentos, 60);
        assert_eq!(out.chars().count(), 63, "60 caracteres mais as reticencias");
    }

    #[test]
    fn first_line_stops_at_the_newline() {
        assert_eq!(first_line("erro\ndetalhe\nmais"), "erro");
        assert_eq!(first_line("linha unica"), "linha unica");
    }
}
