// Em produção um `unwrap` é uma decisão registrada, nunca um atalho — daí o
// `deny` no workspace. Em teste, `unwrap` e `panic` são a forma de asserção, e
// exigir tratamento de erro ali só produz ruído.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

//! Cliente de wire do nycode.
//!
//! Fala com endpoints compatíveis — primariamente o `nylla-gateway` — nos três
//! dialetos que ele serve, e projeta todos no vocabulário canônico de [`event`].
//!
//! A regra que organiza o crate é NFR-4: o que o gateway emitiu chega ao
//! chamador como foi emitido. Um `stop_reason` desconhecido, um erro no meio do
//! stream e um stream cortado são três coisas distintas, e nenhuma delas vira
//! sucesso silencioso.

pub mod anthropic;
pub mod catalog;
pub mod config;
pub mod destination;
pub mod dialect;
pub mod error;
pub mod event;
pub mod openai;
pub mod sampling;
pub mod transport;

pub use catalog::Model;
pub use config::Config;
pub use destination::refuse_plaintext_outside_loopback;
pub use dialect::{Dialect, Kind, UnifiedRequest};
pub use error::{ApiError, Error, Result};
pub use event::{StopReason, StreamEvent, Usage};
pub use sampling::{Effort, Sampling, ThinkingLevel};
pub use transport::{Client, Policy};
