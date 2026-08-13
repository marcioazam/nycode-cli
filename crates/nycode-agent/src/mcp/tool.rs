//! Ponte entre uma ferramenta MCP e o catálogo do agente.

use async_trait::async_trait;
use serde_json::Value;

use crate::tool::{Tool, ToolContext, ToolOutput};

/// Separador entre o nome do servidor e o da ferramenta.
///
/// Dois servidores podem expor uma ferramenta `search`. Sem qualificação, o
/// segundo sobrescreve o primeiro no catálogo e o modelo chama o errado sem que
/// nada indique o problema.
const SEPARATOR: &str = "__";

/// Nome qualificado de uma ferramenta de servidor.
#[must_use]
pub fn qualify(server: &str, tool: &str) -> String {
    format!("{server}{SEPARATOR}{tool}")
}

/// Invocação de ferramenta num servidor MCP.
///
/// Abstrai o transporte para que a ponte seja testável sem subir um servidor —
/// e para que trocar a implementação de transporte não toque nesta camada.
#[async_trait]
pub trait Transport: Send + Sync + std::fmt::Debug {
    async fn call(&self, tool: &str, arguments: Value) -> Result<String, String>;
}

/// Uma ferramenta exposta por um servidor MCP.
#[derive(Debug)]
pub struct McpTool {
    qualified_name: String,
    description: String,
    schema: Value,
    remote_name: String,
    transport: std::sync::Arc<dyn Transport>,
}

impl McpTool {
    pub fn new(
        server: &str,
        remote_name: impl Into<String>,
        description: impl Into<String>,
        schema: Value,
        transport: std::sync::Arc<dyn Transport>,
    ) -> Self {
        let remote_name = remote_name.into();
        Self {
            qualified_name: qualify(server, &remote_name),
            description: description.into(),
            schema,
            remote_name,
            transport,
        }
    }
}

#[async_trait]
impl Tool for McpTool {
    fn name(&self) -> &str {
        &self.qualified_name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn input_schema(&self) -> Value {
        self.schema.clone()
    }

    async fn execute(&self, input: Value, _ctx: &ToolContext) -> ToolOutput {
        // O servidor roda fora do processo e nao conhece a raiz do workspace,
        // entao o contexto local nao se aplica: o isolamento aqui e o do
        // sistema operacional, nao o do `ToolContext`.
        match self.transport.call(&self.remote_name, input).await {
            Ok(content) => ToolOutput::ok(content),
            Err(reason) => ToolOutput::error(format!("{}: {reason}", self.qualified_name)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    #[derive(Debug, Default)]
    struct FakeTransport {
        calls: Mutex<Vec<(String, Value)>>,
        response: Mutex<Option<Result<String, String>>>,
    }

    impl FakeTransport {
        fn responding(result: Result<String, String>) -> Arc<Self> {
            Arc::new(Self {
                calls: Mutex::new(Vec::new()),
                response: Mutex::new(Some(result)),
            })
        }
    }

    #[async_trait]
    impl Transport for FakeTransport {
        async fn call(&self, tool: &str, arguments: Value) -> Result<String, String> {
            self.calls
                .lock()
                .unwrap()
                .push((tool.to_owned(), arguments));
            self.response
                .lock()
                .unwrap()
                .clone()
                .unwrap_or_else(|| Ok(String::new()))
        }
    }

    fn ctx() -> (tempfile::TempDir, ToolContext) {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();
        (dir, ctx)
    }

    fn tool(transport: Arc<FakeTransport>) -> McpTool {
        McpTool::new(
            "docs",
            "search",
            "Busca na documentacao",
            json!({"type":"object"}),
            transport,
        )
    }

    #[test]
    fn names_are_qualified_by_server() {
        // Dois servidores com uma ferramenta `search` colidiriam no catalogo e o
        // modelo chamaria a errada sem nenhum sinal.
        assert_eq!(qualify("docs", "search"), "docs__search");
        assert_ne!(qualify("docs", "search"), qualify("web", "search"));
    }

    #[tokio::test]
    async fn a_successful_call_forwards_the_unqualified_name() {
        // O servidor conhece `search`, nao `docs__search`; mandar o nome
        // qualificado produziria "ferramenta desconhecida" do outro lado.
        let transport = FakeTransport::responding(Ok("resultado".to_owned()));
        let (_dir, ctx) = ctx();

        let out = tool(transport.clone())
            .execute(json!({ "q": "rust" }), &ctx)
            .await;

        assert!(!out.is_error);
        assert_eq!(out.content, "resultado");
        let calls = transport.calls.lock().unwrap();
        assert_eq!(calls[0].0, "search");
        assert_eq!(calls[0].1["q"], "rust");
    }

    #[tokio::test]
    async fn a_server_failure_is_marked_and_names_the_tool() {
        // Sem o nome, um erro de um servidor entre varios e indepuravel.
        let transport = FakeTransport::responding(Err("conexao recusada".to_owned()));
        let (_dir, ctx) = ctx();

        let out = tool(transport).execute(json!({}), &ctx).await;

        assert!(out.is_error);
        assert!(out.content.contains("docs__search"));
        assert!(out.content.contains("conexao recusada"));
    }

    #[test]
    fn the_declared_schema_is_forwarded_verbatim() {
        // Reescrever o schema do servidor faria o modelo emitir argumentos que o
        // servidor recusa.
        let schema = json!({
            "type": "object",
            "properties": { "q": { "type": "string" } },
            "required": ["q"]
        });
        let mcp = McpTool::new(
            "docs",
            "search",
            "d",
            schema.clone(),
            FakeTransport::responding(Ok(String::new())),
        );

        assert_eq!(mcp.input_schema(), schema);
        assert_eq!(mcp.name(), "docs__search");
        assert_eq!(mcp.description(), "d");
    }
}
