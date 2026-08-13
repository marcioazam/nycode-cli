//! O que o usuário pediu na linha de comando, e o que isso decide.
//!
//! Os três módulos mudam juntos e é por isso que moram juntos: uma flag nova
//! entra em [`cli`], e a pergunta seguinte é sempre para qual rota ela leva
//! ([`route`]) e o que ela permite ao agente ([`grant`]). Separá-los por tipo
//! técnico espalharia uma única decisão por três diretórios.

pub mod cli;
pub mod grant;
pub mod route;

pub use cli::Cli;
pub use route::{Route, choose};
