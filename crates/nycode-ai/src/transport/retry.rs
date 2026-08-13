//! Política de retentativa.
//!
//! Só o **estabelecimento** do turno é retentado. Depois que o stream abre e
//! começa a emitir, repetir a requisição duplicaria efeitos colaterais das
//! ferramentas que já rodaram — por isso [`crate::ApiError::is_retryable`]
//! recusa erros in-band.

use std::time::Duration;

/// Parâmetros de backoff exponencial.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Policy {
    pub max_attempts: u32,
    pub initial: Duration,
    pub max_delay: Duration,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            // Tres tentativas: a primeira, e duas chances de o backend se
            // recuperar. Mais que isso e o usuario esperando sem saber.
            max_attempts: 3,
            initial: Duration::from_millis(400),
            max_delay: Duration::from_secs(8),
        }
    }
}

impl Policy {
    /// Desliga a retentativa.
    #[must_use]
    pub const fn none() -> Self {
        Self {
            max_attempts: 1,
            initial: Duration::ZERO,
            max_delay: Duration::ZERO,
        }
    }

    /// Espera antes da tentativa `attempt`, contada a partir de 1.
    ///
    /// `retry_after` do servidor vence o cálculo local: quando o backend diz
    /// quanto esperar, insistir antes disso só piora a fila que ele está tentando
    /// drenar. O valor ainda é limitado por `max_delay` para que um cabeçalho
    /// absurdo não trave a sessão.
    #[must_use]
    pub fn delay(&self, attempt: u32, retry_after: Option<Duration>) -> Duration {
        if let Some(server) = retry_after {
            return server.min(self.max_delay);
        }
        let exponent = attempt.saturating_sub(1).min(16);
        let scaled = self.initial.saturating_mul(1_u32 << exponent);
        scaled.min(self.max_delay)
    }

    /// Se ainda há tentativas depois desta.
    #[must_use]
    pub const fn should_retry(&self, attempt: u32) -> bool {
        attempt < self.max_attempts
    }
}

/// Lê `Retry-After` em segundos.
///
/// A forma em data HTTP é ignorada de propósito: interpretá-la exige um relógio
/// confiável nos dois lados, e errar produz uma espera arbitrária.
#[must_use]
pub fn parse_retry_after(value: &str) -> Option<Duration> {
    value.trim().parse::<u64>().ok().map(Duration::from_secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_grows_exponentially_from_the_initial_delay() {
        let policy = Policy::default();
        assert_eq!(policy.delay(1, None), Duration::from_millis(400));
        assert_eq!(policy.delay(2, None), Duration::from_millis(800));
        assert_eq!(policy.delay(3, None), Duration::from_millis(1600));
    }

    #[test]
    fn backoff_is_capped_so_a_long_outage_does_not_hang_the_session() {
        let policy = Policy::default();
        assert_eq!(policy.delay(20, None), policy.max_delay);
    }

    #[test]
    fn the_server_retry_after_wins_over_the_local_calculation() {
        // Insistir antes do que o backend pediu so piora a fila que ele esta
        // tentando drenar.
        let policy = Policy::default();
        let server = Duration::from_secs(5);
        assert_eq!(policy.delay(1, Some(server)), server);
    }

    #[test]
    fn an_absurd_retry_after_is_still_capped() {
        let policy = Policy::default();
        let absurd = Duration::from_secs(97);
        assert_eq!(policy.delay(1, Some(absurd)), policy.max_delay);
    }

    #[test]
    fn the_attempt_budget_is_respected() {
        let policy = Policy::default();
        assert!(policy.should_retry(1));
        assert!(policy.should_retry(2));
        assert!(!policy.should_retry(3), "a terceira tentativa e a ultima");
    }

    #[test]
    fn the_none_policy_never_retries() {
        assert!(!Policy::none().should_retry(1));
    }

    #[test]
    fn retry_after_parses_seconds_and_ignores_http_dates() {
        assert_eq!(parse_retry_after("5"), Some(Duration::from_secs(5)));
        assert_eq!(parse_retry_after("  12 "), Some(Duration::from_secs(12)));
        // Data HTTP exige relogio confiavel nos dois lados; errar produz espera
        // arbitraria, entao a forma e ignorada.
        assert_eq!(parse_retry_after("Wed, 21 Oct 2026 07:28:00 GMT"), None);
        assert_eq!(parse_retry_after(""), None);
    }

    #[test]
    fn exponent_saturates_without_overflowing() {
        // `1 << exponent` com attempt grande estouraria sem o clamp.
        let policy = Policy {
            max_attempts: 100,
            ..Policy::default()
        };
        assert_eq!(policy.delay(u32::MAX, None), policy.max_delay);
    }
}
