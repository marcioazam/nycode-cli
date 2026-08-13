//! Implementação de [`Dialect`] para Anthropic Messages.

use serde_json::{Value, json};

use super::{Decoder, Request};
use crate::dialect::{Dialect, StreamDecoder, UnifiedRequest, parse_nested_error};
use crate::error::{ApiError, Result};
use crate::event::StreamEvent;
use crate::sampling::{self, Sampling};

/// Versão da API enviada em toda requisição.
///
/// O gateway tolera a ausência, mas o backend real não; mandar sempre evita uma
/// diferença de comportamento entre rodar contra o gateway e contra o upstream.
const API_VERSION: &str = "2023-06-01";

/// `POST /v1/messages`.
#[derive(Debug, Default, Clone, Copy)]
pub struct Messages;

impl StreamDecoder for Decoder {
    fn decode(&mut self, raw: &str) -> Result<Option<StreamEvent>> {
        Self::decode(self, raw)
    }

    fn completed(&self) -> bool {
        Self::completed(self)
    }

    fn mark_usage_estimated(&mut self) {
        Self::mark_usage_estimated(self);
    }
}

impl Dialect for Messages {
    fn route(&self) -> &'static str {
        "messages"
    }

    fn headers(&self, api_key: &str) -> Vec<(&'static str, String)> {
        vec![
            ("x-api-key", api_key.to_owned()),
            ("anthropic-version", API_VERSION.to_owned()),
        ]
    }

    fn body(&self, request: &UnifiedRequest<'_>) -> Value {
        let wire = Request {
            model: request.model.to_owned(),
            max_tokens: request.max_tokens,
            messages: request.messages.to_vec(),
            system: request.system.map(ToOwned::to_owned),
            tools: request.tools.to_vec(),
            stream: true,
        };
        let mut body = serde_json::to_value(wire).unwrap_or_else(|_| json!({}));
        decorate(&mut body, request.sampling);
        body
    }

    fn decoder(&self) -> Box<dyn StreamDecoder> {
        Box::new(Decoder::new())
    }

    fn parse_error(&self, status: u16, body: &str) -> ApiError {
        parse_nested_error(status, body, "api_error")
    }

    fn name(&self) -> &'static str {
        "anthropic-messages"
    }
}

/// Acrescenta ao corpo o que não é conteúdo: amostragem, raciocínio e cache.
///
/// Feito por cima do JSON serializado, e não por campos em `Request`, porque
/// `cache_control` muda a *forma* de `system` — de string para lista de blocos
/// — e essa forma só existe quando o cache está ligado.
fn decorate(body: &mut Value, sampling: &Sampling) {
    let Some(object) = body.as_object_mut() else {
        return;
    };

    if let Some(temperature) = sampling.temperature {
        object.insert("temperature".to_owned(), json!(temperature));
    }
    if let Some(top_p) = sampling.top_p {
        object.insert("top_p".to_owned(), json!(top_p));
    }
    if !sampling.stop_sequences.is_empty() {
        object.insert("stop_sequences".to_owned(), json!(sampling.stop_sequences));
    }
    if let Some(budget) = sampling.thinking_budget {
        object.insert(
            "thinking".to_owned(),
            json!({ "type": "enabled", "budget_tokens": budget }),
        );
    }

    if !sampling.cache_prefix {
        return;
    }

    // O prefixo estável é o sistema mais as ferramentas: é o que se repete
    // idêntico a cada turno. Marcar depois disso não acerta, porque o histórico
    // cresce e um prefixo que muda é um cache que erra.
    if let Some(Value::String(text)) = object.get("system") {
        let block = json!([{
            "type": "text",
            "text": text,
            "cache_control": sampling::ephemeral(),
        }]);
        object.insert("system".to_owned(), block);
    }

    if let Some(Value::Array(tools)) = object.get_mut("tools") {
        // Só a última: o marcador cobre tudo que veio antes dele, e um por
        // ferramenta gastaria os pontos de corte que o backend limita.
        if let Some(Value::Object(last)) = tools.last_mut() {
            last.insert("cache_control".to_owned(), sampling::ephemeral());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anthropic::{ContentBlock, Message, ToolSpec};

    fn tool() -> ToolSpec {
        ToolSpec {
            name: "read".to_owned(),
            description: "le".to_owned(),
            input_schema: json!({ "type": "object" }),
        }
    }

    fn body_with(sampling: &Sampling) -> Value {
        Messages.body(&UnifiedRequest {
            model: "nylla-sonnet-4.5",
            max_tokens: 1024,
            messages: &[Message::user("oi")],
            system: Some("voce e o nycode"),
            tools: &[tool()],
            sampling,
        })
    }

    #[test]
    fn the_stable_prefix_is_marked_for_the_backend_cache() {
        // Sem isto o cache de prompt nunca acerta, e a contabilidade de cache
        // que o `Usage` ja reportava mede sempre zero: a metrica existia sem a
        // causa (NFR-7).
        let body = body_with(&Sampling::default());

        assert_eq!(body["system"][0]["cache_control"]["type"], "ephemeral");
        assert_eq!(body["system"][0]["text"], "voce e o nycode");
        assert_eq!(
            body["tools"][0]["cache_control"]["type"], "ephemeral",
            "a ultima ferramenta fecha o prefixo estavel"
        );
    }

    #[test]
    fn only_the_last_tool_carries_a_breakpoint() {
        // O marcador cobre tudo que veio antes dele; um por ferramenta gastaria
        // os pontos de corte que o backend limita.
        let tools = [
            ToolSpec {
                name: "read".to_owned(),
                description: "le".to_owned(),
                input_schema: json!({ "type": "object" }),
            },
            tool(),
        ];
        let body = Messages.body(&UnifiedRequest {
            model: "m",
            max_tokens: 8,
            messages: &[Message::user("oi")],
            system: None,
            tools: &tools,
            sampling: &Sampling::default(),
        });

        assert!(body["tools"][0].get("cache_control").is_none());
        assert!(body["tools"][1].get("cache_control").is_some());
    }

    #[test]
    fn without_caching_the_system_stays_a_plain_string() {
        // A forma de bloco so existe porque o marcador precisa dela; impo-la
        // sem motivo mudaria o wire sem ganho.
        let body = body_with(&Sampling::default().without_cache());

        assert_eq!(body["system"], "voce e o nycode");
        assert!(body["tools"][0].get("cache_control").is_none());
    }

    #[test]
    fn a_request_without_a_system_prompt_is_not_given_one() {
        let body = Messages.body(&UnifiedRequest {
            model: "m",
            max_tokens: 8,
            messages: &[Message::user("oi")],
            system: None,
            tools: &[],
            sampling: &Sampling::default(),
        });
        assert!(body.get("system").is_none());
    }

    #[test]
    fn nothing_the_caller_did_not_ask_for_reaches_the_wire() {
        // Mandar uma temperatura inventada seria escolher por um modelo cujo
        // padrao o provedor calibrou.
        let body = body_with(&Sampling::default());
        for absent in ["temperature", "top_p", "stop_sequences", "thinking"] {
            assert!(body.get(absent).is_none(), "{absent} nao foi pedido");
        }
    }

    #[test]
    fn the_sampling_knobs_reach_the_wire_when_they_are_set() {
        let sampling = Sampling::default()
            .with_temperature(0.2)
            .with_thinking(4096)
            .with_stop_sequences(vec!["FIM".to_owned()]);
        let body = body_with(&sampling);

        assert!((body["temperature"].as_f64().unwrap() - 0.2).abs() < 1e-6);
        assert_eq!(body["stop_sequences"][0], "FIM");
        assert_eq!(body["thinking"]["type"], "enabled");
        assert_eq!(body["thinking"]["budget_tokens"], 4096);
    }

    #[test]
    fn the_prefix_is_byte_identical_across_turns() {
        // E a condicao para o cache acertar: um prefixo que muda e um cache que
        // erra, e o custo volta inteiro sem que nada indique isso.
        let first = body_with(&Sampling::default());
        let second = body_with(&Sampling::default());
        assert_eq!(first["system"], second["system"]);
        assert_eq!(first["tools"], second["tools"]);
    }

    #[test]
    fn an_image_reaches_the_wire_in_the_shape_the_dialect_documents() {
        // FR-20. A forma errada e recusada pelo backend com uma mensagem que
        // nao diz qual bloco estava errado.
        let message = Message {
            role: crate::anthropic::Role::User,
            content: vec![
                ContentBlock::image("image/png", "QUJD"),
                ContentBlock::text("o que ha nesta captura?"),
            ],
        };
        let body = Messages.body(&UnifiedRequest {
            model: "m",
            max_tokens: 8,
            messages: &[message],
            system: None,
            tools: &[],
            sampling: &Sampling::default(),
        });

        let block = &body["messages"][0]["content"][0];
        assert_eq!(block["type"], "image");
        assert_eq!(block["source"]["type"], "base64");
        assert_eq!(block["source"]["media_type"], "image/png");
        assert_eq!(block["source"]["data"], "QUJD");
        // O anexo vem antes do texto: o texto se refere a imagem, e o modelo le
        // na ordem em que chega.
        assert_eq!(body["messages"][0]["content"][1]["type"], "text");
    }

    #[test]
    fn body_carries_the_conversation_and_declares_streaming() {
        let messages = vec![Message::user("oi")];
        let tools = vec![tool()];
        let body = Messages.body(&UnifiedRequest {
            model: "nylla-sonnet-4.5",
            max_tokens: 1024,
            messages: &messages,
            system: Some("prompt de sistema"),
            tools: &tools,
            sampling: &Sampling::default(),
        });

        assert_eq!(body["model"], "nylla-sonnet-4.5");
        assert_eq!(body["max_tokens"], 1024);
        assert_eq!(body["stream"], true);
        // Com cache o `system` vai como lista de blocos; o texto e o mesmo, e
        // e ele que este teste protege. A forma tem teste proprio.
        assert_eq!(body["system"][0]["text"], "prompt de sistema");
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["tools"][0]["name"], "read");
    }

    #[test]
    fn absent_system_and_tools_do_not_reach_the_wire() {
        // Mandar `system: null` ou `tools: []` muda o comportamento de alguns
        // backends e invalida cache de prompt sem ganho.
        let messages = vec![Message::user("oi")];
        let body = Messages.body(&UnifiedRequest {
            model: "m",
            max_tokens: 10,
            messages: &messages,
            system: None,
            tools: &[],
            sampling: &Sampling::default(),
        });
        assert!(body.get("system").is_none());
        assert!(body.get("tools").is_none());
    }

    #[test]
    fn tool_results_survive_the_round_trip_into_the_body() {
        let messages = vec![Message::tool_results(vec![ContentBlock::tool_error(
            "t1", "falhou",
        )])];
        let body = Messages.body(&UnifiedRequest {
            model: "m",
            max_tokens: 10,
            messages: &messages,
            system: None,
            tools: &[],
            sampling: &Sampling::default(),
        });
        assert_eq!(body["messages"][0]["content"][0]["tool_use_id"], "t1");
        assert_eq!(body["messages"][0]["content"][0]["is_error"], true);
    }

    #[test]
    fn authentication_uses_x_api_key_and_pins_the_api_version() {
        let headers = Messages.headers("segredo");
        assert!(headers.contains(&("x-api-key", "segredo".to_owned())));
        assert!(headers.contains(&("anthropic-version", API_VERSION.to_owned())));
    }

    #[test]
    fn the_decoder_is_the_anthropic_one_and_starts_incomplete() {
        let decoder = Messages.decoder();
        assert!(
            !decoder.completed(),
            "um decodificador novo nao pode nascer completo"
        );
    }

    #[test]
    fn error_envelopes_reach_the_caller_intact() {
        let err = Messages.parse_error(
            400,
            r#"{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long"}}"#,
        );
        assert_eq!(err.kind, "invalid_request_error");
        assert!(
            err.is_context_overflow(),
            "o gatilho de auto-compact precisa sobreviver"
        );
    }

    #[test]
    fn the_route_and_name_are_stable() {
        assert_eq!(Messages.route(), "messages");
        assert_eq!(Messages.name(), "anthropic-messages");
    }
}
