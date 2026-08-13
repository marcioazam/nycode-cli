//! Conferência dos argumentos contra o schema que o servidor declarou.
//!
//! A ferramenta nativa recusa argumento faltando antes de fazer qualquer coisa,
//! nomeando o que faltou, e o modelo corrige na volta.
//! A ferramenta de servidor não tinha esse degrau: o schema era encaminhado ao
//! modelo e nunca usado, então um argumento faltando virava um erro de
//! desserialização do outro lado, com a mensagem que aquele servidor escolheu
//! escrever, a um processo de distância da causa.
//!
//! O que se confere é o que dá para conferir sem carregar um validador de JSON
//! Schema inteiro: presença do que é obrigatório e tipo do que está no primeiro
//! nível. Não é validação completa e o módulo não finge que é — schema aninhado,
//! `oneOf`, `pattern` e `enum` passam. A escolha é de orçamento: um validador
//! completo é uma árvore de dependências para transformar um erro remoto legível
//! num erro local legível, e o teto de binário tem outros donos.
//!
//! A conferência é permissiva por construção. Um servidor cujo schema o módulo
//! não entende continua sendo chamado; recusar o que não se entende
//! transformaria cada schema exótico numa ferramenta quebrada.

use serde_json::Value;

/// Confere os argumentos, devolvendo o que dizer ao modelo quando não passam.
pub fn check(schema: &Value, input: &Value) -> Result<(), String> {
    let Some(schema) = schema.as_object() else {
        return Ok(());
    };

    // `null` é como o agente representa "sem argumentos", e o protocolo o
    // traduz para objeto vazio. Tratá-lo como objeto vazio aqui é o que faz
    // "faltou o obrigatório" ser dito em vez de "não é objeto".
    let empty = serde_json::Map::new();
    let arguments = match input {
        Value::Object(map) => map,
        Value::Null => &empty,
        other => return Err(format!("argumentos precisam ser um objeto, veio {other}")),
    };

    if let Some(required) = schema.get("required").and_then(Value::as_array) {
        for name in required.iter().filter_map(Value::as_str) {
            if !arguments.contains_key(name) {
                return Err(format!("argumento obrigatorio ausente: `{name}`"));
            }
        }
    }

    let Some(properties) = schema.get("properties").and_then(Value::as_object) else {
        return Ok(());
    };
    for (name, value) in arguments {
        let Some(declared) = properties.get(name).and_then(|p| p.get("type")) else {
            continue;
        };
        if !matches_declared(declared, value) {
            return Err(format!(
                "argumento `{name}` deveria ser {} e veio {}",
                describe(declared),
                kind_of(value)
            ));
        }
    }
    Ok(())
}

/// Se o valor satisfaz o tipo declarado, que pode ser uma lista de tipos.
fn matches_declared(declared: &Value, value: &Value) -> bool {
    match declared {
        Value::String(name) => matches_name(name, value),
        Value::Array(names) => names
            .iter()
            .filter_map(Value::as_str)
            .any(|name| matches_name(name, value)),
        // Tipo declarado de forma que o módulo não entende: passa.
        _ => true,
    }
}

fn matches_name(name: &str, value: &Value) -> bool {
    match name {
        "string" => value.is_string(),
        // Um inteiro também é número; o contrário só vale sem parte fracionária,
        // porque `1.0` num campo `integer` é o que um modelo emite ao contar.
        "number" => value.is_number(),
        "integer" => value.as_f64().is_some_and(|n| n.fract() == 0.0),
        "boolean" => value.is_boolean(),
        "array" => value.is_array(),
        "object" => value.is_object(),
        "null" => value.is_null(),
        // Nome que o módulo não conhece: passa, pela mesma razão que o resto.
        _ => true,
    }
}

fn describe(declared: &Value) -> String {
    match declared {
        Value::String(name) => name.clone(),
        Value::Array(names) => names
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" ou "),
        other => other.to_string(),
    }
}

fn kind_of(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn busca() -> Value {
        json!({
            "type": "object",
            "properties": {
                "q": { "type": "string" },
                "limite": { "type": "integer" },
                "exato": { "type": "boolean" }
            },
            "required": ["q"]
        })
    }

    #[test]
    fn arguments_that_match_the_schema_pass() {
        assert!(check(&busca(), &json!({ "q": "erro", "limite": 5 })).is_ok());
    }

    #[test]
    fn a_missing_required_argument_is_named() {
        // Sem isto o erro vinha do servidor, com a mensagem que ele escolheu, a
        // um processo de distancia da causa.
        let err = check(&busca(), &json!({ "limite": 5 })).unwrap_err();
        assert!(err.contains('q'), "{err}");
        assert!(err.contains("obrigatorio"), "{err}");
    }

    #[test]
    fn a_wrong_type_says_what_was_expected_and_what_came() {
        // Um erro que so diz "invalido" faz o modelo tentar de novo igual.
        let err = check(&busca(), &json!({ "q": 42 })).unwrap_err();
        assert!(err.contains("string"), "{err}");
        assert!(err.contains("number"), "{err}");
    }

    #[test]
    fn an_integer_field_accepts_a_whole_number_written_as_a_decimal() {
        // `1.0` num campo de contagem e o que um modelo emite; recusar seria
        // pedantismo que custa um turno.
        assert!(check(&busca(), &json!({ "q": "x", "limite": 5.0 })).is_ok());
        assert!(check(&busca(), &json!({ "q": "x", "limite": 5.5 })).is_err());
    }

    #[test]
    fn an_undeclared_argument_passes() {
        // Recusar extra quebraria servidor que aceita campo nao documentado, e
        // o schema nem sempre declara `additionalProperties`.
        assert!(check(&busca(), &json!({ "q": "x", "extra": true })).is_ok());
    }

    #[test]
    fn no_arguments_at_all_still_reports_the_missing_required_one() {
        // `null` e como o agente representa "sem argumentos"; trata-lo como
        // outra coisa diria "nao e objeto" onde o problema e outro.
        let err = check(&busca(), &Value::Null).unwrap_err();
        assert!(err.contains("obrigatorio"), "{err}");
    }

    #[test]
    fn a_schema_without_required_or_properties_accepts_anything() {
        let solto = json!({ "type": "object" });
        assert!(check(&solto, &json!({ "seja": "o que for" })).is_ok());
        assert!(check(&solto, &Value::Null).is_ok());
    }

    #[test]
    fn a_union_type_accepts_either_side() {
        let schema = json!({
            "type": "object",
            "properties": { "id": { "type": ["string", "integer"] } }
        });

        assert!(check(&schema, &json!({ "id": "abc" })).is_ok());
        assert!(check(&schema, &json!({ "id": 7 })).is_ok());
        assert!(check(&schema, &json!({ "id": true })).is_err());
    }

    #[test]
    fn a_schema_the_module_does_not_understand_lets_the_call_through() {
        // Recusar o que nao se entende transformaria cada schema exotico numa
        // ferramenta quebrada.
        let exotico = json!({
            "type": "object",
            "properties": { "x": { "oneOf": [{ "type": "string" }] } }
        });
        assert!(check(&exotico, &json!({ "x": 1 })).is_ok());
        assert!(check(&json!("nem e objeto"), &json!({ "x": 1 })).is_ok());
    }

    #[test]
    fn a_scalar_where_an_object_belongs_is_refused() {
        let err = check(&busca(), &json!("texto solto")).unwrap_err();
        assert!(err.contains("objeto"), "{err}");
    }

    #[test]
    fn nested_shape_is_not_checked_and_the_module_says_so() {
        // Documenta a fronteira: um objeto aninhado passa qualquer que seja o
        // conteudo, e quem ler o teste sabe que isso e escolha e nao esquecimento.
        let schema = json!({
            "type": "object",
            "properties": { "filtro": { "type": "object",
                "properties": { "ano": { "type": "integer" } },
                "required": ["ano"] } }
        });

        assert!(check(&schema, &json!({ "filtro": { "ano": "mil" } })).is_ok());
    }
}
