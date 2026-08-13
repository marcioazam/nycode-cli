//! Erros do cliente de wire.
//!
//! O gateway emite erros de duas formas: como resposta HTTP com corpo no
//! envelope do dialeto, e **in-band**, no meio de um stream SSE já iniciado. A
//! segunda é a que costuma ser engolida por clientes ingênuos, que veem o stream
//! terminar e tratam como sucesso. [`Error::Api`] existe para que os dois
//! caminhos cheguem ao chamador com a mesma forma.

use thiserror::Error;

/// Um erro reportado pelo backend, no envelope do dialeto.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiError {
    /// Status HTTP quando houve um; `None` para erro in-band de stream.
    pub status: Option<u16>,
    /// Tipo do erro no vocabulário do dialeto, ex. `invalid_request_error`.
    pub kind: String,
    pub message: String,
    /// Espera pedida pelo servidor via `Retry-After`, quando houve.
    pub retry_after: Option<std::time::Duration>,
}

impl ApiError {
    /// Se este erro indica que o prompt excedeu a janela de contexto.
    ///
    /// O gateway documenta que o auto-compact do cliente dispara no literal
    /// `"prompt is too long"` dentro de um 400. Reconhecer isso é o que separa
    /// uma sessão que se recupera compactando de uma que morre no meio da tarefa.
    #[must_use]
    pub fn is_context_overflow(&self) -> bool {
        const OVERFLOW_MARKER: &str = "prompt is too long";
        const OPENAI_MARKER: &str = "context_length_exceeded";

        self.kind == OPENAI_MARKER
            || self.message.to_ascii_lowercase().contains(OVERFLOW_MARKER)
            || self.message.contains(OPENAI_MARKER)
    }

    /// Se repetir a mesma requisição pode ter resultado diferente.
    #[must_use]
    pub fn is_retryable(&self) -> bool {
        // Sem status é erro in-band de stream: o turno já começou, repetir
        // duplicaria efeitos colaterais de ferramenta. Não é retentável aqui.
        let Some(status) = self.status else {
            return false;
        };
        matches!(status, 408 | 409 | 429 | 500 | 502 | 503 | 504)
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.status {
            Some(status) => write!(f, "{status} {}: {}", self.kind, self.message),
            None => write!(f, "{} (in-band): {}", self.kind, self.message),
        }
    }
}

#[derive(Debug, Error)]
pub enum Error {
    #[error("transporte: {0}")]
    Transport(#[from] reqwest::Error),

    #[error("{0}")]
    Api(ApiError),

    #[error("stream malformado: {0}")]
    MalformedStream(String),

    /// O stream terminou sem `message_stop`.
    ///
    /// Sinalizar isso em vez de retornar o texto parcial como se fosse completo
    /// é o que impede uma resposta truncada de ser tratada como resposta.
    #[error("stream terminou sem evento de encerramento apos {bytes} bytes")]
    TruncatedStream { bytes: usize },

    /// O gateway aceitou a conexão e parou de enviar.
    ///
    /// Separado de [`Self::MalformedStream`] porque o corpo não veio quebrado, e
    /// de [`Self::TruncatedStream`] porque ele não terminou. Achatar os três num
    /// só mandaria o usuário depurar a coisa errada.
    #[error("o gateway parou de enviar dados apos {bytes} bytes")]
    StreamIdle { bytes: usize },

    #[error("configuracao: {0}")]
    Config(String),

    #[error("cancelado pelo chamador")]
    Cancelled,
}

impl Error {
    /// Atalho para o caso de estouro de contexto, que o loop de agente trata
    /// compactando em vez de abortar.
    #[must_use]
    pub fn is_context_overflow(&self) -> bool {
        matches!(self, Self::Api(api) if api.is_context_overflow())
    }

    #[must_use]
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Api(api) => api.is_retryable(),
            Self::Transport(err) => err.is_timeout() || err.is_connect(),
            _ => false,
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    fn api(status: Option<u16>, kind: &str, message: &str) -> ApiError {
        ApiError {
            status,
            kind: kind.to_owned(),
            message: message.to_owned(),
            retry_after: None,
        }
    }

    #[test]
    fn recognizes_the_literal_auto_compact_trigger() {
        // O gateway documenta que o auto-compact dispara no literal
        // "prompt is too long" dentro de um 400.
        let err = api(
            Some(400),
            "invalid_request_error",
            "prompt is too long: 250000 tokens",
        );
        assert!(err.is_context_overflow());
    }

    #[test]
    fn recognizes_the_openai_context_overflow_shape() {
        assert!(api(Some(400), "context_length_exceeded", "too many tokens").is_context_overflow());
    }

    #[test]
    fn an_ordinary_bad_request_is_not_context_overflow() {
        // Confundir os dois faria o agente compactar a sessao em resposta a um
        // erro de validacao, perdendo contexto sem motivo.
        let err = api(
            Some(400),
            "invalid_request_error",
            "messages: field required",
        );
        assert!(!err.is_context_overflow());
    }

    #[test]
    fn in_band_stream_errors_are_never_retried() {
        // O turno ja comecou; ferramentas podem ter rodado. Repetir duplicaria
        // efeitos colaterais.
        let err = api(None, "overloaded_error", "backend indisponivel");
        assert!(!err.is_retryable());
    }

    #[test]
    fn transient_http_statuses_are_retryable_but_client_errors_are_not() {
        for status in [408, 409, 429, 500, 502, 503, 504] {
            assert!(
                api(Some(status), "x", "y").is_retryable(),
                "{status} deveria ser retentavel"
            );
        }
        for status in [400, 401, 403, 404, 422] {
            assert!(
                !api(Some(status), "x", "y").is_retryable(),
                "{status} nao e retentavel"
            );
        }
    }

    #[test]
    fn in_band_errors_are_visually_distinct_from_http_errors() {
        assert_eq!(
            api(Some(429), "rate_limit", "devagar").to_string(),
            "429 rate_limit: devagar"
        );
        assert_eq!(
            api(None, "overloaded_error", "devagar").to_string(),
            "overloaded_error (in-band): devagar"
        );
    }

    #[test]
    fn error_wrapper_forwards_overflow_and_retry_predicates() {
        let overflow = Error::Api(api(
            Some(400),
            "invalid_request_error",
            "prompt is too long",
        ));
        assert!(overflow.is_context_overflow());
        assert!(!overflow.is_retryable());

        let truncated = Error::TruncatedStream { bytes: 42 };
        assert!(!truncated.is_context_overflow());
        assert!(!truncated.is_retryable());
        assert!(truncated.to_string().contains("42"));
    }
}
