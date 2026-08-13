//! Transporte: como os bytes vão e voltam, e o que fazer quando falham.
//!
//! [`client`] estabelece o turno, [`stream`] projeta o corpo SSE em eventos, e
//! [`retry`] decide se vale tentar de novo. As três mudam juntas quando o
//! transporte muda, e por isso vivem juntas.

pub mod client;
pub mod retry;
pub mod stream;

pub use client::Client;
pub use retry::Policy;
