//! OAuth de assinatura. Compilado apenas sob a feature `subscription-oauth`.
//!
//! # Aviso
//!
//! Este caminho autentica com tokens OAuth emitidos para assinaturas de
//! consumidor. Desde fevereiro de 2026 os Consumer Terms da Anthropic restringem
//! esses tokens ao Claude Code e ao claude.ai, há enforcement server-side desde
//! janeiro de 2026, e contas já foram suspensas por este padrão de uso.
//!
//! Ver `docs/architecture/decisions/0001-subscription-oauth-is-a-flagged-accepted-risk.md`.

/// Variável que arma o caminho em runtime.
///
/// A feature de compilação não basta: o ADR-0001 exige que habilitar seja um ato
/// explícito do operador, e não herança de um build que por acaso incluiu o
/// código.
pub const ARM_VAR: &str = "NYCODE_ENABLE_SUBSCRIPTION_OAUTH";

/// Estado do caminho de OAuth de assinatura.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    /// Compilado mas não armado. É o estado padrão.
    Disarmed,
    /// Armado explicitamente pelo operador.
    Armed,
    /// Um provider rejeitou o token. O kill-switch desarmou o caminho.
    BlockedByProvider,
}

impl State {
    /// Lê o estado a partir do ambiente.
    #[must_use]
    pub fn from_env(lookup: &dyn Fn(&str) -> Option<String>) -> Self {
        match lookup(ARM_VAR).as_deref() {
            Some("1" | "true" | "yes") => Self::Armed,
            _ => Self::Disarmed,
        }
    }

    #[must_use]
    pub const fn is_usable(self) -> bool {
        matches!(self, Self::Armed)
    }

    /// Aplica o kill-switch depois de uma rejeição do provider.
    ///
    /// O ADR-0001 é explícito: quando bloqueado, degradar para chave de API e
    /// informar. Nunca tentar contornar, nunca personificar outro cliente.
    #[must_use]
    pub const fn blocked() -> Self {
        Self::BlockedByProvider
    }

    /// Mensagem apresentada quando o caminho não pode ser usado.
    #[must_use]
    pub fn explain(self) -> &'static str {
        match self {
            Self::Disarmed => {
                "OAuth de assinatura esta compilado mas nao armado. Leia o ADR-0001 antes de \
                 definir NYCODE_ENABLE_SUBSCRIPTION_OAUTH=1: o uso viola os termos de provedores \
                 relevantes e ja resultou em suspensao de contas."
            }
            Self::Armed => "OAuth de assinatura armado.",
            Self::BlockedByProvider => {
                "O provider rejeitou o token de assinatura. Use uma chave de API ou o \
                 nylla-gateway; o nycode nao tenta contornar o bloqueio."
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(value: Option<&str>) -> impl Fn(&str) -> Option<String> + use<> {
        let value = value.map(ToOwned::to_owned);
        move |key| if key == ARM_VAR { value.clone() } else { None }
    }

    #[test]
    fn compiled_but_unset_is_disarmed() {
        // ADR-0001: a feature de compilacao nao basta para armar o caminho.
        assert_eq!(State::from_env(&env(None)), State::Disarmed);
        assert!(!State::from_env(&env(None)).is_usable());
    }

    #[test]
    fn only_explicit_affirmative_values_arm_it() {
        for value in ["1", "true", "yes"] {
            assert_eq!(State::from_env(&env(Some(value))), State::Armed, "{value}");
        }
        for value in ["0", "false", "", "talvez"] {
            assert_eq!(
                State::from_env(&env(Some(value))),
                State::Disarmed,
                "{value}"
            );
        }
    }

    #[test]
    fn a_blocked_path_is_not_usable_and_says_to_fall_back() {
        let blocked = State::blocked();
        assert!(!blocked.is_usable());
        assert!(blocked.explain().contains("chave de API"));
        assert!(blocked.explain().contains("nao tenta contornar"));
    }

    #[test]
    fn the_disarmed_message_points_at_the_adr_risk() {
        let message = State::Disarmed.explain();
        assert!(message.contains("suspensao de contas"));
        assert!(message.contains(ARM_VAR));
    }
}
