//! Impressão digital do conjunto que um servidor MCP declara (ADR-0028).
//! O consentimento do comando já existe; isto cobre o conjunto declarado.

use std::collections::BTreeSet;
use std::path::Path;

use serde_json::Value;

use super::trust::{Consent, Declaration, Trust};
use crate::tool::sanitize;

/// Sufixo da chave no registro: não colide com a impressão do comando.
pub const TOOLS_MARK: &str = "\u{1f}tools";

/// Primeiro pin sem pergunta; troca pede de novo. Residual: o snapshot inicial não é visto.
#[must_use]
pub fn pin(
    root: &Path,
    declaration: &Declaration,
    trust: &mut Trust,
    consent: &mut dyn Consent,
) -> bool {
    if trust.allows(root, declaration) {
        return true;
    }
    if !trust.knows(root, declaration) {
        trust.grant(root, declaration);
        return true;
    }
    if consent.confirm(declaration) {
        trust.grant(root, declaration);
        return true;
    }
    false
}

/// Nome que não colide com o qualificator `server__tool` nem com a chave do pin.
#[must_use]
pub fn usable(server: &str) -> bool {
    !server.contains("__") && !server.contains('\u{1f}')
}

#[must_use]
pub fn belongs(server: &str, qualified: &str) -> bool {
    qualified
        .split_once("__")
        .is_some_and(|(name, _)| name == server)
}

#[must_use]
pub fn remote<'a>(server: &str, qualified: &'a str) -> &'a str {
    qualified
        .strip_prefix(server)
        .and_then(|rest| rest.strip_prefix("__"))
        .unwrap_or(qualified)
}

#[must_use]
pub fn of(server: &str, tools: &[(&str, &str, &Value)]) -> Declaration {
    let mut shown: Vec<String> = tools
        .iter()
        .map(|(name, description, _)| {
            format!(
                "{}: {}",
                sanitize::plain(name),
                sanitize::plain(description)
            )
        })
        .collect();
    shown.sort();
    let detail = if shown.is_empty() {
        "(nenhuma ferramenta)".to_owned()
    } else {
        shown.join("; ")
    };
    Declaration::covering(format!("{server}{TOOLS_MARK}"), detail, cover(tools))
}

/// Pina cada servidor; o que mudou sem interlocutor fica de fora.
#[must_use]
pub fn keep_names(
    root: &Path,
    servers: &[&str],
    tools: &[(&str, &str, &Value)],
    trust: &mut Trust,
    consent: &mut dyn Consent,
) -> BTreeSet<String> {
    let mut keep = BTreeSet::new();
    for server in servers {
        let listed: Vec<(&str, &str, &Value)> = tools
            .iter()
            .copied()
            .filter(|(qualified, _, _)| belongs(server, qualified))
            .map(|(qualified, description, schema)| {
                (remote(server, qualified), description, schema)
            })
            .collect();
        let declaration = of(server, &listed);
        if pin(root, &declaration, trust, consent) {
            keep.insert((*server).to_owned());
        } else {
            eprintln!(
                "nycode: `{server}` mudou a definicao declarada e nao vai rodar: {}",
                declaration.detail
            );
        }
    }
    keep
}

fn cover(tools: &[(&str, &str, &Value)]) -> String {
    let mut items: Vec<Value> = tools
        .iter()
        .map(|(name, description, schema)| {
            serde_json::json!({
                "description": description,
                "name": name,
                "schema": schema,
            })
        })
        .collect();
    items.sort_by_key(canon);
    canon(&Value::Array(items))
}

fn canon(value: &Value) -> String {
    serde_json::to_string(&sorted(value)).unwrap_or_else(|_| "\u{0}".to_owned())
}

fn sorted(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<_> = map.keys().cloned().collect();
            keys.sort();
            Value::Object(
                keys.into_iter()
                    .filter_map(|key| map.get(&key).map(|item| (key, sorted(item))))
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.iter().map(sorted).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use crate::policy::trust::Never;

    struct Responde(bool);

    impl Consent for Responde {
        fn confirm(&mut self, _declaration: &Declaration) -> bool {
            self.0
        }
    }

    fn schema() -> Value {
        serde_json::json!({"type": "object", "properties": {"q": {"type": "string"}}})
    }

    fn pin_never(trust: &mut Trust, declaration: &Declaration) -> bool {
        pin(Path::new("/w"), declaration, trust, &mut Never)
    }

    #[test]
    fn pin_grants_the_first_snapshot_and_refuses_a_silent_change() {
        let mut trust = Trust::default();
        let antes = of("docs", &[("busca", "procura", &schema())]);
        assert!(pin_never(&mut trust, &antes));
        assert!(trust.allows(Path::new("/w"), &antes));
        assert!(pin_never(&mut trust, &antes));
        let depois = of("docs", &[("busca", "outra coisa", &schema())]);
        assert!(!pin_never(&mut trust, &depois));
        assert!(pin(
            Path::new("/w"),
            &depois,
            &mut trust,
            &mut Responde(true)
        ));
        assert!(trust.allows(Path::new("/w"), &depois));
        let vazio = serde_json::json!({});
        let um = [("docs__busca", "procura", &vazio)];
        let mut trust = Trust::default();
        let comando = Declaration::new("docs", "npx servidor");
        trust.grant(Path::new("/w"), &comando);
        assert!(
            keep_names(Path::new("/w"), &["docs"], &um, &mut trust, &mut Never).contains("docs")
        );
        assert!(trust.allows(Path::new("/w"), &comando));
        let dois = [
            ("docs__busca", "procura", &vazio),
            ("docs__lista", "lista", &vazio),
        ];
        assert!(keep_names(Path::new("/w"), &["docs"], &dois, &mut trust, &mut Never).is_empty());
        assert!(trust.allows(Path::new("/w"), &comando));
    }

    #[test]
    fn cover_is_order_independent_and_injective() {
        let vazio = serde_json::json!({});
        let s = schema();
        let fp = |tools: &[(&str, &str, &Value)]| of("docs", tools).fingerprint();
        assert_eq!(
            fp(&[("b", "d", &s), ("a", "d", &s)]),
            fp(&[("a", "d", &s), ("b", "d", &s)])
        );
        assert_eq!(
            fp(&[("t", "d", &serde_json::json!({"b": 1, "a": 1}))]),
            fp(&[("t", "d", &serde_json::json!({"a": 1, "b": 1}))])
        );
        assert_ne!(
            fp(&[("t", "d", &serde_json::json!({"type": "string"}))]),
            fp(&[("t", "d", &serde_json::json!({"type": "number"}))])
        );
        assert_ne!(
            fp(&[("a", "d1\0{}\nb\0d2", &vazio)]),
            fp(&[("a", "d1", &vazio), ("b", "d2", &vazio)])
        );
        assert_eq!(fp(&[]), of("docs", &[]).fingerprint());
        assert_ne!(fp(&[]), fp(&[("t", "d", &vazio)]));
        assert!(of("docs", &[]).detail.contains("nenhuma"));
    }

    #[test]
    fn belongs_reads_the_server_prefix() {
        assert!(usable("docs"));
        assert!(!usable("docs__extra"));
        assert!(!usable("docs\u{1f}tools"));
        assert!(belongs("docs", "docs__busca"));
        assert!(!belongs("docs", "outro__busca"));
        assert!(!belongs("docs", "docs"));
        assert!(!belongs("docs", "docs2__busca"));
        assert!(!belongs("doc", "docs__busca"));
        assert_eq!(remote("docs", "docs__busca"), "busca");
        assert_eq!(remote("docs", "solto"), "solto");
    }
}
