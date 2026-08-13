//! Dialetos OpenAI servidos pelo gateway.
//!
//! São dois formatos distintos, não variações: o Chat Completions declara
//! ferramentas dentro de um envelope `function` e endereça fragmentos por
//! índice; o Responses declara achatado e endereça por `item_id`. Cada um vive
//! num par de arquivos — a forma da requisição e a projeção do stream mudam por
//! razões diferentes.

mod chat;
mod chat_stream;
mod responses;
mod responses_stream;

pub use chat::Chat;
pub use chat_stream::ChatDecoder;
pub use responses::Responses;
pub use responses_stream::ResponsesDecoder;
