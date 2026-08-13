//! Transformação de texto e posição de cursor num quadro de linhas.
//!
//! Separado do editor porque muda por outra razão: o editor muda quando o
//! teclado muda, o layout muda quando a apresentação muda. Toda a aritmética
//! aqui é em células do terminal, nunca em bytes nem em caracteres — um
//! ideograma ocupa duas colunas, e contar caracteres faria a linha estourar a
//! largura e o terminal quebrá-la por conta própria, desalinhando o quadro
//! seguinte.

use crate::width::display_width;

/// Quadro pronto para desenhar, com onde o cursor deve aparecer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub lines: Vec<String>,
    /// Linha do cursor dentro de `lines`.
    pub cursor_row: usize,
    /// Coluna do cursor em células.
    pub cursor_col: usize,
}

/// Prefixos das linhas de um bloco de entrada.
#[derive(Debug, Clone, Copy)]
pub struct Gutter<'a> {
    /// Prefixo da primeira linha.
    pub first: &'a str,
    /// Prefixo das linhas lógicas seguintes.
    pub rest: &'a str,
}

impl<'a> Gutter<'a> {
    #[must_use]
    pub const fn new(first: &'a str, rest: &'a str) -> Self {
        Self { first, rest }
    }

    /// Largura reservada, que é a do maior prefixo.
    ///
    /// Prefixos de larguras diferentes desalinhariam a coluna do texto entre a
    /// primeira linha e as demais.
    #[must_use]
    pub fn width(&self) -> usize {
        display_width(self.first).max(display_width(self.rest))
    }
}

/// Monta o quadro de um texto com cursor.
///
/// `cursor` é um índice em caracteres dentro de `text`.
#[must_use]
pub fn frame(text: &str, cursor: usize, width: usize, gutter: Gutter<'_>) -> Frame {
    let reserved = gutter.width();
    let room = width.saturating_sub(reserved).max(1);

    let mut lines = Vec::new();
    let mut cursor_row = 0;
    let mut cursor_col = reserved;
    let mut seen = 0;

    for (index, logical) in text.split('\n').enumerate() {
        let prefix = if index == 0 {
            gutter.first
        } else {
            gutter.rest
        };

        for (chunk_index, chunk) in wrap(logical, room).into_iter().enumerate() {
            let chunk_len = chunk.chars().count();
            let pad = if chunk_index == 0 {
                pad_to(prefix, reserved)
            } else {
                " ".repeat(reserved)
            };

            // O limite superior é inclusivo: o cursor no fim de um pedaço
            // pertence a ele, e não ao começo do seguinte.
            if (seen..=seen + chunk_len).contains(&cursor) {
                cursor_row = lines.len();
                let before: String = chunk.chars().take(cursor - seen).collect();
                cursor_col = reserved + display_width(&before);
            }

            seen += chunk_len;
            lines.push(format!("{pad}{chunk}"));
        }
        // A quebra de linha lógica também consome uma posição do cursor.
        seen += 1;
    }

    Frame {
        lines,
        cursor_row,
        cursor_col,
    }
}

/// Completa o prefixo até a largura reservada.
fn pad_to(prefix: &str, reserved: usize) -> String {
    let missing = reserved.saturating_sub(display_width(prefix));
    format!("{prefix}{}", " ".repeat(missing))
}

/// Quebra uma linha em pedaços que cabem na largura, contando células.
fn wrap(line: &str, room: usize) -> Vec<String> {
    if line.is_empty() {
        return vec![String::new()];
    }

    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut used = 0;

    for ch in line.chars() {
        let cell = display_width(&ch.to_string());
        if used + cell > room && !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
            used = 0;
        }
        current.push(ch);
        used += cell;
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROMPT: Gutter<'static> = Gutter::new("> ", "  ");

    #[test]
    fn an_empty_text_renders_one_line_with_the_prompt() {
        let frame = frame("", 0, 20, PROMPT);
        assert_eq!(frame.lines, vec!["> ".to_owned()]);
        assert_eq!((frame.cursor_row, frame.cursor_col), (0, 2));
    }

    #[test]
    fn the_first_line_gets_the_prompt_and_the_rest_the_continuation() {
        let frame = frame("um\ndois", 7, 40, Gutter::new("> ", "| "));
        assert_eq!(frame.lines, vec!["> um".to_owned(), "| dois".to_owned()]);
        assert_eq!(frame.cursor_row, 1);
        assert_eq!(frame.cursor_col, 6);
    }

    #[test]
    fn a_long_line_wraps_and_the_cursor_follows_it() {
        let frame = frame("abcdefgh", 8, 6, PROMPT);
        assert_eq!(frame.lines, vec!["> abcd".to_owned(), "  efgh".to_owned()]);
        assert_eq!(frame.cursor_row, 1);
        assert_eq!(frame.cursor_col, 6);
    }

    #[test]
    fn no_rendered_line_exceeds_the_width_with_wide_characters() {
        // Contar caracteres em vez de celulas deixaria a linha passar da
        // largura e o terminal quebraria sozinho, desalinhando o quadro.
        let frame = frame("日本語のテキスト", 0, 10, PROMPT);
        for line in &frame.lines {
            assert!(display_width(line) <= 10, "linha larga demais: {line}");
        }
    }

    #[test]
    fn the_cursor_column_counts_cells_not_characters() {
        let frame = frame("日本", 2, 40, PROMPT);
        assert_eq!(
            frame.cursor_col, 6,
            "dois ideogramas sao quatro celulas depois do prefixo de duas"
        );
    }

    #[test]
    fn an_empty_logical_line_still_occupies_a_row() {
        let frame = frame("a\n\nb", 0, 20, PROMPT);
        assert_eq!(frame.lines.len(), 3);
        assert_eq!(frame.lines[1], "  ");
    }

    #[test]
    fn a_width_narrower_than_the_prompt_still_makes_progress() {
        // Sem o piso de uma coluna, `room` seria zero e o wrap nao terminaria.
        let frame = frame("abc", 0, 1, Gutter::new(">>>>", "    "));
        assert_eq!(frame.lines.len(), 3);
    }

    #[test]
    fn prefixes_of_different_widths_keep_the_text_aligned() {
        // O prefixo curto e completado ate a largura do longo; sem isso a
        // segunda linha comecaria numa coluna diferente da primeira.
        let frame = frame("um\ndois", 0, 40, Gutter::new(">", "...."));
        assert_eq!(frame.lines[0], ">   um");
        assert_eq!(frame.lines[1], "....dois");
    }

    #[test]
    fn the_cursor_at_the_end_of_a_chunk_stays_on_that_chunk() {
        // Empurrar o cursor para o inicio do pedaco seguinte faria ele saltar
        // uma linha para baixo enquanto o usuario digita no fim da anterior.
        let frame = frame("abcd", 4, 6, PROMPT);
        assert_eq!(frame.lines, vec!["> abcd".to_owned()]);
        assert_eq!(frame.cursor_row, 0);
        assert_eq!(frame.cursor_col, 6);
    }

    #[test]
    fn a_cursor_beyond_the_text_falls_back_to_the_reserved_column() {
        // Não deveria acontecer, mas um índice fora de faixa não pode produzir
        // uma coluna aleatória que jogue o cursor para fora do painel.
        let frame = frame("ab", 99, 20, PROMPT);
        assert_eq!(frame.cursor_col, 2);
        assert_eq!(frame.cursor_row, 0);
    }

    #[test]
    fn the_gutter_reserves_the_width_of_its_widest_prefix() {
        assert_eq!(Gutter::new("> ", "    ").width(), 4);
        assert_eq!(Gutter::new("> ", "").width(), 2);
    }
}
