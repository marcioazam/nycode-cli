//! Erros do loop de agente.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error(transparent)]
    Wire(#[from] nycode_ai::Error),

    /// Um caminho tentou sair da raiz do workspace.
    #[error("caminho fora da raiz do workspace: {0}")]
    PathEscape(String),

    #[error("workspace: {0}")]
    Workspace(String),

    #[error("aleatoriedade criptografica indisponivel: {0}")]
    Randomness(String),

    /// O modelo pediu uma ferramenta que não existe.
    ///
    /// Isto não aborta o turno — vira resultado de erro para o modelo corrigir.
    /// O tipo existe para o caso em que o chamador precisa distinguir.
    #[error("ferramenta desconhecida: {0}")]
    UnknownTool(String),

    /// O modelo emitiu argumentos de ferramenta que não são JSON válido.
    #[error("argumentos invalidos para `{tool}`: {reason}")]
    InvalidToolInput { tool: String, reason: String },

    /// O turno excedeu o teto de iterações de ferramenta.
    ///
    /// Sem este teto um modelo em loop consome a cota inteira sem produzir nada.
    #[error("turno excedeu {limit} iteracoes de ferramenta sem concluir")]
    ToolLoopLimit { limit: usize },

    #[error("cancelado")]
    Cancelled,
}

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn messages_name_the_offending_input() {
        let err = Error::PathEscape("../etc/passwd".to_owned());
        assert!(err.to_string().contains("../etc/passwd"));

        let err = Error::InvalidToolInput {
            tool: "read".to_owned(),
            reason: "json truncado".to_owned(),
        };
        assert!(err.to_string().contains("read"));
        assert!(err.to_string().contains("json truncado"));
    }

    #[test]
    fn wire_errors_pass_through_transparently() {
        let wire = nycode_ai::Error::TruncatedStream { bytes: 7 };
        let wrapped = Error::from(wire);
        // `transparent` preserva a mensagem original: um erro de wire nao pode
        // ganhar uma camada de prefixo que esconda o que aconteceu.
        assert_eq!(
            wrapped.to_string(),
            "stream terminou sem evento de encerramento apos 7 bytes"
        );
    }

    #[test]
    fn loop_limit_reports_the_limit_it_hit() {
        assert!(
            Error::ToolLoopLimit { limit: 25 }
                .to_string()
                .contains("25")
        );
    }
}
