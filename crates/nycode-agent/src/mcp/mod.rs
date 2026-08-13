//! Integração com servidores MCP.
//!
//! É o mecanismo de extensão do nycode. Um servidor MCP roda fora do processo,
//! em qualquer linguagem, e suas ferramentas entram no catálogo do agente com o
//! nome prefixado pelo servidor — ver ADR-0002.

pub mod config;
mod schema;
mod tool;

pub use config::{Endpoint, ServerConfig, discover};
pub use tool::{McpTool, Transport, qualify};
