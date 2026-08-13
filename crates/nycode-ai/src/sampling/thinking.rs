//! O nível de raciocínio, e como cada dialeto o expressa.
//!
//! Cada provedor pede outra coisa. O formato Anthropic quer um orçamento em
//! tokens; o formato OpenAI quer um esforço nomeado de um conjunto fechado. Um
//! orçamento não converte em esforço sem perda, e o inverso também não — então
//! o harness tem um vocabulário próprio e o dialeto traduz (ADR-0025).
//!
//! O que este módulo recusa é traduzir em silêncio. Um nível que o dialeto não
//! alcança é rebaixado ao mais próximo **e diz de onde veio**, para que quem
//! pediu o máximo saiba que recebeu outra coisa. Descartar seria a degradação
//! silenciosa que o NFR-4 proíbe; falhar trocaria um defeito por outro, porque
//! quem pede o máximo quer o máximo que existir.

/// Quanto o modelo deve raciocinar antes de responder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub enum ThinkingLevel {
    /// Sem raciocínio: nada é emitido e o modelo usa o padrão dele.
    #[default]
    Off,
    Minimal,
    Low,
    Medium,
    High,
    XHigh,
    Max,
}

/// Todos os níveis, do menor para o maior.
pub const LEVELS: &[ThinkingLevel] = &[
    ThinkingLevel::Off,
    ThinkingLevel::Minimal,
    ThinkingLevel::Low,
    ThinkingLevel::Medium,
    ThinkingLevel::High,
    ThinkingLevel::XHigh,
    ThinkingLevel::Max,
];

/// O esforço nomeado que um dialeto emite, e o nível de onde ele veio.
///
/// `requested` só é preenchido quando houve rebaixamento. Quem emite usa isso
/// para dizer ao usuário; ninguém precisa comparar níveis para descobrir.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Effort {
    pub name: &'static str,
    pub requested: Option<ThinkingLevel>,
}

impl ThinkingLevel {
    /// Interpreta o nome que o usuário escreveu.
    ///
    /// Devolve `None` para um nome desconhecido em vez de escolher um nível: um
    /// `--thinking hihg` que rodasse em médio seria pior que um erro.
    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "off" | "none" => Some(Self::Off),
            "minimal" => Some(Self::Minimal),
            "low" => Some(Self::Low),
            "medium" => Some(Self::Medium),
            "high" => Some(Self::High),
            "xhigh" => Some(Self::XHigh),
            "max" => Some(Self::Max),
            _ => None,
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Minimal => "minimal",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::XHigh => "xhigh",
            Self::Max => "max",
        }
    }

    /// O orçamento em tokens que o formato Anthropic pede.
    ///
    /// O piso é 1024 porque abaixo disso o provedor recusa o pedido — um nível
    /// mínimo que produzisse 512 seria um erro 400 em vez de menos raciocínio.
    #[must_use]
    pub const fn budget(self) -> Option<u32> {
        match self {
            Self::Off => None,
            Self::Minimal => Some(1_024),
            Self::Low => Some(2_048),
            Self::Medium => Some(4_096),
            Self::High => Some(8_192),
            Self::XHigh => Some(16_384),
            Self::Max => Some(32_768),
        }
    }

    /// O esforço nomeado que o formato OpenAI pede.
    ///
    /// O conjunto documentado do provedor vai até `high`, então `xhigh` e `max`
    /// são rebaixados — e o rebaixamento vem no retorno, não sumido.
    #[must_use]
    pub const fn effort(self) -> Option<Effort> {
        let (name, downgraded) = match self {
            Self::Off => return None,
            Self::Minimal => ("minimal", false),
            Self::Low => ("low", false),
            Self::Medium => ("medium", false),
            Self::High => ("high", false),
            Self::XHigh | Self::Max => ("high", true),
        };
        Some(Effort {
            name,
            requested: if downgraded { Some(self) } else { None },
        })
    }
}

impl std::fmt::Display for ThinkingLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_level_round_trips_through_its_name() {
        for level in LEVELS {
            assert_eq!(ThinkingLevel::parse(level.as_str()), Some(*level));
        }
    }

    #[test]
    fn the_name_is_read_case_insensitively_and_trimmed() {
        assert_eq!(ThinkingLevel::parse("  HIGH "), Some(ThinkingLevel::High));
    }

    #[test]
    fn none_is_accepted_as_a_spelling_of_off() {
        assert_eq!(ThinkingLevel::parse("none"), Some(ThinkingLevel::Off));
    }

    #[test]
    fn an_unknown_name_is_refused_rather_than_rounded_to_a_level() {
        // Um `--thinking hihg` que rodasse em medio gastaria o turno inteiro
        // sem o usuario saber que pediu outra coisa.
        assert_eq!(ThinkingLevel::parse("hihg"), None);
        assert_eq!(ThinkingLevel::parse(""), None);
    }

    #[test]
    fn off_emits_nothing_in_either_dialect() {
        assert_eq!(ThinkingLevel::Off.budget(), None);
        assert_eq!(ThinkingLevel::Off.effort(), None);
    }

    #[test]
    fn the_budget_never_falls_below_what_the_provider_accepts() {
        // Abaixo de mil tokens o provedor recusa; um nivel minimo que
        // produzisse 512 viraria 400 em vez de menos raciocinio.
        for level in LEVELS.iter().filter(|l| **l != ThinkingLevel::Off) {
            assert!(level.budget().unwrap() >= 1_024, "{level}");
        }
    }

    #[test]
    fn the_budget_grows_with_the_level() {
        let budgets: Vec<_> = LEVELS.iter().filter_map(|l| l.budget()).collect();
        assert!(
            budgets.windows(2).all(|w| w[0] < w[1]),
            "orcamentos: {budgets:?}"
        );
    }

    #[test]
    fn the_four_levels_the_provider_documents_are_not_downgraded() {
        for level in [
            ThinkingLevel::Minimal,
            ThinkingLevel::Low,
            ThinkingLevel::Medium,
            ThinkingLevel::High,
        ] {
            let effort = level.effort().unwrap();
            assert_eq!(effort.name, level.as_str());
            assert_eq!(effort.requested, None, "{level} nao deveria rebaixar");
        }
    }

    #[test]
    fn a_level_above_what_the_provider_offers_is_downgraded_and_says_so() {
        // O conjunto documentado vai ate `high`. Descartar o pedido seria a
        // degradacao silenciosa que o NFR-4 proibe.
        for level in [ThinkingLevel::XHigh, ThinkingLevel::Max] {
            let effort = level.effort().unwrap();
            assert_eq!(effort.name, "high");
            assert_eq!(effort.requested, Some(level));
        }
    }

    #[test]
    fn the_default_level_asks_for_nothing() {
        assert_eq!(ThinkingLevel::default(), ThinkingLevel::Off);
    }

    #[test]
    fn levels_are_ordered_from_least_to_most() {
        assert!(ThinkingLevel::Off < ThinkingLevel::Minimal);
        assert!(ThinkingLevel::High < ThinkingLevel::Max);
    }

    #[test]
    fn a_level_renders_as_the_name_the_user_typed() {
        assert_eq!(ThinkingLevel::XHigh.to_string(), "xhigh");
    }
}
