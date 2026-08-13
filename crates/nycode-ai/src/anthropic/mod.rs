//! Dialeto Anthropic Messages.
//!
//! É o caminho primário contra o `nylla-gateway`, que o serve em `/v1/messages`
//! com envelopes nativos de erro e SSE.
//!
//! A separação interna segue o que muda junto: [`types`] acompanha a forma das
//! mensagens e do corpo da requisição, [`decoder`] acompanha o protocolo de
//! eventos do stream. As duas coisas evoluem por motivos diferentes.

mod decoder;
mod dialect;
mod types;

pub use decoder::Decoder;
pub use dialect::Messages;
pub use types::{ContentBlock, ImageSource, Message, Request, Role, ToolSpec};
