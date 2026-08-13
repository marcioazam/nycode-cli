// Ver a nota equivalente em `nycode-ai`: asserção de teste usa `unwrap`.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

//! Harness diferencial.
//!
//! Roda o mesmo prompt no `nycode` e no harness de referência contra o mesmo
//! gateway, e compara o contrato observável das duas execuções. Existe porque o
//! modo de falha de toda reescrita é a deriva silenciosa: compila, roda, e é
//! sutilmente pior de um jeito que ninguém percebe até desperdiçar um dia.
//!
//! O antipadrão que este crate recusa: clones em Rust do Claude Code anunciam
//! "100% de paridade verificada por harness automatizado" com trinta e três
//! testes. Um harness que não pode falhar é pior que nenhum, porque compra
//! confiança sem entregar evidência.
//!
//! # Estado
//!
//! As cinco dimensões são comparadas de fato. A sequência de ferramentas e a
//! contabilidade de tokens vêm do modo de eventos JSON dos dois harnesses,
//! traduzido em [`dialect`] do vocabulário de cada um: o formato divergir não é
//! o defeito que o NFR-6 quer pegar, o contrato observável divergir é.

pub mod dialect;
pub mod fixture;
pub mod runner;
pub mod transcript;
pub mod workspace;

pub use dialect::Events;
pub use runner::{Harness, run};
pub use transcript::{
    DIMENSIONS, Divergence, TokenAccounting, ToolInvocation, Transcript, diff, unattested,
};
pub use workspace::snapshot;
