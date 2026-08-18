//! O que o agente pode fazer, e até onde o que ele faz alcança.
//!
//! Quatro camadas, nesta ordem. O **hook** do repositório é consultado antes de
//! tudo: uma política que só rodasse depois do gate não conseguiria proibir
//! nada que o gate permitisse. O **gate** decide se a chamada acontece, e é o
//! que o modelo vê — uma recusa volta como resultado corrigível. O
//! **aprovador** atende quando o gate não tem resposta óbvia. E o
//! **confinamento** decide o que o comando alcança depois de começar, que é a
//! única camada que o comando não consegue ignorar.
//!
//! Sem a última, `--allow-writes` é um cheque em branco — a política do harness
//! vira convenção que qualquer `cd ..` contorna. Sem as primeiras, o usuário
//! perde o controle sobre o que sequer é tentado.

pub mod approval;
pub mod confinement;
pub mod definition;
pub mod hooks;
pub mod permission;
pub mod trust;

pub use approval::{Always, Approver, Asking, Never};
pub use confinement::{Confinement, config_dir};
pub use hooks::Hooks;
pub use permission::{AllowAll, Allowlist, Ask, Decision, Gate, ReadOnly};
