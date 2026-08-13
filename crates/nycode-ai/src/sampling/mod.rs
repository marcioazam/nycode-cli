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
    /// Por quanto tempo o backend deve reter o prefixo em cache.
    pub cache: CacheRetention,
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
            //
            // Curto e não longo: a retenção longa é cobrada a outra tarifa — o
            // dobro da de entrada — e só se paga numa sessão com intervalos
            // grandes entre turnos. Ligá-la por omissão cobraria de todo mundo
            // o que serve a poucos.
            cache: CacheRetention::Short,
            cache_key: None,
        }
    }
}

impl Sampling {
    #[must_use]
    pub const fn without_cache(mut self) -> Self {
        self.cache = CacheRetention::Off;
        self
    }

    /// Pede a retenção longa, cobrada a outra tarifa.
    ///
    /// Vale numa sessão com intervalos grandes entre turnos, onde o prefixo
    /// curto já teria expirado e seria reescrito do zero.
    #[must_use]
    pub const fn with_long_cache(mut self) -> Self {
        self.cache = CacheRetention::Long;
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

/// Por quanto tempo o backend retém o prefixo em cache.
///
/// Três estados e não dois. Um booleano alcança ligado e desligado, e a
/// retenção longa é um terceiro: ela é cobrada a outra tarifa, e o repositório
/// já sabia disso do lado errado — [`crate::Usage::cache_write_1h_tokens`]
/// existia e `catalog::cost` já o cobrava ao dobro, enquanto nada conseguia
/// pedir a retenção que produziria esse número.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CacheRetention {
    /// Não marcar prefixo nenhum.
    Off,
    /// Retenção padrão do backend, de poucos minutos.
    #[default]
    Short,
    /// Retenção estendida, cobrada a outra tarifa.
    Long,
}

impl CacheRetention {
    /// Se há prefixo a marcar.
    #[must_use]
    pub const fn is_on(self) -> bool {
        !matches!(self, Self::Off)
    }

    /// Se a retenção pedida é a estendida.
    #[must_use]
    pub const fn is_long(self) -> bool {
        matches!(self, Self::Long)
    }
}

/// Marcador de cache que o dialeto Anthropic entende.
///
/// O ponto de corte vai no fim do prefixo estável — sistema e ferramentas —
/// porque é o que se repete idêntico a cada turno. Marcar depois disso não
/// acerta: o histórico cresce, e um prefixo que muda é um cache que erra.
///
/// A retenção viaja dentro do próprio marcador: sem o `ttl` o backend aplica a
/// curta, e uma conversa com intervalos grandes reescreveria o prefixo a cada
/// turno pagando escrita que expirou sem ser lida.
#[must_use]
pub fn marker(retention: CacheRetention) -> serde_json::Value {
    if retention.is_long() {
        serde_json::json!({ "type": "ephemeral", "ttl": "1h" })
    } else {
        serde_json::json!({ "type": "ephemeral" })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caching_is_on_by_default() {
        // O prefixo de uma sessao de agente e grande e repetido a cada turno.
        // Deixar o cache desligado por padrao seria pagar por isso sempre.
        assert_eq!(Sampling::default().cache, CacheRetention::Short);
        assert!(Sampling::default().cache.is_on());
    }

    #[test]
    fn retention_has_three_states_and_not_two() {
        // Um booleano so alcanca ligado e desligado. A retencao longa e um
        // terceiro estado com outra tarifa — `Usage::cache_write_1h_tokens` ja
        // existia e ja era cobrado ao dobro em `catalog::cost`, e nada no
        // repositorio conseguia pedi-la: o modelo de custo tratava uma
        // retencao que ninguem alcancava.
        assert!(!CacheRetention::Off.is_on());
        assert!(CacheRetention::Short.is_on());
        assert!(CacheRetention::Long.is_on());
        assert!(!CacheRetention::Short.is_long());
        assert!(CacheRetention::Long.is_long());
    }

    #[test]
    fn long_retention_is_asked_for_explicitly() {
        assert_eq!(
            Sampling::default().with_long_cache().cache,
            CacheRetention::Long
        );
        assert_eq!(
            Sampling::default().without_cache().cache,
            CacheRetention::Off
        );
    }

    #[test]
    fn the_marker_carries_the_hour_only_for_long_retention() {
        // O dialeto Anthropic pede a retencao dentro do proprio marcador. Sem
        // o `ttl` o backend usa a curta, e a sessao paga escrita de cache que
        // expira antes do proximo turno de uma conversa longa.
        assert_eq!(marker(CacheRetention::Short)["type"], "ephemeral");
        assert!(marker(CacheRetention::Short).get("ttl").is_none());
        assert_eq!(marker(CacheRetention::Long)["ttl"], "1h");
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
        assert_eq!(sampling.cache, CacheRetention::Off);
    }

    #[test]
    fn the_cache_marker_is_the_shape_the_dialect_expects() {
        assert_eq!(marker(CacheRetention::Short)["type"], "ephemeral");
    }
}
