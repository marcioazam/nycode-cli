//! Formas de mensagem e de requisição do dialeto Anthropic Messages.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Papel de uma mensagem na conversa.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
}

/// Um bloco de conteúdo dentro de uma mensagem.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
        #[serde(skip_serializing_if = "std::ops::Not::not", default)]
        is_error: bool,
    },
    /// Imagem anexada pelo usuário (FR-20).
    Image {
        source: ImageSource,
    },
}

/// De onde vem uma imagem.
///
/// Só base64 embutido: uma URL faria o gateway buscar o arquivo, o que muda
/// quem alcança a rede e o que o operador consegue auditar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ImageSource {
    Base64 { media_type: String, data: String },
}

impl ContentBlock {
    #[must_use]
    pub fn text(text: impl Into<String>) -> Self {
        Self::Text { text: text.into() }
    }

    /// Imagem em base64.
    #[must_use]
    pub fn image(media_type: impl Into<String>, data: impl Into<String>) -> Self {
        Self::Image {
            source: ImageSource::Base64 {
                media_type: media_type.into(),
                data: data.into(),
            },
        }
    }

    /// Resultado de ferramenta bem-sucedido.
    #[must_use]
    pub fn tool_result(tool_use_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self::ToolResult {
            tool_use_id: tool_use_id.into(),
            content: content.into(),
            is_error: false,
        }
    }

    /// Falha de ferramenta.
    ///
    /// Marcar `is_error` em vez de mandar a mensagem de erro como texto normal é
    /// o que permite ao modelo reagir à falha em vez de tratá-la como dado.
    #[must_use]
    pub fn tool_error(tool_use_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self::ToolResult {
            tool_use_id: tool_use_id.into(),
            content: content.into(),
            is_error: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: Vec<ContentBlock>,
}

impl Message {
    #[must_use]
    pub fn user(text: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: vec![ContentBlock::text(text)],
        }
    }

    #[must_use]
    pub fn assistant(content: Vec<ContentBlock>) -> Self {
        Self {
            role: Role::Assistant,
            content,
        }
    }

    /// Mensagem de usuário carregando apenas resultados de ferramenta.
    #[must_use]
    pub fn tool_results(results: Vec<ContentBlock>) -> Self {
        Self {
            role: Role::User,
            content: results,
        }
    }
}

/// Declaração de uma ferramenta disponível ao modelo.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// Corpo de `POST /v1/messages`.
#[derive(Debug, Clone, Serialize)]
pub struct Request {
    pub model: String,
    pub max_tokens: u32,
    pub messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<ToolSpec>,
    pub stream: bool,
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn tool_result_error_flag_is_serialized_only_when_true() {
        let ok = serde_json::to_value(ContentBlock::tool_result("t1", "conteudo")).unwrap();
        assert!(
            ok.get("is_error").is_none(),
            "is_error=false nao deve ir no wire"
        );

        let failed = serde_json::to_value(ContentBlock::tool_error("t1", "falhou")).unwrap();
        assert_eq!(failed.get("is_error").and_then(Value::as_bool), Some(true));
    }

    #[test]
    fn request_omits_empty_optional_fields() {
        let req = Request {
            model: "nylla-sonnet-4.5".to_owned(),
            max_tokens: 1024,
            messages: vec![Message::user("oi")],
            system: None,
            tools: Vec::new(),
            stream: true,
        };
        let value = serde_json::to_value(&req).unwrap();
        assert!(
            value.get("system").is_none(),
            "system=None nao deve ir no wire"
        );
        assert!(
            value.get("tools").is_none(),
            "tools vazio nao deve ir no wire"
        );
        assert_eq!(value["stream"], Value::Bool(true));
        assert_eq!(value["messages"][0]["role"], "user");
    }

    #[test]
    fn content_blocks_round_trip_through_the_wire_shape() {
        let blocks = vec![
            ContentBlock::text("oi"),
            ContentBlock::ToolUse {
                id: "t1".to_owned(),
                name: "read".to_owned(),
                input: serde_json::json!({ "path": "a.rs" }),
            },
            ContentBlock::tool_error("t1", "arquivo ausente"),
        ];
        let encoded = serde_json::to_string(&blocks).unwrap();
        let decoded: Vec<ContentBlock> = serde_json::from_str(&encoded).unwrap();
        assert_eq!(blocks, decoded);
    }

    #[test]
    fn tool_results_message_is_addressed_to_the_model_as_user_content() {
        // O protocolo exige que resultados de ferramenta voltem no papel `user`.
        // Emiti-los como `assistant` faz o backend rejeitar o turno.
        let msg = Message::tool_results(vec![ContentBlock::tool_result("t1", "ok")]);
        assert_eq!(msg.role, Role::User);
        assert_eq!(serde_json::to_value(&msg).unwrap()["role"], "user");
    }
}
