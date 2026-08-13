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
        };
        let items = convert(&message);
        let content = &items[0]["content"];

        assert_eq!(content[0]["type"], "input_image");
        assert_eq!(content[0]["image_url"], "data:image/jpeg;base64,QUJD");
        assert_eq!(content[1]["type"], "input_text");
    }
}
