// Ver a nota equivalente em `nycode-ai`: asserção de teste usa `unwrap`.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

//! Cliente MCP do nycode.
//!
//! Fecha a metade de baixo do primeiro mecanismo de extensão do
//! [ADR-0002](../../../docs/architecture/decisions/0002-extensions-are-out-of-process.md):
//! a descoberta de `.mcp.json` e a ponte para o catálogo já viviam em
//! `nycode-agent`, e o que faltava era falar o protocolo de verdade.
//!
//! O transporte vem do SDK oficial `rmcp`
//! ([ADR-0004](../../../docs/architecture/decisions/0004-cliente-mcp-usa-o-sdk-oficial-rmcp.md)),
//! atrás do trait `Transport` que o agente já esperava. O agente continua sem
//! conhecer o SDK, e o fake de teste dele continua valendo.

mod error;
/// Servidor MCP em processo, usado só pelos testes deste crate.
#[cfg(test)]
mod fakes;
mod session;

pub use error::Error;
pub use session::{Connected, Session, connect, connect_all};
