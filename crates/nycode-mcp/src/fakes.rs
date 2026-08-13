//! Servidor MCP em processo, para os testes.
//!
//! Um par de canais em memória fala o protocolo tão bem quanto um processo
//! filho, e sem depender de ter um servidor instalado na máquina. É o que
//! permite exercitar handshake, listagem e chamada de ferramenta de verdade em
//! vez de confiar que o SDK faz o que promete.

#![allow(clippy::unwrap_used, clippy::panic)]

use std::borrow::Cow;
use std::sync::Arc;

use rmcp::ServiceExt;
use rmcp::handler::server::ServerHandler;
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, ListToolsResult,
    PaginatedRequestParams, Tool,
};
use rmcp::service::RequestContext;
use rmcp::{ErrorData as McpError, RoleServer};
use serde_json::json;

/// O que o servidor de teste responde.
#[derive(Debug, Clone)]
pub struct Fixture {
    /// Como responder a `tools/call`.
    pub reply: Reply,
}

/// Resposta programada para uma chamada de ferramenta.
#[derive(Debug, Clone)]
pub enum Reply {
    /// Texto, marcado como sucesso.
    Text(String),
    /// Texto, marcado como erro pelo próprio servidor.
    Failure(String),
    /// Sem bloco de texto, só conteúdo estruturado.
    Structured(serde_json::Value),
    /// Resultado completamente vazio.
    Empty,
    /// Nunca responde. O servidor que aceita a chamada e trava.
    Hang,
}

impl ServerHandler for Fixture {
    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        let schema = json!({
            "type": "object",
            "properties": { "q": { "type": "string" } },
            "required": ["q"]
        });
        let object = schema.as_object().unwrap().clone();

        let mut described = Tool::new(
            Cow::Borrowed("search"),
            Cow::Borrowed("Busca na documentacao"),
            Arc::new(object.clone()),
        );
        described.description = Some(Cow::Borrowed("Busca na documentacao"));

        // A segunda existe sem descricao, que e o caso em que o servidor a
        // omite e o catalogo do agente nao pode acabar com `None` renderizado.
        let mut bare = Tool::new(Cow::Borrowed("ping"), Cow::Borrowed(""), Arc::new(object));
        bare.description = None;

        Ok(ListToolsResult {
            tools: vec![described, bare],
            ..ListToolsResult::default()
        })
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        if request.name == "explode" {
            return Err(McpError::internal_error("o servidor recusou", None));
        }

        let result = match &self.reply {
            Reply::Text(text) => CallToolResult::success(vec![ContentBlock::text(text.clone())]),
            Reply::Failure(text) => CallToolResult::error(vec![ContentBlock::text(text.clone())]),
            Reply::Structured(value) => {
                let mut result = CallToolResult::success(vec![]);
                result.structured_content = Some(value.clone());
                result
            }
            Reply::Empty => CallToolResult::success(vec![]),
            Reply::Hang => std::future::pending().await,
        };
        Ok(result.into())
    }
}

/// Sobe o servidor e devolve as metades do cliente, prontas para o transporte.
///
/// A tarefa do servidor é solta: ela termina quando o cliente fecha, e um teste
/// que a aguardasse ficaria pendurado.
pub fn channel(
    fixture: Fixture,
) -> (
    tokio::io::ReadHalf<tokio::io::DuplexStream>,
    tokio::io::WriteHalf<tokio::io::DuplexStream>,
) {
    let (client, server) = tokio::io::duplex(64 * 1024);
    let (server_read, server_write) = tokio::io::split(server);

    tokio::spawn(async move {
        if let Ok(running) = fixture.serve((server_read, server_write)).await {
            let _ = running.waiting().await;
        }
    });

    tokio::io::split(client)
}

/// A ponta do servidor de um canal mudo, segurada para ele não fechar.
///
/// Largá-la fecharia o stream, e o handshake falharia na hora em vez de ficar
/// esperando — que é justamente o cenário a exercitar.
#[derive(Debug)]
pub struct Mute(#[allow(dead_code)] tokio::io::DuplexStream);

/// Um canal cujo outro lado aceita a conexão e nunca responde.
pub fn mute() -> (
    Mute,
    (
        tokio::io::ReadHalf<tokio::io::DuplexStream>,
        tokio::io::WriteHalf<tokio::io::DuplexStream>,
    ),
) {
    let (client, server) = tokio::io::duplex(64 * 1024);
    (Mute(server), tokio::io::split(client))
}
