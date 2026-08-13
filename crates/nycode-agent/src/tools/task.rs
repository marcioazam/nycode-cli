//! Ferramenta `task`: delega um trabalho a um agente filho (FR-15).
//!
//! Existe pela janela de contexto. Uma busca que lê trinta arquivos para achar
//! três linhas gasta a janela inteira do pai com o que ele não vai precisar de
//! novo; delegada, ela devolve as três linhas e o resto morre com o filho.
//!
//! Diverge da referência de propósito: o `pi` recusa subagentes e recomenda
//! `tmux`. A recusa dele é sobre agentes concorrentes de longa duração; isto é
//! outra coisa — uma chamada síncrona que devolve texto e acaba
//! ([ADR-0007](../../../../docs/architecture/decisions/0007-subagentes-sao-in-process-divergindo-da-referencia.md)).
//!
//! O filho não vê o histórico do pai. Herdá-lo desfaria a razão de existir da
//! ferramenta: o custo seria o mesmo e a janela do pai não sobraria.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{Value, json};

use crate::agent::{Agent, Silent};
use crate::backend::Backend;
use crate::policy::Gate;
use crate::tool::{Tool, ToolContext, ToolOutput};

/// Teto de rodadas de ferramenta de um filho.
///
/// Menor que o do pai: um filho que precisa de mais que isto está fazendo um
/// trabalho que deveria ser do pai, com a diferença de que o pai consegue pedir
/// ajuda ao usuário e o filho não.
const CHILD_TOOL_LIMIT: usize = 12;

/// Instrução do filho.
///
/// Diz explicitamente para responder com o resultado e não com o processo: o
/// pai recebe só o texto final, e uma narração do caminho gastaria a janela que
/// a delegação existe para poupar.
const CHILD_SYSTEM: &str = "Voce e um subagente do nycode, chamado para uma tarefa \
     delimitada. Trabalhe de forma autonoma: nao ha usuario para perguntar. \
     Responda com o resultado, nao com a narracao do que voce fez — quem chamou \
     recebe apenas o seu texto final e precisa que ele seja suficiente.";

/// Delega um trabalho a um agente filho.
pub struct Task {
    backend: Arc<dyn Backend>,
    /// Como o filho é permissionado. Herda do pai: um subagente que pudesse
    /// mais que quem o chamou seria uma escada de privilégio.
    gate: Arc<dyn Fn() -> Box<dyn Gate> + Send + Sync>,
}

impl std::fmt::Debug for Task {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Task").finish_non_exhaustive()
    }
}

impl Task {
    #[must_use]
    pub fn new(backend: Arc<dyn Backend>) -> Self {
        Self {
            backend,
            gate: Arc::new(|| Box::new(crate::policy::ReadOnly)),
        }
    }

    /// Define como o filho é permissionado.
    #[must_use]
    pub fn with_gate(mut self, gate: impl Fn() -> Box<dyn Gate> + Send + Sync + 'static) -> Self {
        self.gate = Arc::new(gate);
        self
    }

    /// Monta o filho.
    ///
    /// Sem a própria `task` no catálogo: a recursão é impedida pela construção,
    /// e não por um contador que dependeria de o modelo respeitá-lo.
    fn child(&self, ctx: &ToolContext) -> Agent {
        let mut agent = Agent::new(Arc::clone(&self.backend), ctx.clone())
            .with_system(CHILD_SYSTEM)
            .with_gate((self.gate)())
            .with_tool_limit(CHILD_TOOL_LIMIT);
        for tool in crate::tools::all() {
            agent = agent.with_tool(tool);
        }
        agent
    }
}

#[async_trait]
#[allow(clippy::unnecessary_literal_bound)]
impl Tool for Task {
    fn name(&self) -> &str {
        "task"
    }

    fn description(&self) -> &str {
        "Delega uma tarefa delimitada a um subagente com contexto proprio. Use \
         para trabalho exploratorio cujo caminho voce nao precisa guardar — \
         localizar onde algo esta implementado, resumir um diretorio grande. O \
         subagente nao ve esta conversa, entao a descricao precisa bastar por si; \
         ele devolve so o texto final."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "description": {
                    "type": "string",
                    "description": "A tarefa, completa e autocontida"
                }
            },
            "required": ["description"]
        })
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolOutput {
        let Some(description) = input.get("description").and_then(Value::as_str) else {
            return ToolOutput::error("argumento obrigatorio ausente: `description`");
        };
        if description.trim().is_empty() {
            return ToolOutput::error("`description` vazia nao e uma tarefa");
        }

        let mut child = self.child(ctx);
        match child.run(description, &mut Silent).await {
            // Resposta vazia é um resultado inútil disfarçado de sucesso; o pai
            // precisa saber para tentar outra coisa.
            Ok(outcome) if outcome.text.trim().is_empty() => {
                ToolOutput::error("o subagente terminou sem produzir resposta")
            }
            Ok(outcome) => ToolOutput::ok(outcome.text),
            Err(err) => ToolOutput::error(format!("o subagente falhou: {err}")),
        }
    }
}

#[cfg(test)]
#[path = "task_test.rs"]
mod task_test;
