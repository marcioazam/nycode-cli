//! Teto por chamada das buscas (FR-16).

use serde_json::Value;

use crate::tool::ToolOutput;

/// Quantos resultados esta chamada devolve.
///
/// Sem `limit`, vale o teto da ferramenta. Zero ou não-inteiro recusa; um
/// pedido acima do teto é recortado nele — o teto existe para a janela, não
/// para o modelo furá-lo.
pub fn of(input: &Value, ceiling: usize) -> Result<usize, ToolOutput> {
    let Some(value) = input.get("limit") else {
        return Ok(ceiling);
    };
    let Some(n) = value.as_u64().filter(|n| *n > 0) else {
        return Err(ToolOutput::error("`limit` precisa ser um inteiro positivo"));
    };
    Ok(usize::try_from(n).map_or(ceiling, |n| n.min(ceiling)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn omitted_limit_uses_the_ceiling() {
        assert_eq!(of(&json!({}), 10).unwrap(), 10);
    }

    #[test]
    fn a_positive_limit_caps_the_call() {
        assert_eq!(of(&json!({ "limit": 3 }), 10).unwrap(), 3);
    }

    #[test]
    fn a_limit_above_the_ceiling_is_clipped() {
        assert_eq!(of(&json!({ "limit": 99 }), 10).unwrap(), 10);
    }

    #[test]
    fn a_zero_limit_is_refused() {
        assert!(of(&json!({ "limit": 0 }), 10).is_err());
    }

    #[test]
    fn a_non_integer_limit_is_refused() {
        assert!(of(&json!({ "limit": "10" }), 10).is_err());
        assert!(of(&json!({ "limit": -1 }), 10).is_err());
    }
}
