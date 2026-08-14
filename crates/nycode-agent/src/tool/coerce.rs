//! Coerção de argumento de ferramenta contra o schema declarado.
//!
//! Um modelo emite `{"limit": "10"}` com alguma frequência — o valor certo, no
//! tipo errado. As ferramentas leem com `as_u64`, que devolve `None`, e caem no
//! padrão **sem dizer nada**: o modelo pediu dez linhas, recebeu outra coisa, e
//! nada no turno registra a diferença. É a degradação silenciosa do NFR-4 na
//! fronteira mais fácil de não olhar.
//!
//! A coerção não inventa valor: ela lê o que o modelo enviou no tipo que o
//! schema declara. `"10"` vira `10` porque é o mesmo número; `"talvez"` não
//! vira nada, e a ferramenta recusa como recusaria antes.

use serde_json::{Map, Value};

/// Ajusta `input` aos tipos que `schema` declara.
///
/// Só desce onde o schema descreve: uma propriedade que ele não menciona passa
/// intacta, porque ali não há tipo declarado contra o qual comparar.
#[must_use]
pub fn coerce(input: Value, schema: &Value) -> Value {
    let Some(kind) = schema.get("type").and_then(Value::as_str) else {
        return input;
    };

    match kind {
        "object" => coerce_object(input, schema),
        "array" => coerce_array(input, schema),
        "integer" | "number" => coerce_number(input, kind),
        "boolean" => coerce_boolean(input),
        _ => input,
    }
}

fn coerce_object(input: Value, schema: &Value) -> Value {
    let Value::Object(fields) = input else {
        return input;
    };
    let properties = schema.get("properties").and_then(Value::as_object);

    let coerced: Map<String, Value> = fields
        .into_iter()
        .map(|(name, value)| {
            let declared = properties.and_then(|props| props.get(&name));
            let value = declared.map_or(value.clone(), |schema| coerce(value, schema));
            (name, value)
        })
        .collect();
    Value::Object(coerced)
}

fn coerce_array(input: Value, schema: &Value) -> Value {
    let items = schema.get("items");
    let coerce_item = |value: Value| items.map_or(value.clone(), |schema| coerce(value, schema));

    match input {
        Value::Array(values) => Value::Array(values.into_iter().map(coerce_item).collect()),
        // Um escalar onde cabe lista é a lista de um elemento. O modelo que
        // escreve `"path": "a.rs"` num campo de lista quis um caminho, não uma
        // recusa por tipo — e recusar ali gasta uma rodada para reescrever a
        // mesma intenção com colchetes.
        Value::Null => Value::Null,
        scalar => Value::Array(vec![coerce_item(scalar)]),
    }
}

fn coerce_number(input: Value, kind: &str) -> Value {
    let Value::String(text) = &input else {
        return input;
    };
    let text = text.trim();

    if kind == "integer" {
        if let Ok(number) = text.parse::<i64>() {
            return Value::from(number);
        }
        // Um inteiro escrito como `10.0` ainda é dez; `10.5` não é inteiro e
        // fica como estava, para a ferramenta recusar em vez de arredondar por
        // conta própria.
        if let Ok(number) = text.parse::<f64>()
            && number.fract() == 0.0
            && let Some(exact) = serde_json::Number::from_f64(number)
        {
            #[allow(clippy::cast_possible_truncation)]
            return Value::from(exact.as_f64().unwrap_or(number) as i64);
        }
        return input;
    }

    text.parse::<f64>()
        .ok()
        .and_then(serde_json::Number::from_f64)
        .map_or(input, Value::Number)
}

fn coerce_boolean(input: Value) -> Value {
    let Value::String(text) = &input else {
        return input;
    };
    match text.trim().to_ascii_lowercase().as_str() {
        "true" => Value::Bool(true),
        "false" => Value::Bool(false),
        _ => input,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "limit": { "type": "integer" },
                "ratio": { "type": "number" },
                "recursive": { "type": "boolean" },
                "paths": { "type": "array", "items": { "type": "string" } },
                "limits": { "type": "array", "items": { "type": "integer" } },
            }
        })
    }

    fn coerced(input: Value) -> Value {
        coerce(input, &schema())
    }

    #[test]
    fn a_number_written_as_text_becomes_the_number_it_already_was() {
        // Sem isto `as_u64` devolve `None`, a ferramenta cai no padrao, e o
        // modelo recebe um resultado que nao corresponde ao que pediu — sem
        // que nada no turno registre a diferenca.
        assert_eq!(coerced(json!({"limit": "10"}))["limit"], json!(10));
        assert_eq!(coerced(json!({"limit": " 42 "}))["limit"], json!(42));
        assert_eq!(coerced(json!({"ratio": "0.5"}))["ratio"], json!(0.5));
    }

    #[test]
    fn an_integer_written_with_a_zero_fraction_is_still_an_integer() {
        assert_eq!(coerced(json!({"limit": "10.0"}))["limit"], json!(10));
    }

    #[test]
    fn a_fractional_value_in_an_integer_field_is_left_for_the_tool_to_refuse() {
        // Arredondar por conta propria decidiria pelo modelo, e o numero
        // errado sairia com cara de numero pedido.
        assert_eq!(coerced(json!({"limit": "10.5"}))["limit"], json!("10.5"));
    }

    #[test]
    fn a_boolean_written_as_text_becomes_the_boolean() {
        assert_eq!(
            coerced(json!({"recursive": "true"}))["recursive"],
            json!(true)
        );
        assert_eq!(
            coerced(json!({"recursive": "FALSE"}))["recursive"],
            json!(false)
        );
    }

    #[test]
    fn a_scalar_where_a_list_fits_becomes_a_list_of_one() {
        assert_eq!(coerced(json!({"paths": "a.rs"}))["paths"], json!(["a.rs"]));
        assert_eq!(coerced(json!({"limits": "3"}))["limits"], json!([3]));
    }

    #[test]
    fn a_list_that_already_is_one_has_its_items_coerced() {
        assert_eq!(
            coerced(json!({"limits": ["1", "2"]}))["limits"],
            json!([1, 2])
        );
    }

    #[test]
    fn text_that_is_not_the_declared_type_is_left_alone() {
        // Coercao nao inventa valor: `talvez` nao e numero nenhum, e a
        // ferramenta recusa como recusaria antes.
        assert_eq!(
            coerced(json!({"limit": "talvez"}))["limit"],
            json!("talvez")
        );
        assert_eq!(
            coerced(json!({"recursive": "quem sabe"}))["recursive"],
            json!("quem sabe")
        );
    }

    #[test]
    fn a_value_already_in_the_declared_type_is_untouched() {
        let input = json!({"path": "a.rs", "limit": 10, "recursive": true});
        assert_eq!(coerced(input.clone()), input);
    }

    #[test]
    fn a_property_the_schema_does_not_mention_passes_through() {
        // Sem tipo declarado nao ha contra o que comparar, e adivinhar ali
        // mexeria num campo que a ferramenta pode estar lendo cru.
        assert_eq!(coerced(json!({"extra": "10"}))["extra"], json!("10"));
    }

    #[test]
    fn a_null_stays_null_instead_of_becoming_a_list_of_null() {
        assert_eq!(coerced(json!({"paths": null}))["paths"], json!(null));
    }

    #[test]
    fn an_input_that_is_not_an_object_is_left_for_the_tool_to_refuse() {
        assert_eq!(coerce(json!("solto"), &schema()), json!("solto"));
        assert_eq!(coerce(json!(null), &schema()), json!(null));
    }

    #[test]
    fn a_schema_without_a_declared_type_changes_nothing() {
        assert_eq!(
            coerce(json!({"limit": "10"}), &json!({})),
            json!({"limit": "10"})
        );
    }
}
