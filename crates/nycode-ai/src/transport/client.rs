//! Cliente HTTP com streaming, agnóstico de dialeto.

use eventsource_stream::{EventStreamError, Eventsource};
use futures_util::Stream;

use super::retry::{Policy, parse_retry_after};
use crate::anthropic::{Message, ToolSpec};
use crate::config::Config;
use crate::dialect::{Dialect, UnifiedRequest};
use crate::error::{Error, Result};
use crate::event::StreamEvent;

/// Header com que o gateway sinaliza contagem heurística de tokens.
const ESTIMATED_USAGE_HEADER: &str = "x-nylla-usage-estimated";

/// Um prazo estourado no meio do corpo é o gateway tendo ficado mudo.
///
/// O `read_timeout` reinicia a cada chunk recebido, então chegar aqui significa
/// que o intervalo entre dois eventos passou do teto — não que o corpo veio
/// quebrado.
impl super::stream::TransportFailure for EventStreamError<reqwest::Error> {
    fn is_idle(&self) -> bool {
        matches!(self, Self::Transport(err) if err.is_timeout())
    }

    fn describe(&self) -> String {
        self.to_string()
    }
}

pub struct Client {
    http: reqwest::Client,
    config: Config,
    dialect: Box<dyn Dialect>,
    retry: Policy,
    sampling: crate::sampling::Sampling,
}

impl std::fmt::Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Client")
            .field("dialect", &self.dialect.name())
            .field("model", &self.config.model)
            .field("retry", &self.retry)
            .finish_non_exhaustive()
    }
}

impl Client {
    pub fn new(config: Config) -> Result<Self> {
        // Prazo de ociosidade, nao de duracao (ADR-0014): `read_timeout`
        // reinicia a cada chunk, entao mede o intervalo entre eventos do SSE e
        // nao o tempo do turno. Um `timeout` total aqui mataria resposta longa.
        let http = reqwest::Client::builder()
            .user_agent(concat!("nycode/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(config.timeouts.connect)
            .read_timeout(config.timeouts.stream_idle)
            .build()?;
        let dialect = config.dialect.build();
        Ok(Self {
            http,
            config,
            dialect,
            retry: Policy::default(),
            sampling: crate::sampling::Sampling::default(),
        })
    }

    /// Substitui os parâmetros de amostragem e cache.
    #[must_use]
    pub fn with_sampling(mut self, sampling: crate::sampling::Sampling) -> Self {
        self.sampling = sampling;
        self
    }

    /// A amostragem desta sessão, para quem precisa derivar outra dela.
    #[must_use]
    pub const fn sampling(&self) -> &crate::sampling::Sampling {
        &self.sampling
    }

    /// Parâmetros configurados que o dialeto em uso não sabe emitir.
    ///
    /// Quem monta a sessão consulta e conta ao usuário. Um parâmetro
    /// configurado e descartado sem aviso é a degradação silenciosa do NFR-4 —
    /// só que na ida do pedido, onde ninguém estava olhando.
    #[must_use]
    pub fn unsupported_sampling(&self) -> Vec<&'static str> {
        self.dialect.unsupported_sampling(&self.sampling)
    }

    /// Empresta o cliente HTTP, para quem precisa falar com o mesmo endpoint.
    ///
    /// O catálogo de modelos usa este, e não um segundo cliente: pool de
    /// conexões, user-agent e TLS já estão configurados aqui.
    #[must_use]
    pub const fn http(&self) -> &reqwest::Client {
        &self.http
    }

    #[must_use]
    pub const fn with_retry(mut self, retry: Policy) -> Self {
        self.retry = retry;
        self
    }

    #[must_use]
    pub const fn config(&self) -> &Config {
        &self.config
    }

    #[must_use]
    pub fn dialect_name(&self) -> &'static str {
        self.dialect.name()
    }

    /// Abre um turno em streaming.
    ///
    /// O erro de status é resolvido antes de devolver o stream, para que o
    /// chamador não precise distinguir falha de conexão de falha de protocolo no
    /// meio da iteração. Só esta fase é retentada: depois que o stream abre e
    /// ferramentas rodam, repetir duplicaria efeitos colaterais.
    ///
    /// Cancelar é derrubar o stream. Não há estado global a limpar.
    ///
    /// O `use<>` declara que o stream não captura `&self`: o `reqwest::Client` é
    /// clonado dentro do builder e a resposta é própria. Sem isso a edition 2024
    /// ata o retorno ao empréstimo e ele não pode virar `BoxStream<'static>`.
    pub async fn stream(
        &self,
        messages: Vec<Message>,
        system: Option<String>,
        tools: Vec<ToolSpec>,
    ) -> Result<impl Stream<Item = Result<StreamEvent>> + Send + use<>> {
        self.stream_with(messages, system, tools, self.sampling.clone())
            .await
    }

    /// O mesmo, com a amostragem desta chamada.
    ///
    /// Existe para o pedido de uma vez só: um resumo não é prefixo de nada e
    /// não se repete no turno seguinte, então marcá-lo para o cache cobraria
    /// escrita que ninguém vai reusar.
    pub async fn stream_with(
        &self,
        messages: Vec<Message>,
        system: Option<String>,
        tools: Vec<ToolSpec>,
        sampling: crate::sampling::Sampling,
    ) -> Result<impl Stream<Item = Result<StreamEvent>> + Send + use<>> {
        let body = self.dialect.body(&UnifiedRequest {
            model: &self.config.model,
            max_tokens: self.config.max_tokens,
            messages: &messages,
            system: system.as_deref(),
            tools: &tools,
            sampling: &sampling,
        });

        let mut attempt = 1;
        loop {
            match self.attempt(&body).await {
                Ok(stream) => return Ok(stream),
                Err(err) if err.is_retryable() && self.retry.should_retry(attempt) => {
                    // Espalhada: `N` sessões que receberam o mesmo 503 esperam
                    // o mesmo tanto e batem no backend juntas de novo, que é
                    // como uma falha transitória vira permanente.
                    let delay = super::retry::spread(
                        self.retry.delay(attempt, retry_after_of(&err)),
                        super::retry::entropy(),
                    );
                    tracing::warn!(
                        attempt,
                        delay_ms = delay.as_millis(),
                        error = %err,
                        "tentativa falhou, aguardando"
                    );
                    tokio::time::sleep(delay).await;
                    attempt += 1;
                }
                Err(err) => return Err(err),
            }
        }
    }

    async fn attempt(
        &self,
        body: &serde_json::Value,
    ) -> Result<impl Stream<Item = Result<StreamEvent>> + Send + use<>> {
        let mut request = self
            .http
            .post(self.config.endpoint(self.dialect.route()))
            .header("accept", "text/event-stream")
            .json(body);

        for (name, value) in self.dialect.headers(&self.config.api_key) {
            request = request.header(name, value);
        }

        let response = request.send().await?;
        let status = response.status();
        let estimated = response.headers().contains_key(ESTIMATED_USAGE_HEADER);
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| parse_retry_after(v, super::retry::now_secs()));

        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            let mut api = self.dialect.parse_error(status.as_u16(), &text);
            api.retry_after = retry_after;
            return Err(Error::Api(api));
        }

        let mut decoder = self.dialect.decoder();
        if estimated {
            decoder.mark_usage_estimated();
        }

        Ok(super::stream::decode(
            response.bytes_stream().eventsource(),
            decoder,
        ))
    }
}

fn retry_after_of(err: &Error) -> Option<std::time::Duration> {
    match err {
        Error::Api(api) => api.retry_after,
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dialect::Kind;
    use std::time::Duration;

    fn config(url: &str) -> Config {
        Config::new(url, "chave").expect("config valida")
    }

    #[test]
    fn the_client_reports_the_dialect_it_speaks() {
        let client = Client::new(config("https://gw/v1")).unwrap();
        assert_eq!(client.dialect_name(), "anthropic-messages");

        let chat = Client::new(config("https://gw/v1").with_dialect(Kind::OpenAiChat)).unwrap();
        assert_eq!(chat.dialect_name(), "openai-completions");
    }

    #[test]
    fn the_route_follows_the_dialect() {
        let anthropic = Client::new(config("https://gw/v1")).unwrap();
        assert_eq!(
            anthropic.config().endpoint(anthropic.dialect.route()),
            "https://gw/v1/messages"
        );

        let responses =
            Client::new(config("https://gw/v1").with_dialect(Kind::OpenAiResponses)).unwrap();
        assert_eq!(
            responses.config().endpoint(responses.dialect.route()),
            "https://gw/v1/responses"
        );
    }

    #[test]
    fn retry_after_is_extracted_only_from_api_errors() {
        let with_hint = Error::Api(crate::ApiError {
            status: Some(429),
            kind: "rate_limit".to_owned(),
            message: String::new(),
            retry_after: Some(Duration::from_secs(3)),
        });
        assert_eq!(retry_after_of(&with_hint), Some(Duration::from_secs(3)));
        assert_eq!(retry_after_of(&Error::TruncatedStream { bytes: 1 }), None);
    }

    #[tokio::test]
    async fn a_transient_failure_is_retried_and_then_succeeds() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        // Primeiro 503, depois sucesso. Sem retentativa, o turno morreria aqui.
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(ResponseTemplate::new(503).set_body_string("indisponivel"))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(
                "event: message\ndata: {\"type\":\"message_stop\"}\n\n",
                "text/event-stream",
            ))
            .mount(&server)
            .await;

        let client = Client::new(config(&format!("{}/v1", server.uri())))
            .unwrap()
            .with_retry(Policy {
                initial: Duration::from_millis(1),
                ..Policy::default()
            });

        assert!(
            client
                .stream(vec![Message::user("oi")], None, vec![])
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn a_client_error_is_not_retried() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        // `expect(1)` falha o teste se a retentativa acontecer: repetir um 400
        // nunca muda o resultado e so gasta a cota do usuario.
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(ResponseTemplate::new(400).set_body_string(
                r#"{"error":{"type":"invalid_request_error","message":"campo ausente"}}"#,
            ))
            .expect(1)
            .mount(&server)
            .await;

        let client = Client::new(config(&format!("{}/v1", server.uri())))
            .unwrap()
            .with_retry(Policy {
                initial: Duration::from_millis(1),
                ..Policy::default()
            });

        let result = client.stream(vec![Message::user("oi")], None, vec![]).await;
        assert!(matches!(result, Err(Error::Api(api)) if api.kind == "invalid_request_error"));
    }

    #[tokio::test]
    async fn a_gateway_that_never_answers_fails_instead_of_hanging() {
        // Sem prazo, um gateway que aceita a conexao e para de falar pendura o
        // turno para sempre, e a unica saida e o usuario apertar Ctrl+C.
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(30)))
            .mount(&server)
            .await;

        let client = Client::new(config(&format!("{}/v1", server.uri())).with_timeouts(
            crate::config::Timeouts {
                stream_idle: Duration::from_millis(50),
                ..crate::config::Timeouts::default()
            },
        ))
        .unwrap()
        .with_retry(Policy::none());

        let result = client.stream(vec![Message::user("oi")], None, vec![]).await;
        assert!(
            matches!(&result, Err(Error::Transport(inner)) if inner.is_timeout()),
            "esperava estouro de prazo"
        );
    }

    #[tokio::test]
    async fn a_body_timeout_is_idle_and_a_broken_body_is_not() {
        // `reqwest::Error` nao tem construtor publico, entao o erro de prazo vem
        // de um prazo real estourado.
        use super::super::stream::TransportFailure;
        use wiremock::matchers::method;
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(30)))
            .mount(&server)
            .await;

        let timed_out = reqwest::Client::builder()
            .read_timeout(Duration::from_millis(50))
            .build()
            .unwrap()
            .get(server.uri())
            .send()
            .await
            .expect_err("esperava estouro de prazo");
        assert!(timed_out.is_timeout());

        assert!(EventStreamError::Transport(timed_out).is_idle());

        // Um corpo que veio quebrado continua sendo outra coisa.
        let broken: EventStreamError<reqwest::Error> =
            EventStreamError::Utf8(String::from_utf8(vec![0xff]).unwrap_err());
        assert!(!broken.is_idle());
        assert!(broken.describe().contains("UTF8"));
    }

    #[tokio::test]
    async fn the_attempt_budget_is_finite() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(ResponseTemplate::new(503))
            .expect(3)
            .mount(&server)
            .await;

        let client = Client::new(config(&format!("{}/v1", server.uri())))
            .unwrap()
            .with_retry(Policy {
                max_attempts: 3,
                initial: Duration::from_millis(1),
                max_delay: Duration::from_millis(5),
            });

        assert!(
            client
                .stream(vec![Message::user("oi")], None, vec![])
                .await
                .is_err()
        );
    }
}
