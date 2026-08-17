//! Encontrar coisas no workspace sem alterá-lo.
//!
//! As três compartilham a varredura e mudam juntas: o que uma delas passa a
//! ignorar, as outras precisam ignorar também, senão `find` oferece um caminho
//! que `grep` nunca vai visitar.
//!
//! Existem para a sessão restringida. O agente já tem `bash` e poderia chamar
//! `grep` por lá; sem estas, negar `bash` o deixa cego, e a escolha passa a ser
//! entre dar shell ou não ter agente.

mod cap;
mod collect;
mod engine;
mod find;
mod grep;
mod ls;

pub use find::Find;
pub use grep::Grep;
pub use ls::Ls;
