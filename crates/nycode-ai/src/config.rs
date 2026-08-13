//! Configuração de conexão com um endpoint compatível.

use std::time::Duration;

use crate::error::{Error, Result};

/// Prazos de rede de um endpoint.
///
/// São de ociosidade, não de duração
/// ([ADR-0014](../../../docs/architecture/decisions/0014-prazos-de-rede-do-cliente-de-wire.md)).
/// Um turno com raciocínio estendido leva minutos, então o teto que protege
/// contra um gateway morto seria o mesmo número que mataria uma resposta longa
/// e saudável. O que distingue os dois casos não é quanto tempo o turno levou,
/// é há quanto tempo o gateway não manda um byte.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Timeouts {
    /// Teto do aperto de mão.
    pub connect: Duration,
    /// Silêncio tolerado entre dois eventos do stream.
    pub stream_idle: Duration,
    /// Duração total da busca de catálogo, que não é streaming e por isso
    /// admite prazo fechado.
    pub catalog: Duration,
}

impl Default for Timeouts {
    fn default() -> Self {
        Self {
            connect: Duration::from_secs(10),
            // Dois minutos de silencio absoluto num protocolo de streaming e um
            // stream morto; um turno que emite deltas ou `ping` nunca chega
            // perto.
            stream_idle: Duration::from_mins(2),
            // Roda no arranque, antes de a interface abrir: sem teto, um
            // gateway mudo trava o binario sem desenhar nada na tela.
            catalog: Duration::from_secs(10),
        }
    }
}

/// Endpoint e credencial de um provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// URL base, sem barra final e já incluindo o prefixo de versão.
    ///
    /// O gateway é servido em `https://host/v1`; a rota do dialeto é anexada a
    /// partir daí.
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub max_tokens: u32,
    /// Formato de wire falado com este endpoint.
    pub dialect: crate::dialect::Kind,
    /// Prazos de rede aplicados a este endpoint.
    pub timeouts: Timeouts,
}

impl Config {
    /// Valores padrão apontando para um gateway local.
    ///
    /// O ponto do `nycode` é abrir sessão sem o usuário configurar endpoint,
    /// credencial ou catálogo — então o padrão precisa ser o gateway.
    pub const DEFAULT_BASE_URL: &'static str = "http://127.0.0.1:8080/v1";
    pub const DEFAULT_MODEL: &'static str = "nylla-sonnet-4.5";
    pub const DEFAULT_MAX_TOKENS: u32 = 8192;

    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Result<Self> {
        let base_url = base_url.into();
        let trimmed = base_url.trim_end_matches('/');
        if trimmed.is_empty() {
            return Err(Error::Config("base_url vazia".to_owned()));
        }
        if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
            return Err(Error::Config(format!(
                "base_url precisa de esquema http(s): {base_url}"
            )));
        }
        Ok(Self {
            base_url: trimmed.to_owned(),
            api_key: api_key.into(),
            model: Self::DEFAULT_MODEL.to_owned(),
            max_tokens: Self::DEFAULT_MAX_TOKENS,
            dialect: crate::dialect::Kind::default(),
            timeouts: Timeouts::default(),
        })
    }

    /// Substitui os prazos de rede.
    ///
    /// Existe para que o comportamento sob gateway lento seja exercitável: um
    /// prazo fixado dentro do construtor só seria testável esperando o tempo
    /// real.
    #[must_use]
    pub const fn with_timeouts(mut self, timeouts: Timeouts) -> Self {
        self.timeouts = timeouts;
        self
    }

    /// Escolhe o formato de wire.
    #[must_use]
    pub const fn with_dialect(mut self, dialect: crate::dialect::Kind) -> Self {
        self.dialect = dialect;
        self
    }

    #[must_use]
    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = model.into();
        self
    }

    #[must_use]
    pub fn with_max_tokens(mut self, max_tokens: u32) -> Self {
        self.max_tokens = max_tokens;
        self
    }

    /// URL completa de uma rota do dialeto.
    #[must_use]
    pub fn endpoint(&self, path: &str) -> String {
        format!("{}/{}", self.base_url, path.trim_start_matches('/'))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn trailing_slash_does_not_produce_a_double_slash_route() {
        let cfg = Config::new("https://gw.example.com/v1/", "k").unwrap();
        assert_eq!(
            cfg.endpoint("messages"),
            "https://gw.example.com/v1/messages"
        );
        assert_eq!(
            cfg.endpoint("/messages"),
            "https://gw.example.com/v1/messages"
        );
    }

    #[test]
    fn rejects_base_url_without_scheme() {
        // Sem esquema o reqwest falharia so na primeira requisicao, longe da
        // origem do erro de configuracao.
        let err = Config::new("gw.example.com/v1", "k").expect_err("deveria recusar");
        assert!(matches!(err, Error::Config(msg) if msg.contains("esquema")));
    }

    #[test]
    fn rejects_empty_base_url() {
        assert!(matches!(Config::new("///", "k"), Err(Error::Config(_))));
        assert!(matches!(Config::new("", "k"), Err(Error::Config(_))));
    }

    #[test]
    fn defaults_point_at_the_gateway() {
        let cfg = Config::new(Config::DEFAULT_BASE_URL, "k").unwrap();
        assert_eq!(cfg.model, "nylla-sonnet-4.5");
        assert_eq!(cfg.max_tokens, Config::DEFAULT_MAX_TOKENS);
    }

    #[test]
    fn builders_override_defaults() {
        let cfg = Config::new("https://gw/v1", "k")
            .unwrap()
            .with_model("nylla-grok-4.5")
            .with_max_tokens(256);
        assert_eq!(cfg.model, "nylla-grok-4.5");
        assert_eq!(cfg.max_tokens, 256);
    }
}
