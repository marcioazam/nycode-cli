//! Os campos de cache de prompt dos formatos OpenAI.
//!
//! Separado dos dois dialetos porque é a mesma decisão nos dois, e escrevê-la
//! duas vezes é como uma das cópias fica para trás. Separado de
//! [`crate::sampling`] porque estes nomes e limites são deste formato: o
//! Anthropic pede a retenção dentro do marcador, e aqui ela é um campo ao lado
//! da chave.

use crate::sampling::{CacheRetention, Sampling};

/// Teto de comprimento da chave neste formato.
///
/// Uma chave mais longa faz o backend recusar o pedido inteiro — por causa de
/// um campo que existe para economizar.
const MAX_KEY: usize = 64;

/// Valor que este formato usa para pedir a retenção estendida.
const LONG_RETENTION: &str = "24h";

/// A chave a declarar, já cortada ao que o formato aceita.
///
/// `None` com o cache desligado: mandar a chave ali agruparia pedidos que
/// pediram para não ser agrupados.
///
/// Corta pelo começo e não pelo fim: o id de sessão termina no que o distingue,
/// e cortar a cauda colidiria duas sessões de mesmo prefixo num balde só —
/// que é exatamente o erro que a chave existe para evitar.
#[must_use]
pub fn key_of(sampling: &Sampling) -> Option<&str> {
    if !sampling.cache.is_on() {
        return None;
    }
    let key = sampling.cache_key.as_deref()?;
    let excedente = key.len().saturating_sub(MAX_KEY);
    if excedente == 0 {
        return Some(key);
    }
    // Fronteira de caractere: cortar no meio de um multibyte produziria uma
    // chave que não é texto, e o backend recusaria o pedido.
    let corte = (excedente..key.len()).find(|at| key.is_char_boundary(*at))?;
    Some(&key[corte..])
}

/// A retenção a declarar, quando não é a padrão do backend.
///
/// `None` na curta: nomear o padrão não muda nada e ainda faz o pedido carregar
/// um campo que backends mais antigos recusam.
#[must_use]
pub const fn retention_of(sampling: &Sampling) -> Option<&'static str> {
    if matches!(sampling.cache, CacheRetention::Long) {
        Some(LONG_RETENTION)
    } else {
        None
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn with_key(key: &str) -> Sampling {
        Sampling::default().with_cache_key(key)
    }

    #[test]
    fn a_key_within_the_limit_is_passed_through_untouched() {
        assert_eq!(key_of(&with_key("sessao-1")), Some("sessao-1"));
    }

    #[test]
    fn an_oversized_key_keeps_the_end_that_distinguishes_it() {
        // Duas sessoes de mesmo prefixo cairiam no mesmo balde se o corte
        // fosse pela cauda — o oposto do que a chave existe para fazer.
        let key = format!("{}-final", "p".repeat(80));
        let sampling = with_key(&key);
        let cortada = key_of(&sampling).unwrap();

        assert_eq!(cortada.len(), MAX_KEY);
        assert!(cortada.ends_with("-final"), "{cortada}");
    }

    #[test]
    fn an_oversized_key_is_never_cut_inside_a_character() {
        // Cortar um multibyte pela metade produz bytes que nao sao texto, e o
        // backend recusa o pedido inteiro.
        let key = "á".repeat(60);
        let sampling = with_key(&key);
        let cortada = key_of(&sampling).unwrap();

        assert!(cortada.len() <= MAX_KEY);
        assert!(cortada.chars().all(|ch| ch == 'á'), "{cortada}");
    }

    #[test]
    fn a_disabled_cache_declares_no_key_even_when_one_was_configured() {
        assert_eq!(key_of(&with_key("sessao-1").without_cache()), None);
    }

    #[test]
    fn a_session_without_a_key_declares_none() {
        assert_eq!(key_of(&Sampling::default()), None);
    }

    #[test]
    fn only_long_retention_is_named_on_the_wire() {
        assert_eq!(retention_of(&Sampling::default()), None);
        assert_eq!(retention_of(&Sampling::default().without_cache()), None);
        assert_eq!(
            retention_of(&Sampling::default().with_long_cache()),
            Some("24h")
        );
    }
}
