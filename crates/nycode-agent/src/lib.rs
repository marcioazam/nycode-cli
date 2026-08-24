// Ver a nota equivalente em `nycode-ai`: asserção de teste usa `unwrap`.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

//! Loop de agente do nycode.
//!
//! Recebe um pedido do usuário, conversa com o backend e executa as ferramentas
//! que o modelo pedir, até ele parar de pedir. As invariantes que o loop
//! sustenta: nenhuma ferramenta roda com argumentos incompletos, a ordem de
//! execução é a ordem que o modelo pediu, nenhum caminho escapa da raiz do
//! workspace, e uma falha de ferramenta chega ao modelo marcada como falha.

pub mod agent;
pub mod backend;
pub mod cancel;
pub mod capped;
pub mod context;
pub mod error;
pub mod mcp;
pub mod policy;
pub mod session;
pub mod tool;
pub mod tools;
pub mod turn;

#[cfg(test)]
mod agent_test;
#[cfg(test)]
mod compaction_test;
#[cfg(test)]
mod outcome_test;

pub use agent::{Agent, Observer, Outcome, Silent};
pub use backend::Backend;
pub use cancel::Cancel;
pub use context::Context;
pub use context::commands::{Command, Invocation};
pub use error::{Error, Result};
pub use policy::confinement::sandbox::{self, Confinement};
pub use policy::{AllowAll, Allowlist, Decision, Gate, ReadOnly};
pub use session::{Store, compact};
pub use tool::sanitize;
pub use tool::{Tool, ToolCall, ToolContext, ToolOutput};
pub use turn::Turn;
