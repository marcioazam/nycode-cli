//! Erros de conexão com um servidor MCP.

use thiserror::Error;

/// O que pode dar errado ao alcançar um servidor.
///
/// O nome do servidor entra em toda variante porque uma sessão fala com vários,
/// e "falhou ao conectar" sem dizer qual não ajuda ninguém a corrigir o
/// `.mcp.json`.
#[derive(Debug, Error)]
pub enum Error {
    /// A entrada de configuração não descreve um servidor alcançável.
    #[error("servidor `{server}`: {reason}")]
    Config { server: String, reason: String },

    /// O processo não subiu, ou o endpoint não respondeu.
    #[error("servidor `{server}`: nao foi possivel conectar: {reason}")]
    Connect { server: String, reason: String },

    /// Conectou, mas não foi possível listar as ferramentas.
    #[error("servidor `{server}`: nao foi possivel listar ferramentas: {reason}")]
    List { server: String, reason: String },

    /// O servidor aceitou a conexão e depois emudeceu.
    ///
    /// Separada de `Connect` porque o remédio é outro: recusa é configuração
    /// errada, silêncio é servidor travado.
    #[error("servidor `{server}`: {stage} nao respondeu em {seconds}s")]
    Timeout {
        server: String,
        /// Etapa que estourou o prazo.
        stage: &'static str,
        seconds: u64,
    },
}

impl Error {
    /// Nome do servidor que falhou.
    #[must_use]
    pub fn server(&self) -> &str {
        match self {
            Self::Config { server, .. }
            | Self::Connect { server, .. }
            | Self::List { server, .. }
            | Self::Timeout { server, .. } => server,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_message_names_the_server_that_failed() {
        // Uma sessao fala com varios servidores; sem o nome, o usuario nao sabe
        // qual entrada do `.mcp.json` corrigir.
        let cases = [
            Error::Config {
                server: "docs".to_owned(),
                reason: "nao declara `command` nem `url`".to_owned(),
            },
            Error::Connect {
                server: "docs".to_owned(),
                reason: "arquivo nao encontrado".to_owned(),
            },
            Error::List {
                server: "docs".to_owned(),
                reason: "timeout".to_owned(),
            },
            Error::Timeout {
                server: "docs".to_owned(),
                stage: "o handshake",
                seconds: 20,
            },
        ];

        for err in cases {
            assert!(err.to_string().contains("docs"), "{err}");
            assert_eq!(err.server(), "docs");
        }
    }

    #[test]
    fn the_underlying_reason_survives_the_wrapping() {
        // Trocar o motivo por uma mensagem generica esconderia justamente o que
        // diz se o problema e configuracao ou ambiente.
        let err = Error::Connect {
            server: "a".to_owned(),
            reason: "No such file or directory (os error 2)".to_owned(),
        };
        assert!(err.to_string().contains("os error 2"));
    }
}
