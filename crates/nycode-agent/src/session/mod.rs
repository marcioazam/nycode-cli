//! Persistência e redução de histórico.
//!
//! [`store`] cuida de durabilidade — como a conversa sobrevive a um crash.
//! [`compaction`] cuida de tamanho — como ela cabe na janela. As duas coisas
//! mudam por razões diferentes.

pub mod compaction;
pub mod store;

pub use compaction::{Compacted, DEFAULT_KEEP_RECENT, compact};
pub use store::{Record, SessionInfo, Store};
