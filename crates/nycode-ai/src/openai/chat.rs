//! Dialeto OpenAI Chat Completions.

use serde_json::{Value, json};

use super::chat_stream::ChatDecoder;
use crate::anthropic::{ContentBlock, ImageSource, Message, Role, ToolSpec};
use crate::dialect::{Dialect, StreamDecoder, UnifiedRequest, parse_nested_error};
use crate::error::ApiError;

/// `POST /v1/chat/completions`.
#[derive(Debug, Default, Clone, Copy)]
pub struct Chat;

impl Dialect for Chat {
    fn route(&self) -> &'static str {
        "chat/completions"
    }

    fn headers(&self, api_key: &str) -> Vec<(&'static str, String)> {
        vec![("authorization", format!("Bearer {api_key}"))]
    }

    fn body(&self, request: &UnifiedRequest<'_>) -> Value {
        let mut messages = Vec::new();
        if let Some(system) = request.system {
            messages.push(json!({ "role": "system", "content": system }));
        }
        for message in request.messages {
            messages.extend(convert(message));
        }

        let mut body = json!({
            "model": request.model,
            // O gateway documenta que um teto positivo chega aos backends
            // OpenAI-compativeis como `max_completion_tokens`, nao `max_tokens`.
            "max_completion_tokens": request.max_tokens,
            "messages": messages,
            "stream": true,
            // Sem isto o turno termina sem contabilidade e o custo fica invisivel.
            "stream_options": { "include_usage": true },
        });

        if !request.tools.is_empty() {
            body["tools"] = Value::Array(request.tools.iter().map(declare_tool).collect());
        }

        // Ate a spec 002 este dialeto nao consultava `sampling` em ponto
        // nenhum: a unica mencao ao tipo estava num helper `#[cfg(test)]`.
        // Temperatura, raciocinio e sequencia de parada eram configuraveis e
        // nunca saiam do processo.
        let sampling = request.sampling;
        if let Some(temperature) = sampling.temperature {
            body["temperature"] = json!(temperature);
        }
        if let Some(top_p) = sampling.top_p {
            body["top_p"] = json!(top_p);
        }
        if !sampling.stop_sequences.is_empty() {
            body["stop"] = json!(sampling.stop_sequences);
        }
        if let Some(effort) = sampling.thinking.effort() {
            body["reasoning_effort"] = json!(effort.name);
        }
        // O cache deste dialeto e por chave, nao por ponto de corte: o backend
        // agrupa pedidos que declaram a mesma chave e reaproveita o prefixo
        // comum. Sem ela o NFR-7 valia so para o dialeto Anthropic.
        if let Some(key) = super::cache::key_of(sampling) {
            body["prompt_cache_key"] = json!(key);
        }
        if let Some(retention) = super::cache::retention_of(sampling) {
            body["prompt_cache_retention"] = json!(retention);
        }
        crate::ToolChoice::of(request.tools).emit_openai(&mut body);
        body
    }

    fn decoder(&self) -> Box<dyn StreamDecoder> {
        Box::new(ChatDecoder::new())
    }

    fn parse_error(&self, status: u16, body: &str) -> ApiError {
        parse_nested_error(status, body, "http_error")
    }

    fn name(&self) -> &'static str {
        "openai-completions"
    }
}

fn declare_tool(spec: &ToolSpec) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": spec.name,
            "description": spec.description,
            "parameters": spec.input_schema,
        }
    })
}

/// Traduz uma mensagem canônica para a forma do Chat Completions.
///
/// Uma mensagem pode virar mais de uma: resultados de ferramenta são mensagens
/// próprias com `role: "tool"` neste dialeto, enquanto na forma canônica eles
/// viajam como blocos dentro de uma mensagem de usuário.
fn convert(message: &Message) -> Vec<Value> {
    let mut out = Vec::new();
    let mut text = String::new();
    let mut tool_calls = Vec::new();
    let mut images = Vec::new();

    for block in &message.content {
        match block {
            ContentBlock::Text { text: chunk } => text.push_str(chunk),
            ContentBlock::ToolUse { id, name, input } => tool_calls.push(json!({
                "id": id,
                "type": "function",
                "function": {
                    "name": name,
                    // Os argumentos vao como string JSON, nao objeto: o backend
                    // rejeita um objeto aqui.
                    "arguments": serde_json::to_string(input).unwrap_or_else(|_| "{}".to_owned()),
                }
            })),
            ContentBlock::Image {
                source: ImageSource::Base64 { media_type, data },
            } => images.push(json!({
                "type": "image_url",
                "image_url": { "url": format!("data:{media_type};base64,{data}") },
            })),
            ContentBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => {
                // O dialeto nao tem campo de erro; prefixar e a unica forma de o
                // modelo saber que a ferramenta falhou em vez de retornar isto.
                let content = if *is_error {
                    format!("ERRO: {content}")
                } else {
                    content.clone()
                };
                out.push(json!({
                    "role": "tool",
                    "tool_call_id": tool_use_id,
                    "content": content,
                }));
            }
        }
    }

    let role = match message.role {
        Role::User => "user",
        Role::Assistant => "assistant",
    };

    if !text.is_empty() || !tool_calls.is_empty() || !images.is_empty() {
        // Sem imagem o conteudo continua sendo string: a forma de lista muda o
        // wire, e muda-la sem necessidade invalidaria o cache de prompt.
        let content = if images.is_empty() {
            Value::String(text)
        } else {
            let mut parts = vec![json!({ "type": "text", "text": text })];
            parts.extend(images);
            Value::Array(parts)
        };
        let mut msg = json!({ "role": role, "content": content });
        if !tool_calls.is_empty() {
            msg["tool_calls"] = Value::Array(tool_calls);
        }
        // A mensagem do assistente precisa preceder os resultados que a
        // respondem, senao o backend ve `tool_call_id` sem origem.
        out.insert(0, msg);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body_of(messages: &[Message], system: Option<&str>, tools: &[ToolSpec]) -> Value {
        Chat.body(&UnifiedRequest {
            model: "nylla-sonnet-4.5",
            max_tokens: 512,
            messages,
            system,
            tools,
            sampling: &crate::sampling::Sampling::default(),
        })
    }

    fn body_with(sampling: &crate::sampling::Sampling) -> Value {
        Chat.body(&UnifiedRequest {
            model: "m",
            max_tokens: 512,
            messages: &[Message::user("oi")],
            system: Some("sistema"),
            tools: &[],
            sampling,
        })
    }

    #[test]
    fn nothing_the_caller_did_not_ask_for_reaches_the_wire() {
        let body = body_with(&crate::sampling::Sampling::default());
        for absent in [
            "temperature",
            "top_p",
            "stop",
            "reasoning_effort",
            "prompt_cache_key",
        ] {
            assert!(body.get(absent).is_none(), "{absent} nao foi pedido");
        }
    }

    #[test]
    fn the_sampling_knobs_reach_the_wire_when_they_are_set() {
        // A assimetria que a spec 002 fechou: este dialeto nunca consultava
        // `sampling`, e a unica mencao ao tipo no arquivo estava num helper de
        // teste. Temperatura e raciocinio eram configuraveis e nao saiam daqui.
        let body = body_with(
            &crate::sampling::Sampling::default()
                .with_temperature(0.2)
                .with_top_p(0.9)
                .with_thinking(crate::sampling::ThinkingLevel::High)
                .with_stop_sequences(vec!["FIM".to_owned()]),
        );

        assert!((body["temperature"].as_f64().unwrap() - 0.2).abs() < 1e-6);
        assert!((body["top_p"].as_f64().unwrap() - 0.9).abs() < 1e-6);
        assert_eq!(body["stop"][0], "FIM");
        assert_eq!(body["reasoning_effort"], "high");
    }

    #[test]
    fn the_cache_key_reaches_the_wire_so_nfr7_holds_in_this_dialect_too() {
        // Este formato nao tem ponto de corte: o backend agrupa pelos pedidos
        // que declaram a mesma chave. Sem ela o NFR-7 valia so no Anthropic.
        let body = body_with(&crate::sampling::Sampling::default().with_cache_key("sessao-1"));
        assert_eq!(body["prompt_cache_key"], "sessao-1");
    }

    #[test]
    fn turning_the_cache_off_drops_the_key_instead_of_sending_it() {
        let body = body_with(
            &crate::sampling::Sampling::default()
                .with_cache_key("sessao-1")
                .without_cache(),
        );
        assert!(body.get("prompt_cache_key").is_none());
    }

    #[test]
    fn long_retention_is_asked_for_on_the_wire_and_not_only_accounted_for() {
        // `Usage::cache_write_1h_tokens` ja existia e `catalog::cost` ja o
        // cobrava ao dobro; nada no repositorio conseguia pedir a retencao
        // longa. A contabilidade tratava um estado inalcancavel.
        let body = body_with(
            &crate::sampling::Sampling::default()
                .with_cache_key("sessao-1")
                .with_long_cache(),
        );
        assert_eq!(body["prompt_cache_retention"], "24h");
    }

    #[test]
    fn short_retention_says_nothing_instead_of_naming_the_default() {
        let body = body_with(&crate::sampling::Sampling::default().with_cache_key("sessao-1"));
        assert!(body.get("prompt_cache_retention").is_none());
    }

    #[test]
    fn an_oversized_cache_key_is_clamped_instead_of_being_refused_by_the_backend() {
        // O formato limita a chave a 64 caracteres. Um id de sessao mais longo
        // faria o backend recusar o pedido inteiro por causa de um campo que
        // existe para economizar.
        let body = body_with(
            &crate::sampling::Sampling::default().with_cache_key("s".repeat(200).as_str()),
        );
        assert_eq!(body["prompt_cache_key"].as_str().unwrap().len(), 64);
    }

    #[test]
    fn this_dialect_emits_every_knob_it_is_given() {
        // Nao ha nada a declarar como nao suportado: se um dia houver, o teste
        // falha e alguem precisa decidir o que dizer ao usuario.
        let sampling = crate::sampling::Sampling::default()
            .with_temperature(0.2)
            .with_stop_sequences(vec!["FIM".to_owned()])
            .with_thinking(crate::sampling::ThinkingLevel::Max);
        assert!(Chat.unsupported_sampling(&sampling).is_empty());
    }

    #[test]
    fn uses_max_completion_tokens_not_max_tokens() {
        // O gateway documenta que backends OpenAI-compativeis recebem o teto
        // como `max_completion_tokens`; o nome antigo e ignorado por varios.
        let body = body_of(&[Message::user("oi")], None, &[]);
        assert_eq!(body["max_completion_tokens"], 512);
        assert!(body.get("max_tokens").is_none());
    }

    #[test]
    fn always_asks_for_usage_in_the_stream() {
        // Sem `stream_options.include_usage` o turno termina sem contabilidade e
        // o custo fica invisivel.
        let body = body_of(&[Message::user("oi")], None, &[]);
        assert_eq!(body["stream_options"]["include_usage"], true);
    }

    #[test]
    fn the_system_prompt_becomes_the_first_message() {
        let body = body_of(&[Message::user("oi")], Some("seja breve"), &[]);
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][0]["content"], "seja breve");
        assert_eq!(body["messages"][1]["role"], "user");
    }

    #[test]
    fn tool_arguments_are_sent_as_a_json_string_not_an_object() {
        // Mandar objeto aqui faz o backend rejeitar a requisicao.
        let assistant = Message::assistant(vec![ContentBlock::ToolUse {
            id: "call_1".to_owned(),
            name: "read".to_owned(),
            input: json!({ "path": "a.rs" }),
        }]);
        let body = body_of(&[assistant], None, &[]);
        let arguments = &body["messages"][0]["tool_calls"][0]["function"]["arguments"];
        assert!(arguments.is_string(), "argumentos precisam ser string JSON");
        assert_eq!(arguments.as_str().unwrap(), r#"{"path":"a.rs"}"#);
    }

    #[test]
    fn tool_results_become_their_own_message_with_the_tool_role() {
        let results = Message::tool_results(vec![ContentBlock::tool_result("call_1", "conteudo")]);
        let body = body_of(&[results], None, &[]);
        assert_eq!(body["messages"][0]["role"], "tool");
        assert_eq!(body["messages"][0]["tool_call_id"], "call_1");
        assert_eq!(body["messages"][0]["content"], "conteudo");
    }

    #[test]
    fn a_failed_tool_is_marked_in_the_content_since_the_dialect_has_no_error_field() {
        // Sem a marcacao o modelo trataria "arquivo nao encontrado" como sendo o
        // conteudo do arquivo.
        let results = Message::tool_results(vec![ContentBlock::tool_error("call_1", "ausente")]);
        let body = body_of(&[results], None, &[]);
        assert_eq!(body["messages"][0]["content"], "ERRO: ausente");
    }

    #[test]
    fn the_assistant_message_precedes_the_results_that_answer_it() {
        // Invertido, o backend ve um `tool_call_id` sem origem e recusa o turno.
        let mixed = Message {
            role: Role::Assistant,
            content: vec![
                ContentBlock::text("vou ler"),
                ContentBlock::ToolUse {
                    id: "c1".to_owned(),
                    name: "read".to_owned(),
                    input: json!({}),
                },
                ContentBlock::tool_result("c1", "ok"),
            ],
            discarded: false,
        };
        let body = body_of(&[mixed], None, &[]);
        assert_eq!(body["messages"][0]["role"], "assistant");
        assert_eq!(body["messages"][1]["role"], "tool");
    }

    #[test]
    fn tools_are_declared_in_the_function_envelope() {
        let tools = vec![ToolSpec {
            name: "read".to_owned(),
            description: "le arquivo".to_owned(),
            input_schema: json!({ "type": "object" }),
            extension: false,
        }];
        let body = body_of(&[Message::user("oi")], None, &tools);
        assert_eq!(body["tools"][0]["type"], "function");
        assert_eq!(body["tools"][0]["function"]["name"], "read");
        assert_eq!(body["tools"][0]["function"]["parameters"]["type"], "object");
    }

    #[test]
    fn an_empty_tool_list_is_omitted() {
        let body = body_of(&[Message::user("oi")], None, &[]);
        assert!(body.get("tools").is_none());
    }

    #[test]
    fn authenticates_with_a_bearer_token() {
        assert_eq!(
            Chat.headers("segredo"),
            vec![("authorization", "Bearer segredo".to_owned())]
        );
    }

    #[test]
    fn route_and_name_match_the_configuration_vocabulary() {
        assert_eq!(Chat.route(), "chat/completions");
        assert_eq!(Chat.name(), "openai-completions");
    }

    #[test]
    fn context_overflow_is_recognized_in_this_dialect_too() {
        let err = Chat.parse_error(
            400,
            r#"{"error":{"code":"context_length_exceeded","message":"prompt too long"}}"#,
        );
        assert!(err.is_context_overflow());
    }

    #[test]
    fn an_image_becomes_a_content_list_in_this_dialect() {
        // FR-20. Aqui a imagem nao e um bloco irmao do texto: o conteudo
        // inteiro vira lista, e mandar a string simples perderia o anexo.
        let message = Message {
            role: Role::User,
            content: vec![
                ContentBlock::image("image/png", "QUJD"),
                ContentBlock::text("o que ha nesta captura?"),
            ],
            discarded: false,
        };
        let converted = convert(&message);

        let content = &converted[0]["content"];
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[1]["type"], "image_url");
        assert_eq!(content[1]["image_url"]["url"], "data:image/png;base64,QUJD");
    }

    #[test]
    fn a_message_without_an_image_keeps_the_plain_string_content() {
        // A forma de lista muda o wire; muda-la sem necessidade invalidaria o
        // cache de prompt do backend sem nenhum ganho.
        let converted = convert(&Message::user("so texto"));
        assert_eq!(converted[0]["content"], "so texto");
    }
}
