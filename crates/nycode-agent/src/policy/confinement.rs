//! O que o comando alcança depois de começar.
//!
//! É a última das quatro camadas de [`super`], e a única que o comando não
//! consegue ignorar: hook, gate e aprovador decidem se a chamada acontece, e
//! isto decide até onde ela chega. Sem ela, `--allow-writes` é cheque em branco
//! e a política do harness vira convenção que qualquer `cd ..` contorna.
//!
//! Os três módulos daqui respondem à mesma pergunta em superfícies diferentes:
//! [`sandbox`] pede ao sistema operacional o confinamento de caminho,
//! [`process`] contém o que o comando deixou vivo, e [`environment`] decide o
//! que ele consegue ler do ambiente de quem o chamou. Estavam soltos ao lado
//! das camadas de decisão, que mudam por outro motivo.

pub mod environment;
pub mod process;
pub mod sandbox;

pub use environment::config_dir;
pub use sandbox::Confinement;
