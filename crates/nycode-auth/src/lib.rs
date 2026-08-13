// Ver a nota equivalente em `nycode-ai`: asserção de teste usa `unwrap`.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

//! Resolução de credenciais.
//!
//! A API é **síncrona por decisão**. O backend Secret Service do `keyring` faz
//! I/O bloqueante e a variante assíncrona dele deadlocka quando chamada da
//! thread principal de um runtime async. Resolver a credencial antes de entrar
//! no runtime elimina a classe inteira de problema em vez de administrá-la.
//!
//! O caminho de OAuth de assinatura vive em [`subscription`] e só existe sob a
//! feature `subscription-oauth`. Ver ADR-0001.

pub mod resolver;

#[cfg(feature = "subscription-oauth")]
pub mod subscription;

pub use resolver::{Credential, Resolver, Source};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("nenhuma credencial encontrada para `{service}`; tente {hint}")]
    NotFound { service: String, hint: String },

    #[error("cofre de credenciais do sistema indisponivel: {0}")]
    Keyring(String),
}

pub type Result<T> = std::result::Result<T, Error>;
