//! O painel de baixo e o que uma tecla significa nele.
//!
//! Separado do laço porque muda por outro motivo: o laço muda quando a forma de
//! uma sessão muda, isto muda quando o teclado ou a apresentação mudam.

use crossterm::event::Event;
use nycode_ai::Usage;
use nycode_ai::catalog::Price;
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
    /// Tarifas do modelo atual, quando o catálogo as declara.
    ///
    /// Sem preço o rodapé mostra volume e cala sobre custo. O FR-6 proíbe
    /// tabela fixa no binário, então a ausência é um estado normal e não uma
    /// falha de configuração.
    price: Option<Price>,
}

impl Panel {
    pub fn new(
        workspace: String,
        session: String,
        model: String,
        writable: bool,
        price: Option<Price>,
    ) -> Self {
        Self {
            editor: Editor::new(),
            tally: Tally::default(),
            workspace,
            session,
            model,
            writable,
            price,
        }
    }

    pub const fn editor_mut(&mut self) -> &mut Editor {
        &mut self.editor
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    /// Troca o modelo mostrado no rodapé, e com ele as tarifas.
    ///
    /// Os dois andam juntos porque separá-los cobraria os turnos do modelo novo
    /// à tarifa do antigo, e o número errado é pior que nenhum.
    pub fn set_model(&mut self, model: String, price: Option<Price>) {
        self.model = model;
        self.price = price;
    }

    pub fn retarget(&mut self, session: String) {
        self.session = session;
        self.tally = Tally::default();
    }

    pub fn absorb(&mut self, usage: Usage) {
        self.tally.absorb(
            usage.input_tokens,
            usage.output_tokens,
            usage.cache_read_tokens,
            usage.cache_write_tokens,
        );
        self.tally.estimated |= usage.estimated;
        if let Some(price) = &self.price {
            self.tally.absorb_cost(price.cost(usage).total());
        }
    }

    /// Declara que o contexto encolheu de propósito.
    ///
    /// O prompt do próximo turno é conteúdo novo, e não conteúdo recobrado;
    /// contá-lo como repagamento acusaria desperdício onde o harness fez a
    /// coisa certa.
    pub const fn compacted(&mut self) {
        self.tally.forget_prefix();
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
