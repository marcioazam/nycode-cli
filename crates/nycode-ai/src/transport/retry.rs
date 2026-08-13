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

/// Espalha a espera, para que clientes que falharam juntos não voltem juntos.
///
/// Um backoff puramente exponencial sincroniza: `N` sessões que receberam o
/// mesmo 503 esperam exatamente o mesmo tanto e batem no backend de novo no
/// mesmo instante, que é a forma de uma falha transitória virar permanente.
///
/// Metade da espera é fixa e metade é sorteada. Manter a metade fixa preserva o
/// crescimento exponencial que o backoff existe para dar; sortear a outra é o
/// que quebra a sincronia.
///
/// A entropia é parâmetro porque uma espera aleatória não é verificável: com
/// ela de fora, o teste afirma sobre as duas pontas do intervalo em vez de
/// sobre um número que muda a cada execução.
#[must_use]
pub fn spread(base: Duration, entropy: u32) -> Duration {
    let half = base / 2;
    half + half.mul_f64(f64::from(entropy % 1000) / 1000.0)
}

/// Entropia barata para o espalhamento.
///
/// O subsegundo do relógio, e não um gerador de números aleatórios: espalhar
/// retentativa não é uso criptográfico, e uma crate a mais custa binário que o
/// NFR-3 não tem para gastar nisto.
#[must_use]
pub fn entropy() -> u32 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.subsec_nanos())
}

/// Agora, em segundos desde a época.
///
/// Um relógio antes de 1970 devolve zero, e não erro: o único uso é comparar
/// com uma data de `Retry-After`, e ali um zero já significa "não espere".
#[must_use]
pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_secs())
}

/// Lê `Retry-After` nas duas formas que a RFC 9110 admite.
///
/// Segundos, e a data HTTP — que provedores grandes usam e que este cliente
/// descartava. Um cabeçalho descartado vira `None`, o cliente cai no backoff
/// local e insiste antes do que o servidor pediu, contra a fila que ele está
/// tentando drenar.
///
/// A objeção antiga era o relógio: a data exige um confiável nos dois lados, e
/// errar produziria uma espera arbitrária. Ela é respondida por duas guardas, e
/// não pelo relógio ficar melhor — uma data já passada vira espera zero em vez
/// de número enorme por baixo, e [`Policy::delay`] limita o resultado a
/// `max_delay` de qualquer jeito.
///
/// `now` é parâmetro pela mesma razão que a entropia de [`spread`]: uma espera
/// medida contra o relógio da máquina não é verificável.
#[must_use]
pub fn parse_retry_after(value: &str, now: u64) -> Option<Duration> {
    let value = value.trim();
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }
    let target = parse_imf_fixdate(value)?;
    Some(Duration::from_secs(target.saturating_sub(now)))
}

/// Segundos desde a época de uma `IMF-fixdate`: `Wed, 21 Oct 2026 07:28:00 GMT`.
///
/// Só esta forma. A RFC 9110 obriga quem envia a usá-la e trata as duas
/// obsoletas como legado; escrever mais dois analisadores para formas que um
/// gateway de 2026 não emite custaria binário que o NFR-3 não tem.
///
/// À mão em vez de por dependência pela mesma conta: o formato é de largura
/// fixa, e uma crate a mais paga-se em bytes no binário auto-contido.
fn parse_imf_fixdate(value: &str) -> Option<u64> {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];

    // `Wed, 21 Oct 2026 07:28:00 GMT`
    //  0123456789...
    let bytes = value.as_bytes();
    if bytes.len() != 29 || bytes[3] != b',' || bytes[4] != b' ' || !value.ends_with(" GMT") {
        return None;
    }

    let number = |from: usize, to: usize| value.get(from..to)?.parse::<u64>().ok();
    let day = number(5, 7)?;
    let year = number(12, 16)?;
    let hour = number(17, 19)?;
    let minute = number(20, 22)?;
    let second = number(23, 25)?;
    if bytes[16] != b' ' || bytes[19] != b':' || bytes[22] != b':' {
        return None;
    }

    let name = value.get(8..11)?;
    let month = u64::try_from(MONTHS.iter().position(|month| *month == name)?).ok()? + 1;

    if day == 0 || day > 31 || hour > 23 || minute > 59 || second > 60 {
        return None;
    }

    Some(days_from_epoch(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second)
}

/// Dias entre 1970-01-01 e a data dada, no calendário proléptico gregoriano.
///
/// O deslocamento de março: começar o ano em março joga o dia bissexto para o
/// fim, e o comprimento dos meses passa a caber numa fórmula em vez de numa
/// tabela com exceção de fevereiro.
fn days_from_epoch(year: u64, month: u64, day: u64) -> u64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    // 719_468 é a distância entre 0000-03-01 e 1970-01-01.
    era * 146_097 + day_of_era - 719_468
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
    fn the_spread_never_leaves_the_half_open_interval_below_the_base() {
        // Metade fixa preserva o crescimento exponencial; a outra metade e o
        // que quebra a sincronia entre clientes que falharam juntos.
        let base = Duration::from_millis(800);

        assert_eq!(spread(base, 0), Duration::from_millis(400));
        assert!(spread(base, 999) < base);
        for entropy in [1_u32, 7, 123, 500, 998, 12_345, u32::MAX] {
            let jittered = spread(base, entropy);
            assert!(jittered >= base / 2, "{entropy}: {jittered:?}");
            assert!(jittered <= base, "{entropy}: {jittered:?}");
        }
    }

    #[test]
    fn two_clients_that_failed_together_do_not_come_back_together() {
        // O ponto do espalhamento. Sem ele os dois esperam exatamente o mesmo.
        let base = Duration::from_secs(4);
        assert_ne!(spread(base, 10), spread(base, 900));
    }

    #[test]
    fn spreading_nothing_still_waits_nothing() {
        assert_eq!(spread(Duration::ZERO, 999), Duration::ZERO);
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

    /// `Wed, 21 Oct 2026 07:28:00 GMT` em segundos desde a época.
    const OCT_21_2026: u64 = 1_792_567_680;

    #[test]
    fn retry_after_parses_seconds() {
        assert_eq!(parse_retry_after("5", 0), Some(Duration::from_secs(5)));
        assert_eq!(parse_retry_after("  12 ", 0), Some(Duration::from_secs(12)));
        assert_eq!(parse_retry_after("", 0), None);
        assert_eq!(parse_retry_after("depois", 0), None);
    }

    #[test]
    fn retry_after_in_http_date_becomes_the_wait_until_that_instant() {
        // A RFC 9110 permite as duas formas, e provedores grandes usam a data.
        // Descarta-la fazia o cabecalho virar `None` e o cliente voltar ao
        // backoff local — insistindo antes do que o servidor pediu, contra a
        // fila que ele esta tentando drenar.
        assert_eq!(
            parse_retry_after("Wed, 21 Oct 2026 07:28:00 GMT", OCT_21_2026 - 30),
            Some(Duration::from_secs(30))
        );
    }

    #[test]
    fn an_http_date_already_past_is_no_wait_instead_of_a_huge_one() {
        // Relogio adiantado no cliente, ou resposta que demorou a chegar. Sem o
        // piso em zero a subtracao daria um numero enorme por baixo, e a sessao
        // ficaria parada por causa de dessincronia de relogio.
        assert_eq!(
            parse_retry_after("Wed, 21 Oct 2026 07:28:00 GMT", OCT_21_2026 + 600),
            Some(Duration::ZERO)
        );
    }

    #[test]
    fn a_malformed_date_is_refused_rather_than_guessed() {
        // Meio cabecalho lido produz uma espera inventada, que e pior que
        // nenhuma: o backoff local ao menos cresce.
        for lixo in [
            "Wed, 21 Oct 2026 07:28:00",
            "Wed, 21 Xxx 2026 07:28:00 GMT",
            "Wed, ab Oct 2026 07:28:00 GMT",
            "Wed 21 Oct 2026 07:28:00 GMT",
            "Wed, 21 Oct 2026 07:28 GMT",
        ] {
            assert_eq!(parse_retry_after(lixo, 0), None, "{lixo}");
        }
    }

    #[test]
    fn an_http_date_still_answers_to_the_ceiling() {
        // O teto do `delay` e o que impede um cabecalho absurdo — ou um relogio
        // atrasado — de travar a sessao.
        let policy = Policy::default();
        let daqui_a_um_ano = parse_retry_after("Wed, 21 Oct 2026 07:28:00 GMT", 0).unwrap();
        assert_eq!(policy.delay(1, Some(daqui_a_um_ano)), policy.max_delay);
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
