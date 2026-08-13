//! Abstração de dialeto de wire.
//!
//! O gateway serve a mesma conversa em três formatos. O cliente não conhece
//! nenhum deles: ele conhece este trait. Isso é o que permite trocar de dialeto
//! por configuração e, mais importante, testar cada projeção isoladamente contra
//! o contrato que o gateway documenta.

use serde_json::Value;

use crate::anthropic::{Message, ToolSpec};
use crate::error::{ApiError, Result};
use crate::event::StreamEvent;

/// Pedido no formato canônico interno, antes de virar wire.
#[derive(Debug, Clone, Copy)]
pub struct UnifiedRequest<'a> {
    pub model: &'a str,
    pub max_tokens: u32,
    pub messages: &'a [Message],
    pub system: Option<&'a str>,
    pub tools: &'a [ToolSpec],
    pub sampling: &'a crate::sampling::Sampling,
}

/// Projeta eventos SSE de um dialeto no vocabulário canônico.
pub trait StreamDecoder: Send {
    fn decode(&mut self, raw: &str) -> Result<Option<StreamEvent>>;

    /// Se o stream chegou ao encerramento explícito do dialeto.
    fn completed(&self) -> bool;

    fn mark_usage_estimated(&mut self);

    /// Evento que o dialeto só consegue emitir depois do encerramento.
    ///
    /// Existe por causa do `responses`, que concentra `stop_reason` e usage no
    /// mesmo evento de wire — e [`Self::decode`] devolve um evento por linha.
    /// Anthropic e Chat têm evento terminal próprio para o usage e não precisam
    /// disto, então o padrão é não emitir nada.
    fn trailing(&mut self) -> Option<StreamEvent> {
        None
    }
}

/// Um formato de wire servido pelo gateway.
pub trait Dialect: Send + Sync {
    /// Rota relativa à base, sem barra inicial.
    fn route(&self) -> &'static str;

    /// Cabeçalhos específicos do dialeto, incluindo o de autenticação.
    ///
    /// Cada dialeto autentica de um jeito: Anthropic usa `x-api-key`, OpenAI usa
    /// `Authorization: Bearer`. Mandar o errado produz 401 sem pista.
    fn headers(&self, api_key: &str) -> Vec<(&'static str, String)>;

    fn body(&self, request: &UnifiedRequest<'_>) -> Value;

    fn decoder(&self) -> Box<dyn StreamDecoder>;

    /// Extrai o envelope de erro de uma resposta não-2xx.
    fn parse_error(&self, status: u16, body: &str) -> ApiError;

    /// Nome para diagnóstico.
    fn name(&self) -> &'static str;
}

/// Dialetos disponíveis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Kind {
    /// `POST /v1/messages`. Caminho primário.
    #[default]
    AnthropicMessages,
    /// `POST /v1/chat/completions`.
    OpenAiChat,
    /// `POST /v1/responses`.
    OpenAiResponses,
}

impl Kind {
    /// Constrói o dialeto correspondente.
    #[must_use]
    pub fn build(self) -> Box<dyn Dialect> {
        match self {
            Self::AnthropicMessages => Box::new(crate::anthropic::Messages),
            Self::OpenAiChat => Box::new(crate::openai::Chat),
            Self::OpenAiResponses => Box::new(crate::openai::Responses),
        }
    }

    /// Analisa o nome usado em configuração.
    ///
    /// Os nomes seguem os que o gateway e clientes conhecidos já usam, para que
    /// uma configuração existente possa ser transposta sem tradução.
    pub fn parse(raw: &str) -> Result<Self> {
        match raw {
            "anthropic-messages" | "messages" => Ok(Self::AnthropicMessages),
            "openai-completions" | "chat_completions" | "chat" => Ok(Self::OpenAiChat),
            "openai-responses" | "responses" => Ok(Self::OpenAiResponses),
            other => Err(crate::error::Error::Config(format!(
                "dialeto desconhecido `{other}`; use anthropic-messages, \
                 openai-completions ou openai-responses"
            ))),
        }
    }
}

/// Extrai `type` e `message` de um envelope de erro aninhado sob `error`.
///
/// O corpo pode não ser JSON quando a falha vem de um proxy no caminho, então o
/// texto cru é preservado em vez de virar uma mensagem genérica que apaga a
/// única pista de onde a falha aconteceu.
pub(crate) fn parse_nested_error(status: u16, body: &str, default_kind: &str) -> ApiError {
    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let error = parsed.as_ref().and_then(|v| v.get("error"));
    let field = |name: &str| error.and_then(|e| e.get(name)).and_then(Value::as_str);

    ApiError {
        status: Some(status),
        kind: field("type")
            .or_else(|| field("code"))
            .unwrap_or(default_kind)
            .to_owned(),
        message: field("message").unwrap_or(body).to_owned(),
        retry_after: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dialect_names_from_existing_configuration_are_accepted() {
        // Os nomes vem do que o gateway e clientes conhecidos ja usam: uma
        // configuracao existente precisa ser transposta sem traducao.
        assert_eq!(
            Kind::parse("anthropic-messages").unwrap(),
            Kind::AnthropicMessages
        );
        assert_eq!(Kind::parse("messages").unwrap(), Kind::AnthropicMessages);
        assert_eq!(Kind::parse("openai-completions").unwrap(), Kind::OpenAiChat);
        assert_eq!(Kind::parse("chat_completions").unwrap(), Kind::OpenAiChat);
        assert_eq!(Kind::parse("responses").unwrap(), Kind::OpenAiResponses);
    }

    #[test]
    fn an_unknown_dialect_names_the_valid_options() {
        let err = Kind::parse("grpc").unwrap_err();
        let message = err.to_string();
        assert!(message.contains("grpc"));
        assert!(message.contains("anthropic-messages"));
        assert!(message.contains("openai-responses"));
    }

    #[test]
    fn the_default_is_the_primary_path() {
        assert_eq!(Kind::default(), Kind::AnthropicMessages);
    }

    #[test]
    fn every_dialect_builds_with_a_distinct_route() {
        let routes: Vec<_> = [
            Kind::AnthropicMessages,
            Kind::OpenAiChat,
            Kind::OpenAiResponses,
        ]
        .iter()
        .map(|k| k.build().route())
        .collect();
        assert_eq!(routes, vec!["messages", "chat/completions", "responses"]);
    }

    #[test]
    fn each_dialect_authenticates_with_its_own_header() {
        // Mandar `x-api-key` para um endpoint OpenAI produz 401 sem pista.
        let anthropic = Kind::AnthropicMessages.build().headers("segredo");
        assert!(
            anthropic
                .iter()
                .any(|(k, v)| *k == "x-api-key" && v == "segredo")
        );

        let openai = Kind::OpenAiChat.build().headers("segredo");
        assert!(
            openai
                .iter()
                .any(|(k, v)| *k == "authorization" && v == "Bearer segredo")
        );
    }

    #[test]
    fn nested_error_envelopes_are_parsed_and_non_json_is_preserved() {
        let err = parse_nested_error(
            400,
            r#"{"error":{"type":"invalid_request_error","message":"prompt is too long"}}"#,
            "http_error",
        );
        assert_eq!(err.kind, "invalid_request_error");
        assert!(err.is_context_overflow());

        let raw = parse_nested_error(502, "<html>bad gateway</html>", "http_error");
        assert_eq!(raw.kind, "http_error");
        assert_eq!(raw.message, "<html>bad gateway</html>");
    }

    #[test]
    fn openai_style_error_codes_are_read_from_the_code_field() {
        // OpenAI usa `code` onde Anthropic usa `type`; ler so um dos dois
        // perderia `context_length_exceeded` e o auto-compact nao dispararia.
        let err = parse_nested_error(
            400,
            r#"{"error":{"code":"context_length_exceeded","message":"too long"}}"#,
            "http_error",
        );
        assert_eq!(err.kind, "context_length_exceeded");
        assert!(err.is_context_overflow());
    }
}
