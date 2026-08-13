// Ver a nota equivalente em `nycode-ai`: asserção de teste usa `unwrap`.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

//! Interface de terminal do nycode.
//!
//! O alvo é emitir escrita apenas para o que mudou. Um agente produz dezenas de
//! deltas de token por segundo; redesenhar o painel inteiro a cada um é o que
//! transforma uma resposta em cascata de flicker.
//!
//! O modelo é o do scrollback, não o de tela alternativa: a conversa é escrita
//! no fluxo do terminal como a de qualquer programa de linha de comando, e só o
//! painel de baixo — editor e rodapé — é redesenhado no lugar. Rolagem, busca e
//! cópia continuam sendo do emulador, que as faz melhor do que qualquer
//! reimplementação caberia aqui ([ADR-0008](../../../docs/architecture/decisions/0008-a-tui-usa-o-renderizador-proprio-sobre-o-scrollback.md)).

pub mod diff;
pub mod editor;
pub mod keys;
pub mod layout;
pub mod panel;
pub mod terminal;
pub mod width;

pub use diff::{Command, Renderer};
pub use editor::{Action, Editor, Reaction};
pub use keys::{Key, translate};
pub use layout::{Frame, Gutter};
pub use panel::{Status, Tally, footer, header};
pub use terminal::Terminal;
pub use width::{display_width, strip_ansi, truncate_to_width};
