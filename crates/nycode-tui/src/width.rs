//! Medição e corte por células de exibição.
//!
//! Contar bytes ou `char`s produz colunas erradas: um ideograma ocupa duas
//! células, um acento combinante ocupa zero, e uma sequência ANSI ocupa nenhuma
//! mas tem vários bytes.

use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

/// Largura de exibição de um texto, ignorando sequências ANSI.
#[must_use]
pub fn display_width(text: &str) -> usize {
    strip_ansi(text).width()
}

/// Trunca preservando células de exibição e sequências ANSI.
///
/// As sequências passam sem custo de largura: cortá-las deixaria o terminal com
/// cor presa até o próximo reset.
#[must_use]
pub fn truncate_to_width(text: &str, max: usize) -> String {
    let mut width = 0;
    let mut out = String::with_capacity(text.len().min(max.saturating_mul(4)));
    let mut chars = text.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            out.push(ch);
            for next in chars.by_ref() {
                out.push(next);
                if next.is_ascii_alphabetic() {
                    break;
                }
            }
            continue;
        }

        let cells = UnicodeWidthChar::width(ch).unwrap_or(0);
        if width + cells > max {
            break;
        }
        width += cells;
        out.push(ch);
    }
    out
}

/// Remove sequências de escape ANSI para efeito de medição.
#[must_use]
pub fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(ch) = chars.next() {
        if ch != '\u{1b}' {
            out.push(ch);
            continue;
        }
        for next in chars.by_ref() {
            if next.is_ascii_alphabetic() {
                break;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wide_characters_count_as_two_cells() {
        assert_eq!(display_width("ab"), 2);
        assert_eq!(
            display_width("日本"),
            4,
            "ideogramas ocupam duas celulas cada"
        );
    }

    #[test]
    fn ansi_sequences_do_not_count_toward_width() {
        // Medir com os escapes faria a linha parecer maior do que e, e o layout
        // quebraria exatamente onde ha cor.
        assert_eq!(display_width("\u{1b}[31mvermelho\u{1b}[0m"), 8);
    }

    #[test]
    fn truncation_respects_cell_width_not_byte_length() {
        assert_eq!(truncate_to_width("日本語", 4), "日本");
        assert_eq!(truncate_to_width("abcdef", 3), "abc");
    }

    #[test]
    fn truncation_never_splits_a_wide_character() {
        // Cortar no meio de um ideograma produz lixo no terminal.
        assert_eq!(truncate_to_width("日本", 3), "日");
    }

    #[test]
    fn ansi_sequences_survive_truncation() {
        // Cortar uma sequencia pela metade deixa o terminal com cor presa ate o
        // proximo reset, contaminando tudo abaixo.
        let colored = "\u{1b}[31mvermelho\u{1b}[0m";
        let out = truncate_to_width(colored, 4);
        assert!(out.starts_with("\u{1b}[31m"));
        assert_eq!(display_width(&out), 4);
    }

    #[test]
    fn text_shorter_than_the_budget_is_untouched() {
        assert_eq!(truncate_to_width("oi", 10), "oi");
        assert_eq!(truncate_to_width("", 10), "");
    }

    #[test]
    fn a_zero_budget_yields_nothing_visible() {
        assert_eq!(display_width(&truncate_to_width("abc", 0)), 0);
    }

    #[test]
    fn combining_marks_do_not_consume_a_cell() {
        // "e" seguido de acento combinante ocupa uma celula, nao duas.
        assert_eq!(display_width("e\u{0301}"), 1);
    }
}
