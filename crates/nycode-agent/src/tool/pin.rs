//! Pin criptográfico do que o modelo viu (AGT-03).
//!
//! SHA-256 de nome + descrição + schema JSON canônico. O execute recusa se o
//! que a ferramenta declara agora divergir do que foi apresentado em `specs`.

use serde_json::Value;
use sha2::{Digest as _, Sha256};

/// Impressão do conjunto apresentado ao modelo.
#[must_use]
pub fn of(name: &str, description: &str, schema: &Value) -> String {
    let mut hasher = Sha256::new();
    hasher.update(name.as_bytes());
    hasher.update([0]);
    hasher.update(description.as_bytes());
    hasher.update([0]);
    hasher.update(schema.to_string().as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::of;
    use serde_json::json;

    #[test]
    fn the_same_presentation_hashes_the_same() {
        let schema = json!({"type": "object"});
        assert_eq!(of("read", "lê", &schema), of("read", "lê", &schema));
    }

    #[test]
    fn a_schema_change_changes_the_pin() {
        let antes = json!({"type": "object"});
        let depois = json!({"type": "object", "properties": {"x": {"type": "string"}}});
        assert_ne!(of("read", "lê", &antes), of("read", "lê", &depois));
    }

    #[test]
    fn object_key_order_does_not_change_the_pin() {
        let a = json!({"b": 1, "a": 1});
        let b = json!({"a": 1, "b": 1});
        assert_eq!(of("n", "d", &a), of("n", "d", &b));
    }
}
