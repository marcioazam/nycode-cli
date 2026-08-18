//! Pin apresentado ao modelo versus o que a ferramenta declara agora (AGT-03).

use nycode_ai::anthropic::ToolSpec;

use crate::tool::ToolOutput;

use super::Agent;

impl Agent {
    pub(super) fn remember_presented(&self, specs: &[ToolSpec]) {
        if let Ok(mut pins) = self.presented_pins.lock() {
            for spec in specs {
                pins.entry(spec.name.clone()).or_insert_with(|| {
                    crate::tool::pin::of(&spec.name, &spec.description, &spec.input_schema)
                });
            }
        }
    }

    pub(super) fn pin_denied(&self, tool: &dyn crate::tool::Tool) -> Option<ToolOutput> {
        let name = tool.name();
        let live = crate::tool::pin::of(name, tool.description(), &tool.input_schema());
        match self.presented_pins.lock() {
            Ok(mut pins) => match pins.get(name) {
                Some(presented) if presented != &live => Some(ToolOutput::error(format!(
                    "schema de `{name}` divergiu do pin apresentado ao modelo"
                ))),
                None => {
                    pins.insert(name.to_owned(), live);
                    None
                }
                Some(_) => None,
            },
            Err(_) => Some(ToolOutput::error(format!(
                "pin de `{name}` indisponivel; recusando a chamada"
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::tool::{Tool, ToolCall};

    struct MutableSchema {
        schema: std::sync::Mutex<serde_json::Value>,
    }

    #[async_trait::async_trait]
    #[allow(clippy::unnecessary_literal_bound)]
    impl Tool for MutableSchema {
        fn name(&self) -> &str {
            "mut"
        }
        fn description(&self) -> &str {
            "schema mutavel"
        }
        fn input_schema(&self) -> serde_json::Value {
            self.schema.lock().expect("schema").clone()
        }
        async fn execute(
            &self,
            _input: serde_json::Value,
            _ctx: &crate::tool::ToolContext,
        ) -> crate::tool::ToolOutput {
            crate::tool::ToolOutput::ok("ok")
        }
    }

    struct Stable;

    #[async_trait::async_trait]
    #[allow(clippy::unnecessary_literal_bound)]
    impl Tool for Stable {
        fn name(&self) -> &str {
            "read"
        }
        fn description(&self) -> &str {
            "de mentira"
        }
        fn input_schema(&self) -> serde_json::Value {
            serde_json::json!({ "type": "object" })
        }
        async fn execute(
            &self,
            _input: serde_json::Value,
            _ctx: &crate::tool::ToolContext,
        ) -> crate::tool::ToolOutput {
            crate::tool::ToolOutput::ok("ok")
        }
    }

    fn call(name: &str) -> ToolCall {
        ToolCall {
            id: "t1".to_owned(),
            name: name.to_owned(),
            input: serde_json::json!({ "arg": 1 }),
        }
    }

    #[tokio::test]
    async fn execute_refuses_when_the_live_schema_diverges_from_the_presented_pin() {
        let dir = tempfile::tempdir().expect("um diretorio temporario");
        let ctx = crate::ToolContext::new(dir.path()).expect("uma raiz valida");
        let backend: Arc<dyn crate::Backend> =
            Arc::new(crate::backend::fake::FakeBackend::new(Vec::new()));
        let tool = Arc::new(MutableSchema {
            schema: std::sync::Mutex::new(serde_json::json!({ "type": "object" })),
        });
        let agent = crate::Agent::new(backend, ctx)
            .with_tool(tool.clone())
            .with_gate(Box::new(crate::policy::AllowAll));
        let _ = agent.specs();
        *tool.schema.lock().expect("schema") =
            serde_json::json!({ "type": "object", "properties": { "x": { "type": "string" } } });

        let output = agent.execute(&call("mut")).await;

        assert!(output.is_error, "{}", output.content);
        assert!(output.content.contains("divergiu"), "{}", output.content);
    }

    #[tokio::test]
    async fn execute_without_specs_stores_the_first_seen_pin() {
        let dir = tempfile::tempdir().expect("um diretorio temporario");
        let ctx = crate::ToolContext::new(dir.path()).expect("uma raiz valida");
        let backend: Arc<dyn crate::Backend> =
            Arc::new(crate::backend::fake::FakeBackend::new(Vec::new()));
        let agent = crate::Agent::new(backend, ctx)
            .with_tool(Arc::new(Stable))
            .with_gate(Box::new(crate::policy::AllowAll));

        let output = agent.execute(&call("read")).await;
        assert!(!output.is_error, "{}", output.content);
    }
}
