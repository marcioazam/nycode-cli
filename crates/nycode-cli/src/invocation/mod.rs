//! O que o usuário pediu na linha de comando, e o que isso decide.
//!
//! Uma flag nova entra em [`cli`]: rota ([`route`]), permissão ([`grant`]),
//! catálogo oferecido ao modelo ([`catalog`]).

pub mod catalog;
pub mod cli;
pub mod grant;
pub mod route;

pub use cli::Cli;
pub use route::{Route, choose};
