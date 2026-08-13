//! Parâmetros de amostragem e de cache do pedido.
//!
//! Existiam como buraco: o corpo enviado carregava modelo, teto de tokens,
//! mensagens, sistema e ferramentas, e mais nada. Sem `cache_control` o cache
//! de prompt do backend nunca acerta, e a contabilidade de cache que o `Usage`
//! já reportava media sempre zero — a métrica existia sem a causa (NFR-7).
//!
//! Depois existiram como buraco de outro tipo, pior de encontrar: o tipo estava
//! completo, `Client::with_sampling` estava escrito, e **nenhum dos dois tinha
//! chamador de produção**. Os dois dialetos OpenAI mencionavam `sampling` só
//! dentro de helper de teste. Temperatura, raciocínio e sequência de parada
//! eram código inalcançável com cobertura acima do piso.

pub mod thinking;

pub use thinking::{Effort, ThinkingLevel};

/// O que modula uma requisição além do conteúdo dela.
#[derive(Debug, Clone, PartialEq)]
pub struct Sampling {
    /// `None` deixa o backend usar o padrão dele.
    ///
    /// Mandar um valor inventado seria escolher por um modelo cujo padrão o
    /// provedor calibrou.
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub stop_sequences: Vec<String>,
    /// Quanto raciocinar. O dialeto traduz para o que o provedor dele pede.
    pub thinking: ThinkingLevel,
    /// Marcar o prefixo estável para o cache do backend.
    pub cache_prefix: bool,
    /// Chave que agrupa os pedidos de uma mesma sessão no cache do backend.
    ///
    /// Existe porque os dois formatos cacheiam de jeitos diferentes: o
    /// Anthropic marca um ponto de corte dentro do corpo, o OpenAI declara uma
    /// chave e deixa o backend achar o prefixo comum entre pedidos que a
    /// compartilham. Implementar um não entrega o outro, e o NFR-7 pede os dois.
    pub cache_key: Option<String>,
}

impl Default for Sampling {
    fn default() -> Self {
        Self {
            temperature: None,
            top_p: None,
            stop_sequences: Vec::new(),
            thinking: ThinkingLevel::Off,
            // Ligado por padrão: o prefixo de uma sessão de agente é grande e
            // repetido a cada turno, que é exatamente o caso que o cache
            // resolve. Desligá-lo é a escolha que precisa de motivo.
            cache_prefix: true,
            cache_key: None,
        }
    }
}

impl Sampling {
    #[must_use]
    pub const fn without_cache(mut self) -> Self {
        self.cache_prefix = false;
        self
    }

    #[must_use]
    pub const fn with_temperature(mut self, temperature: f32) -> Self {
        self.temperature = Some(temperature);
        self
    }

    #[must_use]
    pub const fn with_thinking(mut self, level: ThinkingLevel) -> Self {
        self.thinking = level;
        self
    }

    #[must_use]
    pub const fn with_top_p(mut self, top_p: f32) -> Self {
        self.top_p = Some(top_p);
        self
    }

    /// Amarra o cache do backend a uma sessão.
    #[must_use]
    pub fn with_cache_key(mut self, key: impl Into<String>) -> Self {
        self.cache_key = Some(key.into());
        self
    }

    #[must_use]
    pub fn with_stop_sequences(mut self, sequences: Vec<String>) -> Self {
        self.stop_sequences = sequences;
        self
    }
}

/// Marcador de cache que o dialeto Anthropic entende.
///
/// O ponto de corte vai no fim do prefixo estável — sistema e ferramentas —
/// porque é o que se repete idêntico a cada turno. Marcar depois disso não
/// acerta: o histórico cresce, e um prefixo que muda é um cache que erra.
#[must_use]
pub fn ephemeral() -> serde_json::Value {
    serde_json::json!({ "type": "ephemeral" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caching_is_on_by_default() {
        // O prefixo de uma sessao de agente e grande e repetido a cada turno.
        // Deixar o cache desligado por padrao seria pagar por isso sempre.
        assert!(Sampling::default().cache_prefix);
    }

    #[test]
    fn nothing_else_is_chosen_for_the_backend_by_default() {
        // Mandar uma temperatura inventada seria escolher por um modelo cujo
        // padrao o provedor calibrou.
        let sampling = Sampling::default();
        assert_eq!(sampling.temperature, None);
        assert_eq!(sampling.top_p, None);
        assert_eq!(sampling.thinking, ThinkingLevel::Off);
        assert!(sampling.stop_sequences.is_empty());
    }

    #[test]
    fn each_knob_can_be_set_explicitly() {
        let sampling = Sampling::default()
            .with_temperature(0.2)
            .with_top_p(0.9)
            .with_thinking(ThinkingLevel::Medium)
            .with_stop_sequences(vec!["FIM".to_owned()])
            .without_cache();

        assert_eq!(sampling.temperature, Some(0.2));
        assert_eq!(sampling.top_p, Some(0.9));
        assert_eq!(sampling.thinking, ThinkingLevel::Medium);
        assert_eq!(sampling.stop_sequences, vec!["FIM".to_owned()]);
        assert!(!sampling.cache_prefix);
    }

    #[test]
    fn the_cache_marker_is_the_shape_the_dialect_expects() {
        assert_eq!(ephemeral()["type"], "ephemeral");
    }
}
