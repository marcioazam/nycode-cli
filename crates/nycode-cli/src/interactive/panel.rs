//! O painel de baixo e o que uma tecla significa nele.
//!
//! Separado do laço porque muda por outro motivo: o laço muda quando a forma de
//! uma sessão muda, isto muda quando o teclado ou a apresentação mudam.

use crossterm::event::Event;
use nycode_ai::Usage;
use nycode_tui::{Action, Editor, Gutter, Key, Reaction, Status, Tally};

use super::{CONTINUATION, PROMPT};

/// O que o laço deve fazer depois de tratar um evento.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    /// Continuar lendo, sem redesenhar.
    Idle,
    Redraw,
    /// Rodar um turno com este texto.
    Submit(String),
    /// Encerrar a sessão.
    Quit,
}

/// Traduz um evento de terminal em passo do laço.
pub fn step(event: &Event, editor: &mut Editor) -> Step {
    match event {
        Event::Key(key) => match nycode_tui::translate(*key) {
            Key::Edit(action) => match editor.apply(action) {
                Reaction::Submitted(text) => Step::Submit(text),
                Reaction::Changed => Step::Redraw,
                Reaction::Idle => Step::Idle,
            },
            // Fora de um turno não há o que interromper, então `Ctrl+C` limpa o
            // que está escrito. Sair com ele apagaria trabalho sem confirmação.
            Key::Interrupt => match editor.apply(Action::Discard) {
                Reaction::Idle => Step::Idle,
                _ => Step::Redraw,
            },
            // `Ctrl+D` com texto escrito é quase sempre engano de quem quis
            // apagar para a frente.
            Key::Quit if editor.is_empty() => Step::Quit,
            Key::Quit => Step::Idle,
            Key::Redraw => Step::Redraw,
        },
        Event::Paste(text) => match editor.insert_str(text) {
            Reaction::Idle => Step::Idle,
            _ => Step::Redraw,
        },
        Event::Resize(..) => Step::Redraw,
        _ => Step::Idle,
    }
}
/// Estado que o painel apresenta e que o laço mantém.
#[derive(Debug)]
pub struct Panel {
    editor: Editor,
    tally: Tally,
    workspace: String,
    session: String,
    model: String,
    writable: bool,
}

impl Panel {
    pub fn new(workspace: String, session: String, model: String, writable: bool) -> Self {
        Self {
            editor: Editor::new(),
            tally: Tally::default(),
            workspace,
            session,
            model,
            writable,
        }
    }

    pub const fn editor_mut(&mut self) -> &mut Editor {
        &mut self.editor
    }

    /// Soma o custo de mais um turno.
    /// Troca o modelo mostrado no rodapé.
    pub fn set_model(&mut self, model: String) {
        self.model = model;
    }

    pub const fn absorb(&mut self, usage: Usage) {
        self.tally.absorb(
            usage.input_tokens,
            usage.output_tokens,
            usage.cache_read_tokens,
            usage.cache_write_tokens,
        );
        self.tally.estimated |= usage.estimated;
    }

    /// Monta o quadro do painel: editor mais rodapé.
    #[must_use]
    pub fn frame(&self, width: usize) -> Vec<String> {
        let mut lines = self
            .editor
            .frame(width, Gutter::new(PROMPT, CONTINUATION))
            .lines;
        lines.push(nycode_tui::footer(
            &Status {
                workspace: &self.workspace,
                session: &self.session,
                model: &self.model,
                tally: self.tally,
                writable: self.writable,
            },
            width,
        ));
        lines
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
#[path = "panel_test.rs"]
mod panel_test;
