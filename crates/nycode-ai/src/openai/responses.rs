//! Dialeto OpenAI Responses.

use serde_json::{Value, json};

use super::responses_stream::ResponsesDecoder;
use crate::anthropic::{ContentBlock, ImageSource, Message, Role, ToolSpec};
use crate::dialect::{Dialect, StreamDecoder, UnifiedRequest, parse_nested_error};
use crate::error::ApiError;

/// `POST /v1/responses`.
///
/// O gateway recusa `previous_response_id`, `background:true` e `conversation`
/// neste dialeto, e aceita-e-ignora `store`. Nenhum deles é emitido: mandar um
/// campo que o servidor recusa transforma uma requisição válida em 400.
#[derive(Debug, Default, Clone, Copy)]
pub struct Responses;

impl Dialect for Responses {
    fn route(&self) -> &'static str {
        "responses"
    }

    fn headers(&self, api_key: &str) -> Vec<(&'static str, String)> {
        vec![("authorization", format!("Bearer {api_key}"))]
    }

    fn body(&self, request: &UnifiedRequest<'_>) -> Value {
        let input: Vec<Value> = request.messages.iter().flat_map(convert).collect();

        let mut body = json!({
            "model": request.model,
            "max_output_tokens": request.max_tokens,
            "input": input,
            "stream": true,
        });

        if let Some(system) = request.system {
            body["instructions"] = Value::String(system.to_owned());
        }
        if !request.tools.is_empty() {
            body["tools"] = Value::Array(request.tools.iter().map(declare_tool).collect());
        }

        let sampling = request.sampling;
        if let Some(temperature) = sampling.temperature {
            body["temperature"] = json!(temperature);
        }
        if let Some(top_p) = sampling.top_p {
            body["top_p"] = json!(top_p);
        }
        if let Some(effort) = sampling.thinking.effort() {
            body["reasoning"] = json!({ "effort": effort.name });
        }
        if let Some(key) = super::cache::key_of(sampling) {
            body["prompt_cache_key"] = json!(key);
        }
        if let Some(retention) = super::cache::retention_of(sampling) {
            body["prompt_cache_retention"] = json!(retention);
        }
        // Sequencia de parada nao entra: este endpoint nao a aceita, e mandar
        // um campo que o servidor recusa transforma um pedido valido em 400. A
        // configuracao nao e descartada em silencio — `unsupported_sampling` a
        // declara para quem monta a sessao contar ao usuario.
        crate::ToolChoice::of(request.tools).emit_openai(&mut body);
        body
    }

    fn decoder(&self) -> Box<dyn StreamDecoder> {
        Box::new(ResponsesDecoder::new())
    }

    fn parse_error(&self, status: u16, body: &str) -> ApiError {
        parse_nested_error(status, body, "http_error")
    }

    fn name(&self) -> &'static str {
        "openai-responses"
    }

    fn unsupported_sampling(&self, sampling: &crate::sampling::Sampling) -> Vec<&'static str> {
        if sampling.stop_sequences.is_empty() {
            Vec::new()
        } else {
            vec!["stop_sequences"]
        }
    }
}

/// Neste dialeto a função é declarada achatada, sem o envelope `function`.
fn declare_tool(spec: &ToolSpec) -> Value {
    json!({
        "type": "function",
        "name": spec.name,
        "description": spec.description,
        "parameters": spec.input_schema,
    })
}

/// Traduz uma mensagem canônica em itens de `input`.
fn convert(message: &Message) -> Vec<Value> {
    let mut items = Vec::new();
    let mut parts = Vec::new();

    // O tipo da parte de texto depende do papel: `input_text` para o usuario,
    // `output_text` para o assistente. Trocar os dois faz o backend recusar.
    let (role, text_type) = match message.role {
        Role::User => ("user", "input_text"),
        Role::Assistant => ("assistant", "output_text"),
    };

    for block in &message.content {
        match block {
            ContentBlock::Text { text } => {
                parts.push(json!({ "type": text_type, "text": text }));
            }
            ContentBlock::Image {
                source: ImageSource::Base64 { media_type, data },
            } => parts.push(json!({
                "type": "input_image",
                "image_url": format!("data:{media_type};base64,{data}"),
            })),
            ContentBlock::ToolUse { id, name, input } => items.push(json!({
                "type": "function_call",
                "call_id": id,
                "name": name,
                "arguments": serde_json::to_string(input).unwrap_or_else(|_| "{}".to_owned()),
            })),
            ContentBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => {
                let output = if *is_error {
                    format!("ERRO: {content}")
                } else {
                    content.clone()
                };
                items.push(json!({
                    "type": "function_call_output",
                    "call_id": tool_use_id,
                    "output": output,
                }));
            }
        }
    }

    if !parts.is_empty() {
        items.insert(
            0,
            json!({ "type": "message", "role": role, "content": parts }),
        );
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body_of(messages: &[Message], system: Option<&str>, tools: &[ToolSpec]) -> Value {
        Responses.body(&UnifiedRequest {
            model: "nylla-gpt-5.6-terra",
            max_tokens: 4096,
            messages,
            system,
            tools,
            sampling: &crate::sampling::Sampling::default(),
        })
    }

    fn body_with(sampling: &crate::sampling::Sampling) -> Value {
        Responses.body(&UnifiedRequest {
            model: "m",
            max_tokens: 4096,
            messages: &[Message::user("oi")],
            system: Some("sistema"),
            tools: &[],
            sampling,
        })
    }

    #[test]
    fn nothing_the_caller_did_not_ask_for_reaches_the_wire() {
        let body = body_with(&crate::sampling::Sampling::default());
        for absent in ["temperature", "top_p", "reasoning", "prompt_cache_key"] {
            assert!(body.get(absent).is_none(), "{absent} nao foi pedido");
        }
    }

    #[test]
    fn the_sampling_knobs_reach_the_wire_when_they_are_set() {
        let body = body_with(
            &crate::sampling::Sampling::default()
                .with_temperature(0.2)
                .with_top_p(0.9)
                .with_thinking(crate::sampling::ThinkingLevel::Medium),
        );

        assert!((body["temperature"].as_f64().unwrap() - 0.2).abs() < 1e-6);
        assert!((body["top_p"].as_f64().unwrap() - 0.9).abs() < 1e-6);
        assert_eq!(body["reasoning"]["effort"], "medium");
    }

    #[test]
    fn a_level_above_what_this_endpoint_offers_is_downgraded_not_dropped() {
        // O conjunto documentado vai ate `high`. Descartar deixaria o turno sem
        // raciocinio nenhum, que e o oposto do que foi pedido.
        let body = body_with(
            &crate::sampling::Sampling::default()
                .with_thinking(crate::sampling::ThinkingLevel::Max),
        );
        assert_eq!(body["reasoning"]["effort"], "high");
    }

    #[test]
    fn the_cache_key_reaches_the_wire_so_nfr7_holds_in_this_dialect_too() {
        let body = body_with(&crate::sampling::Sampling::default().with_cache_key("sessao-1"));
        assert_eq!(body["prompt_cache_key"], "sessao-1");
    }

    #[test]
    fn a_stop_sequence_is_declared_unsupported_instead_of_being_sent_or_dropped() {
        // Este endpoint nao aceita o campo, e manda-lo transforma um pedido
        // valido em 400. Descartar em silencio e o que o NFR-4 proibe, entao o
        // dialeto declara e quem monta a sessao conta ao usuario.
        let sampling =
            crate::sampling::Sampling::default().with_stop_sequences(vec!["FIM".to_owned()]);

        assert!(body_with(&sampling).get("stop").is_none());
        assert_eq!(
            Responses.unsupported_sampling(&sampling),
            ["stop_sequences"]
        );
    }

    #[test]
    fn without_a_stop_sequence_there_is_nothing_to_declare() {
        assert!(
            Responses
                .unsupported_sampling(&crate::sampling::Sampling::default())
                .is_empty()
        );
    }

    #[test]
    fn never_emits_fields_the_gateway_refuses() {
        // `previous_response_id`, `background` e `conversation` sao recusados
        // pelo gateway neste dialeto; emiti-los transforma um pedido valido em 400.
        let body = body_of(&[Message::user("oi")], None, &[]);
        for forbidden in [
            "previous_response_id",
            "background",
            "conversation",
            "store",
        ] {
            assert!(
                body.get(forbidden).is_none(),
                "{forbidden} nao pode ir no wire"
            );
        }
    }

    #[test]
    fn uses_max_output_tokens_and_instructions() {
        let body = body_of(&[Message::user("oi")], Some("seja breve"), &[]);
        assert_eq!(body["max_output_tokens"], 4096);
        assert_eq!(body["instructions"], "seja breve");
        assert!(
            body.get("messages").is_none(),
            "este dialeto usa `input`, nao `messages`"
        );
    }

    #[test]
    fn user_text_is_input_text_and_assistant_text_is_output_text() {
        // Trocar os dois faz o backend recusar o item.
        let user = body_of(&[Message::user("pergunta")], None, &[]);
        assert_eq!(user["input"][0]["content"][0]["type"], "input_text");

        let assistant = body_of(
            &[Message::assistant(vec![ContentBlock::text("resposta")])],
            None,
            &[],
        );
        assert_eq!(assistant["input"][0]["content"][0]["type"], "output_text");
    }

    #[test]
    fn tool_calls_are_flat_items_with_call_id() {
        let assistant = Message::assistant(vec![ContentBlock::ToolUse {
            id: "call_1".to_owned(),
            name: "read".to_owned(),
            input: json!({ "path": "a.rs" }),
        }]);
        let body = body_of(&[assistant], None, &[]);
        assert_eq!(body["input"][0]["type"], "function_call");
        assert_eq!(body["input"][0]["call_id"], "call_1");
        assert_eq!(
            body["input"][0]["arguments"].as_str().unwrap(),
            r#"{"path":"a.rs"}"#
        );
    }

    #[test]
    fn tool_results_become_function_call_output() {
        let results = Message::tool_results(vec![ContentBlock::tool_result("call_1", "conteudo")]);
        let body = body_of(&[results], None, &[]);
        assert_eq!(body["input"][0]["type"], "function_call_output");
        assert_eq!(body["input"][0]["call_id"], "call_1");
        assert_eq!(body["input"][0]["output"], "conteudo");
    }

    #[test]
    fn a_failed_tool_is_marked_in_the_output() {
        let results = Message::tool_results(vec![ContentBlock::tool_error("call_1", "ausente")]);
        let body = body_of(&[results], None, &[]);
        assert_eq!(body["input"][0]["output"], "ERRO: ausente");
    }

    #[test]
    fn tools_are_declared_flat_without_the_function_envelope() {
        // Este dialeto difere do Chat Completions justamente aqui.
        let tools = vec![ToolSpec {
            name: "read".to_owned(),
            description: "le".to_owned(),
            input_schema: json!({ "type": "object" }),
            extension: false,
        }];
        let body = body_of(&[Message::user("oi")], None, &tools);
        assert_eq!(body["tools"][0]["type"], "function");
        assert_eq!(body["tools"][0]["name"], "read");
        assert!(body["tools"][0].get("function").is_none());
    }

    #[test]
    fn route_name_and_auth_match_the_dialect() {
        assert_eq!(Responses.route(), "responses");
        assert_eq!(Responses.name(), "openai-responses");
        assert_eq!(
            Responses.headers("k"),
            vec![("authorization", "Bearer k".to_owned())]
        );
    }

    #[test]
    fn context_overflow_is_recognized() {
        let err = Responses.parse_error(
            400,
            r#"{"error":{"code":"context_length_exceeded","message":"x"}}"#,
        );
        assert!(err.is_context_overflow());
    }

    #[test]
    fn an_image_becomes_an_input_image_part() {
        // FR-20. O nome do tipo difere do outro dialeto da mesma familia;
        // trocar os dois faz o backend recusar.
        let message = Message {
            role: Role::User,
            content: vec![
                ContentBlock::image("image/jpeg", "QUJD"),
                ContentBlock::text("descreva"),
            ],
            discarded: false,
        };
        let items = convert(&message);
        let content = &items[0]["content"];

        assert_eq!(content[0]["type"], "input_image");
        assert_eq!(content[0]["image_url"], "data:image/jpeg;base64,QUJD");
        assert_eq!(content[1]["type"], "input_text");
    }
}
