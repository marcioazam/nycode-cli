//! Buffer de entrada multilinha, com histórico.
//!
//! Lógica pura: nenhuma escrita, nenhum terminal. O editor recebe ações e
//! devolve reações, o que é o que permite verificar o comportamento de teclado
//! sem um TTY. A apresentação vive em [`crate::layout`].

use crate::layout::{Frame, Gutter, frame};

/// O que o usuário pediu, já traduzido de tecla para intenção.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Insert(char),
    /// Quebra de linha dentro do mesmo pedido.
    Newline,
    Submit,
    Backspace,
    Delete,
    Left,
    Right,
    /// Início da linha corrente, não do texto inteiro.
    Home,
    End,
    /// Entrada anterior do histórico.
    Previous,
    /// Entrada seguinte do histórico.
    Next,
    /// Descarta o que está escrito.
    Discard,
    Nothing,
}

/// O que o editor produziu ao aplicar uma ação.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reaction {
    /// O quadro mudou.
    Changed,
    /// Nada mudou; não vale redesenhar.
    Idle,
    /// O usuário confirmou o texto.
    Submitted(String),
}

/// Buffer de edição com histórico.
///
/// O texto é `Vec<char>` e não `String` porque toda a aritmética do cursor é em
/// caracteres: com `String` cada movimento viraria conversão de índice de byte,
/// e um acento colocaria o cursor no meio de um code point.
#[derive(Debug, Default)]
pub struct Editor {
    text: Vec<char>,
    cursor: usize,
    history: Vec<String>,
    /// Posição na navegação do histórico, quando há uma em curso.
    browsing: Option<usize>,
    /// O que o usuário havia escrito antes de começar a navegar.
    draft: Vec<char>,
}

impl Editor {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }

    #[must_use]
    pub fn text(&self) -> String {
        self.text.iter().collect()
    }

    #[must_use]
    pub fn history(&self) -> &[String] {
        &self.history
    }

    /// Semeia o histórico, para que uma sessão retomada lembre o que foi pedido.
    pub fn seed_history(&mut self, entries: impl IntoIterator<Item = String>) {
        self.history
            .extend(entries.into_iter().filter(|e| !e.trim().is_empty()));
    }

    pub fn clear_history(&mut self) {
        self.history.clear();
        self.browsing = None;
        self.draft.clear();
    }

    /// Monta o quadro do editor na largura dada.
    #[must_use]
    pub fn frame(&self, width: usize, gutter: Gutter<'_>) -> Frame {
        frame(&self.text(), self.cursor, width, gutter)
    }

    pub fn apply(&mut self, action: Action) -> Reaction {
        match action {
            Action::Insert(ch) => self.insert(ch),
            Action::Newline => self.insert('\n'),
            Action::Submit => self.submit(),
            Action::Backspace => self.backspace(),
            Action::Delete => self.delete(),
            Action::Left => self.move_to(self.cursor.saturating_sub(1)),
            Action::Right => self.move_to((self.cursor + 1).min(self.text.len())),
            Action::Home => self.move_to(self.line_start()),
            Action::End => self.move_to(self.line_end()),
            Action::Previous => self.browse_back(),
            Action::Next => self.browse_forward(),
            Action::Discard => self.discard(),
            Action::Nothing => Reaction::Idle,
        }
    }

    /// Insere texto colado de uma vez.
    ///
    /// Aplicar `Insert` caractere a caractere redesenharia o quadro por
    /// caractere, o que num parágrafo colado aparece como travamento.
    pub fn insert_str(&mut self, text: &str) -> Reaction {
        if text.is_empty() {
            return Reaction::Idle;
        }
        for ch in text.chars() {
            self.text.insert(self.cursor, ch);
            self.cursor += 1;
        }
        Reaction::Changed
    }

    fn insert(&mut self, ch: char) -> Reaction {
        self.text.insert(self.cursor, ch);
        self.cursor += 1;
        Reaction::Changed
    }

    fn backspace(&mut self) -> Reaction {
        if self.cursor == 0 {
            return Reaction::Idle;
        }
        self.cursor -= 1;
        self.text.remove(self.cursor);
        Reaction::Changed
    }

    fn delete(&mut self) -> Reaction {
        if self.cursor >= self.text.len() {
            return Reaction::Idle;
        }
        self.text.remove(self.cursor);
        Reaction::Changed
    }

    fn submit(&mut self) -> Reaction {
        let text: String = self.text.iter().collect();
        if text.trim().is_empty() {
            return Reaction::Idle;
        }
        // Repetir a entrada anterior não merece duas posições: o histórico
        // existe para navegar, e a duplicata só faz apertar a seta duas vezes.
        if self.history.last().map(String::as_str) != Some(text.as_str()) {
            self.history.push(text.clone());
        }
        self.reset();
        Reaction::Submitted(text)
    }

    fn discard(&mut self) -> Reaction {
        if self.text.is_empty() && self.browsing.is_none() {
            return Reaction::Idle;
        }
        self.reset();
        Reaction::Changed
    }

    fn reset(&mut self) {
        self.text.clear();
        self.cursor = 0;
        self.browsing = None;
        self.draft.clear();
    }

    fn move_to(&mut self, to: usize) -> Reaction {
        if to == self.cursor {
            return Reaction::Idle;
        }
        self.cursor = to;
        Reaction::Changed
    }

    fn line_start(&self) -> usize {
        self.text[..self.cursor]
            .iter()
            .rposition(|c| *c == '\n')
            .map_or(0, |i| i + 1)
    }

    fn line_end(&self) -> usize {
        self.text[self.cursor..]
            .iter()
            .position(|c| *c == '\n')
            .map_or(self.text.len(), |i| self.cursor + i)
    }

    fn browse_back(&mut self) -> Reaction {
        if self.history.is_empty() {
            return Reaction::Idle;
        }
        let target = match self.browsing {
            None => {
                // O rascunho é guardado antes da primeira navegação, para que
                // descer de volta o devolva em vez de perdê-lo.
                self.draft = self.text.clone();
                self.history.len() - 1
            }
            Some(0) => return Reaction::Idle,
            Some(current) => current - 1,
        };
        self.browsing = Some(target);
        self.text = self.history[target].chars().collect();
        self.cursor = self.text.len();
        Reaction::Changed
    }

    fn browse_forward(&mut self) -> Reaction {
        let Some(current) = self.browsing else {
            return Reaction::Idle;
        };
        if current + 1 < self.history.len() {
            self.browsing = Some(current + 1);
            self.text = self.history[current + 1].chars().collect();
        } else {
            self.browsing = None;
            self.text = std::mem::take(&mut self.draft);
        }
        self.cursor = self.text.len();
        Reaction::Changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROMPT: Gutter<'static> = Gutter::new("> ", "  ");

    fn typed(editor: &mut Editor, text: &str) {
        for ch in text.chars() {
            editor.apply(Action::Insert(ch));
        }
    }

    #[test]
    fn typing_accumulates_and_submitting_hands_the_text_over() {
        let mut editor = Editor::new();
        typed(&mut editor, "oi");
        assert_eq!(editor.text(), "oi");

        assert_eq!(
            editor.apply(Action::Submit),
            Reaction::Submitted("oi".to_owned())
        );
        assert!(editor.is_empty(), "enviar precisa limpar o buffer");
    }

    #[test]
    fn submitting_blank_input_does_nothing() {
        // Enter num editor vazio nao pode disparar um turno: o modelo cobraria
        // por um pedido sem conteudo.
        let mut editor = Editor::new();
        assert_eq!(editor.apply(Action::Submit), Reaction::Idle);
        typed(&mut editor, "   ");
        assert_eq!(editor.apply(Action::Submit), Reaction::Idle);
        assert!(editor.history().is_empty());
    }

    #[test]
    fn a_newline_stays_in_the_buffer_instead_of_submitting() {
        let mut editor = Editor::new();
        typed(&mut editor, "linha1");
        editor.apply(Action::Newline);
        typed(&mut editor, "linha2");

        assert_eq!(editor.text(), "linha1\nlinha2");
        assert_eq!(
            editor.apply(Action::Submit),
            Reaction::Submitted("linha1\nlinha2".to_owned())
        );
    }

    #[test]
    fn backspace_at_the_start_is_not_an_error() {
        let mut editor = Editor::new();
        assert_eq!(editor.apply(Action::Backspace), Reaction::Idle);
        assert!(editor.is_empty());
    }

    #[test]
    fn the_cursor_counts_characters_not_bytes() {
        // Com aritmetica de bytes, apagar depois de um acento cortaria o code
        // point ao meio.
        let mut editor = Editor::new();
        typed(&mut editor, "ação");
        editor.apply(Action::Backspace);
        assert_eq!(editor.text(), "açã");

        // Recuar sobre o `ã` e apagar precisa remover o `ç` inteiro; com
        // indice de byte, removeria meio code point.
        editor.apply(Action::Left);
        editor.apply(Action::Backspace);
        assert_eq!(editor.text(), "aã");
    }

    #[test]
    fn home_and_end_work_on_the_current_line_not_the_whole_buffer() {
        let mut editor = Editor::new();
        typed(&mut editor, "abc");
        editor.apply(Action::Newline);
        typed(&mut editor, "def");

        editor.apply(Action::Home);
        editor.apply(Action::Insert('>'));
        assert_eq!(editor.text(), "abc\n>def");

        editor.apply(Action::End);
        editor.apply(Action::Insert('!'));
        assert_eq!(editor.text(), "abc\n>def!");
    }

    #[test]
    fn delete_removes_forward_and_stops_at_the_end() {
        let mut editor = Editor::new();
        typed(&mut editor, "ab");
        assert_eq!(editor.apply(Action::Delete), Reaction::Idle);
        editor.apply(Action::Home);
        editor.apply(Action::Delete);
        assert_eq!(editor.text(), "b");
    }

    #[test]
    fn moving_past_either_edge_is_idle_rather_than_wrapping() {
        let mut editor = Editor::new();
        typed(&mut editor, "a");
        editor.apply(Action::Home);
        assert_eq!(editor.apply(Action::Left), Reaction::Idle);
        editor.apply(Action::End);
        assert_eq!(editor.apply(Action::Right), Reaction::Idle);
    }

    #[test]
    fn history_walks_back_and_returns_the_draft_on_the_way_down() {
        // Perder o rascunho ao consultar o historico e a forma mais rapida de
        // fazer o usuario desconfiar do editor.
        let mut editor = Editor::new();
        typed(&mut editor, "primeiro");
        editor.apply(Action::Submit);
        typed(&mut editor, "segundo");
        editor.apply(Action::Submit);

        typed(&mut editor, "rascunho");
        editor.apply(Action::Previous);
        assert_eq!(editor.text(), "segundo");
        editor.apply(Action::Previous);
        assert_eq!(editor.text(), "primeiro");
        assert_eq!(editor.apply(Action::Previous), Reaction::Idle);

        editor.apply(Action::Next);
        assert_eq!(editor.text(), "segundo");
        editor.apply(Action::Next);
        assert_eq!(editor.text(), "rascunho", "o rascunho precisa voltar");
        assert_eq!(editor.apply(Action::Next), Reaction::Idle);
    }

    #[test]
    fn history_on_a_fresh_editor_is_idle() {
        let mut editor = Editor::new();
        assert_eq!(editor.apply(Action::Previous), Reaction::Idle);
        assert_eq!(editor.apply(Action::Next), Reaction::Idle);
    }

    #[test]
    fn repeating_the_previous_entry_does_not_duplicate_it() {
        let mut editor = Editor::new();
        typed(&mut editor, "igual");
        editor.apply(Action::Submit);
        typed(&mut editor, "igual");
        editor.apply(Action::Submit);
        assert_eq!(editor.history(), ["igual".to_owned()]);
    }

    #[test]
    fn a_seeded_history_skips_blank_entries() {
        let mut editor = Editor::new();
        editor.seed_history(["antigo".to_owned(), "  ".to_owned()]);
        assert_eq!(editor.history(), ["antigo".to_owned()]);

        editor.apply(Action::Previous);
        assert_eq!(editor.text(), "antigo");
        editor.clear_history();
        assert!(editor.history().is_empty());
    }

    #[test]
    fn discarding_clears_the_buffer_and_is_idle_when_already_clear() {
        let mut editor = Editor::new();
        assert_eq!(editor.apply(Action::Discard), Reaction::Idle);
        typed(&mut editor, "algo");
        assert_eq!(editor.apply(Action::Discard), Reaction::Changed);
        assert!(editor.is_empty());
    }

    #[test]
    fn discarding_after_browsing_history_resets_the_browse_state() {
        let mut editor = Editor::new();
        typed(&mut editor, "antigo");
        editor.apply(Action::Submit);
        editor.apply(Action::Previous);
        editor.apply(Action::Discard);

        assert!(editor.is_empty());
        // Sem limpar o estado de navegacao, o proximo `Next` devolveria um
        // rascunho velho por cima do que o usuario acabou de digitar.
        assert_eq!(editor.apply(Action::Next), Reaction::Idle);
    }

    #[test]
    fn nothing_is_idle() {
        assert_eq!(Editor::new().apply(Action::Nothing), Reaction::Idle);
    }

    #[test]
    fn pasting_inserts_in_one_step() {
        let mut editor = Editor::new();
        assert_eq!(editor.insert_str(""), Reaction::Idle);
        assert_eq!(editor.insert_str("um texto"), Reaction::Changed);
        assert_eq!(editor.text(), "um texto");
    }

    #[test]
    fn pasting_lands_at_the_cursor_not_at_the_end() {
        let mut editor = Editor::new();
        typed(&mut editor, "ac");
        editor.apply(Action::Left);
        editor.insert_str("b");
        assert_eq!(editor.text(), "abc");
    }

    #[test]
    fn the_frame_reflects_the_buffer_and_the_cursor() {
        let mut editor = Editor::new();
        typed(&mut editor, "um");
        editor.apply(Action::Newline);
        typed(&mut editor, "dois");

        let frame = editor.frame(40, PROMPT);
        assert_eq!(frame.lines, vec!["> um".to_owned(), "  dois".to_owned()]);
        assert_eq!(frame.cursor_row, 1);
        assert_eq!(frame.cursor_col, 6);
    }

    #[test]
    fn an_empty_editor_still_renders_its_prompt() {
        let frame = Editor::new().frame(20, PROMPT);
        assert_eq!(frame.lines, vec!["> ".to_owned()]);
    }
}
