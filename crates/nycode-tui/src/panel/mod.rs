//! Cabeçalho de abertura e rodapé de estado.
//!
//! São as duas superfícies que dizem ao usuário o que a sessão carregou e o que
//! ela está custando. O rodapé em particular existe porque um harness que
//! esconde o custo até a fatura chegar não deixa ninguém decidir nada: a conta
//! de tokens precisa estar visível enquanto ainda dá para mudar de ideia.

use crate::width::{display_width, truncate_to_width};

/// Contabilidade acumulada de uma sessão.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Tally {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    /// Verdadeiro se qualquer turno reportou usage estimado.
    ///
    /// Propagar isto é o que impede um número heurístico de ser apresentado
    /// como medido.
    pub estimated: bool,
}

impl Tally {
    /// Soma o usage de mais um turno.
    pub const fn absorb(&mut self, input: u64, output: u64, cache_read: u64, cache_write: u64) {
        self.input_tokens += input;
        self.output_tokens += output;
        self.cache_read_tokens += cache_read;
        self.cache_write_tokens += cache_write;
    }

    /// Fração dos tokens de entrada servida de cache, em porcentagem.
    ///
    /// `None` quando não houve entrada: zero por cento e "não houve pedido" são
    /// coisas diferentes, e mostrar `0%` num rodapé recém-aberto sugeriria que
    /// o cache está falhando.
    #[must_use]
    pub fn cache_hit_rate(&self) -> Option<f64> {
        if self.input_tokens == 0 {
            return None;
        }
        #[allow(clippy::cast_precision_loss)]
        Some((self.cache_read_tokens as f64 / self.input_tokens as f64) * 100.0)
    }
}

/// Estado que o rodapé apresenta.
#[derive(Debug, Clone)]
pub struct Status<'a> {
    pub workspace: &'a str,
    pub session: &'a str,
    pub model: &'a str,
    pub tally: Tally,
    /// Se a sessão pode escrever no workspace.
    pub writable: bool,
}

/// Monta a linha de rodapé, truncada à largura disponível.
#[must_use]
pub fn footer(status: &Status<'_>, width: usize) -> String {
    let mut parts = vec![
        status.workspace.to_owned(),
        format!("sessao {}", short_id(status.session)),
        status.model.to_owned(),
    ];

    let tally = status.tally;
    if tally.input_tokens > 0 || tally.output_tokens > 0 {
        let mut usage = format!(
            "↑{} ↓{}",
            compact(tally.input_tokens),
            compact(tally.output_tokens)
        );
        if let Some(rate) = tally.cache_hit_rate() {
            let _ = std::fmt::Write::write_fmt(&mut usage, format_args!(" cache {rate:.0}%"));
        }
        if tally.estimated {
            // O gateway sinaliza contagem heurística; apresentá-la como medida
            // seria a degradação silenciosa que o NFR-4 proíbe.
            usage.push_str(" (estimado)");
        }
        parts.push(usage);
    }

    if !status.writable {
        parts.push("somente-leitura".to_owned());
    }

    truncate_to_width(&parts.join("  ·  "), width)
}

/// Monta o cabeçalho de abertura.
#[must_use]
pub fn header(
    version: &str,
    context_files: &[String],
    skills: &[String],
    width: usize,
) -> Vec<String> {
    let mut lines = vec![format!("nycode {version}")];

    if !context_files.is_empty() {
        lines.push(format!("contexto: {}", context_files.join(", ")));
    }
    if !skills.is_empty() {
        lines.push(format!("skills: {}", skills.join(", ")));
    }
    lines.push("Enter envia · Alt+Enter quebra linha · Ctrl+C interrompe · Ctrl+D sai".to_owned());

    lines
        .into_iter()
        .map(|line| truncate_to_width(&line, width))
        .collect()
}

/// Abrevia um id longo preservando o começo, que é o que ordena.
fn short_id(id: &str) -> String {
    if display_width(id) <= 12 {
        return id.to_owned();
    }
    id.chars().take(12).collect()
}

/// Abrevia uma contagem grande.
fn compact(value: u64) -> String {
    match value {
        0..=999 => value.to_string(),
        1_000..=999_999 => format!(
            "{:.1}k",
            f64::from(u32::try_from(value).unwrap_or(u32::MAX)) / 1000.0
        ),
        _ => {
            #[allow(clippy::cast_precision_loss)]
            let millions = value as f64 / 1_000_000.0;
            format!("{millions:.1}M")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status() -> Status<'static> {
        Status {
            workspace: "~/proj",
            session: "0000001700000000000",
            model: "nylla-sonnet-4.5",
            tally: Tally::default(),
            writable: true,
        }
    }

    #[test]
    fn a_fresh_footer_shows_where_and_with_what_but_no_counts() {
        // Mostrar zero token numa sessao que ainda nao pediu nada sugeriria que
        // algo foi cobrado.
        let line = footer(&status(), 200);
        assert!(line.contains("~/proj"));
        assert!(line.contains("nylla-sonnet-4.5"));
        assert!(!line.contains('↑'), "sem turno nao ha contagem: {line}");
    }

    #[test]
    fn the_footer_reports_usage_once_a_turn_happened() {
        let mut status = status();
        status.tally.absorb(1500, 300, 750, 0);

        let line = footer(&status, 200);
        assert!(line.contains("↑1.5k"), "{line}");
        assert!(line.contains("↓300"), "{line}");
        assert!(line.contains("cache 50%"), "{line}");
    }

    #[test]
    fn an_estimated_count_is_labelled_as_such() {
        // Apresentar heuristica como medicao e exatamente o que o NFR-4 proibe.
        let mut status = status();
        status.tally.absorb(100, 10, 0, 0);
        status.tally.estimated = true;
        assert!(footer(&status, 200).contains("estimado"));
    }

    #[test]
    fn a_read_only_session_says_so() {
        // O usuario precisa saber por que o agente recusou uma escrita.
        let mut status = status();
        status.writable = false;
        assert!(footer(&status, 200).contains("somente-leitura"));
    }

    #[test]
    fn a_writable_session_does_not_advertise_it() {
        assert!(!footer(&status(), 200).contains("somente-leitura"));
    }

    #[test]
    fn the_footer_never_exceeds_the_width_it_was_given() {
        // Uma linha mais larga que o terminal quebraria sozinha e empurraria o
        // painel inteiro para cima a cada redesenho.
        let mut status = status();
        status.workspace = "/um/caminho/absurdamente/longo/que/nao/cabe/em/lugar/nenhum";
        status.tally.absorb(1_234_567, 89_000, 1_000_000, 5);

        for width in [10, 24, 40, 80] {
            let line = footer(&status, width);
            assert!(
                display_width(&line) <= width,
                "largura {width} estourada por: {line}"
            );
        }
    }

    #[test]
    fn a_long_session_id_is_shortened_but_keeps_its_start() {
        // O prefixo e o timestamp, que e o que ordena as sessoes.
        let line = footer(&status(), 200);
        assert!(line.contains("000000170000"), "{line}");
        assert!(!line.contains("0000001700000000000"), "{line}");
    }

    #[test]
    fn a_short_session_id_is_left_alone() {
        let mut status = status();
        status.session = "curta";
        assert!(footer(&status, 200).contains("sessao curta"));
    }

    #[test]
    fn counts_are_abbreviated_by_magnitude() {
        assert_eq!(compact(0), "0");
        assert_eq!(compact(999), "999");
        assert_eq!(compact(1_000), "1.0k");
        assert_eq!(compact(1_500_000), "1.5M");
    }

    #[test]
    fn the_cache_rate_is_absent_rather_than_zero_before_the_first_turn() {
        assert_eq!(Tally::default().cache_hit_rate(), None);

        let mut tally = Tally::default();
        tally.absorb(200, 0, 50, 0);
        assert_eq!(tally.cache_hit_rate(), Some(25.0));
    }

    #[test]
    fn absorbing_accumulates_across_turns() {
        let mut tally = Tally::default();
        tally.absorb(100, 10, 40, 60);
        tally.absorb(100, 20, 60, 0);
        assert_eq!(tally.input_tokens, 200);
        assert_eq!(tally.output_tokens, 30);
        assert_eq!(tally.cache_read_tokens, 100);
        assert_eq!(tally.cache_write_tokens, 60);
    }

    #[test]
    fn the_header_names_what_the_session_loaded() {
        // Sem isto o usuario nao tem como saber se o AGENTS.md dele foi lido.
        let lines = header(
            "0.1.0",
            &["AGENTS.md".to_owned()],
            &["revisar".to_owned()],
            200,
        );
        let joined = lines.join("\n");
        assert!(joined.contains("nycode 0.1.0"));
        assert!(joined.contains("AGENTS.md"));
        assert!(joined.contains("revisar"));
        assert!(joined.contains("Ctrl+C"), "os atalhos precisam aparecer");
    }

    #[test]
    fn the_header_omits_the_lines_it_has_nothing_to_say_on() {
        let lines = header("0.1.0", &[], &[], 200);
        let joined = lines.join("\n");
        assert!(!joined.contains("contexto:"));
        assert!(!joined.contains("skills:"));
    }

    #[test]
    fn no_header_line_exceeds_the_width() {
        let lines = header(
            "0.1.0",
            &vec!["um/caminho/bem/longo/AGENTS.md".to_owned(); 6],
            &vec!["skill".to_owned(); 6],
            30,
        );
        for line in lines {
            assert!(display_width(&line) <= 30, "estourou: {line}");
        }
    }
}
