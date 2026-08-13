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
    /// Reconhecer isso é o que separa uma sessão que se recupera compactando de
    /// uma que morre no meio da tarefa. O gateway documenta o literal
    /// `"prompt is too long"` dentro de um 400, mas ele é o que a Anthropic diz
    /// — e o gateway serve outros backends, cada um com a sua redação.
    ///
    /// A lista é de campo, não de especificação: nenhum provedor promete o texto
    /// da mensagem de erro. Por isso ela cresce em vez de ser derivada, e por
    /// isso o gatilho por limiar do [ADR-0027] existe — casar texto é a rede de
    /// segurança, não o mecanismo.
    ///
    /// [ADR-0027]: ../../../docs/architecture/decisions/0027-a-compactacao-dispara-por-limiar-e-o-erro-e-a-rede.md
    #[must_use]
    pub fn is_context_overflow(&self) -> bool {
        /// Marcadores em minúsculas, casados contra a mensagem e contra o tipo.
        const MARKERS: &[&str] = &[
            "prompt is too long",
            "context_length_exceeded",
            "context length exceeded",
            "maximum context length",
            "exceeds the maximum length",
            "too many tokens",
            "input is too long",
            "reduce the length of the messages",
            "request too large",
            "token count exceeds",
            "exceeds context window",
            "context window",
            "input length exceeds",
            "prompt token count",
        ];

        let message = self.message.to_ascii_lowercase();
        let kind = self.kind.to_ascii_lowercase();
        MARKERS
            .iter()
            .any(|marker| message.contains(marker) || kind.contains(marker))
    }

    /// Se repetir a mesma requisição pode ter resultado diferente.
    #[must_use]
    pub fn is_retryable(&self) -> bool {
        // Sem status é erro in-band de stream: o turno já começou, repetir
        // duplicaria efeitos colaterais de ferramenta. Não é retentável aqui.
        let Some(status) = self.status else {
            return false;
        };
        if self.is_exhausted() {
            return false;
        }
        matches!(status, 408 | 409 | 429 | 500 | 502 | 503 | 504)
    }

    /// Se o limite que produziu o erro não se refaz com o tempo.
    ///
    /// Um 429 quase sempre é vazão e passa com backoff. Cota esgotada e problema
    /// de faturamento chegam com o mesmo status e **não** passam: esperar ali
    /// gasta o orçamento de retentativa inteiro para repetir, no fim, a mesma
    /// mensagem que a primeira tentativa já trazia — e faz isso enquanto o
    /// usuário olha para uma tela parada.
    #[must_use]
    pub fn is_exhausted(&self) -> bool {
        const EXHAUSTED: &[&str] = &[
            "insufficient_quota",
            "insufficient quota",
            "quota exceeded",
            "exceeded your current quota",
            "out of credit",
            "out of budget",
            "billing",
            "payment required",
        ];
        let message = self.message.to_ascii_lowercase();
        EXHAUSTED.iter().any(|marker| message.contains(marker))
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
    fn overflow_is_recognised_in_every_wording_the_backends_use() {
        // Nenhum provedor promete o texto da mensagem, e o gateway serve
        // varios. Com dois padroes so, os demais degradavam em silencio ate a
        // sessao parar de funcionar sem explicacao.
        for wording in [
            "This model's maximum context length is 200000 tokens",
            "Request too large for gpt-5",
            "Please reduce the length of the messages",
            "input length exceeds the limit",
            "The prompt token count of 300000 exceeds context window",
        ] {
            assert!(
                api(Some(400), "invalid_request_error", wording).is_context_overflow(),
                "nao reconheceu: {wording}"
            );
        }
    }

    #[test]
    fn an_unrelated_four_hundred_is_not_mistaken_for_overflow() {
        // Compactar por um erro que compactar nao resolve custa um turno e
        // descarta contexto sem motivo.
        assert!(!api(Some(400), "invalid_request_error", "model not found").is_context_overflow());
        assert!(!api(Some(401), "authentication_error", "invalid api key").is_context_overflow());
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
    fn an_exhausted_quota_fails_at_once_instead_of_spending_the_retry_budget() {
        // Um 429 quase sempre e vazao e passa com backoff. Cota esgotada chega
        // com o mesmo status e nao passa: esperar ali gasta o orcamento inteiro
        // para repetir, no fim, a mensagem que a primeira tentativa ja trazia.
        for mensagem in [
            "You exceeded your current quota, please check your plan",
            "insufficient_quota",
            "Your account is out of credit",
            "billing hard limit reached",
        ] {
            let err = api(Some(429), "rate_limit_error", mensagem);
            assert!(
                !err.is_retryable(),
                "{mensagem:?} nao deveria gastar retentativa"
            );
        }
    }

    #[test]
    fn an_ordinary_rate_limit_is_still_retried() {
        // A guarda nao pode transformar vazao — o caso comum, que passa com
        // espera — em falha imediata.
        let err = api(Some(429), "rate_limit_error", "Too many requests");
        assert!(err.is_retryable());
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
