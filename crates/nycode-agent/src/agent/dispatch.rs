//! Da chamada que o modelo pediu ao resultado que volta para ele.
//!
//! Separado do laço porque muda por outros motivos: o laço muda quando a forma
//! de um turno muda, isto muda quando as camadas de decisão mudam. São três,
//! nesta ordem: o hook do repositório, o gate da sessão, e o aprovador. A
//! ordem importa — uma política que só roda depois de o gate aprovar não
//! consegue proibir nada que o gate permita.

use nycode_ai::anthropic::{ContentBlock, Message, ToolSpec};

use super::{Agent, CANCELLED_BY_USER, Observer, RoundEnd};
use crate::policy::permission::Decision;
use crate::tool::{ToolCall, ToolOutput};

impl Agent {
    pub(super) fn specs(&self) -> Vec<ToolSpec> {
        let mut specs: Vec<_> = self
            .tools
            .values()
            .map(|tool| ToolSpec {
                name: tool.name().to_owned(),
                description: tool.description().to_owned(),
                input_schema: tool.input_schema(),
            })
            .collect();
        // Ordem estavel: um catalogo que muda de ordem entre execucoes invalida
        // o cache de prompt do backend sem nenhum ganho.
        specs.sort_by(|a, b| a.name.cmp(&b.name));
        specs
    }

    /// Executa uma rodada de ferramentas, parando no cancelamento.
    ///
    /// Grava sempre um `tool_result` por chamada, inclusive para as que não
    /// chegaram a rodar.
    pub(super) async fn run_tool_round(
        &mut self,
        calls: &[ToolCall],
        observer: &mut impl Observer,
    ) -> RoundEnd {
        let mut results = Vec::with_capacity(calls.len());
        let mut end = RoundEnd::Complete;

        for call in calls {
            if end == RoundEnd::Cancelled {
                results.push(ContentBlock::tool_error(call.id.clone(), CANCELLED_BY_USER));
                continue;
            }

            observer.on_tool_start(&call.name, &call.input);
            let output = tokio::select! {
                // `biased` torna a escolha determinística: com o sinal já
                // disparado, a ferramenta não começa.
                biased;
                () = self.cancel.cancelled() => {
                    end = RoundEnd::Cancelled;
                    ToolOutput::error(CANCELLED_BY_USER)
                }
                output = self.execute(call) => output,
            };
            observer.on_tool_end(&call.name, &output);

            results.push(if output.is_error {
                ContentBlock::tool_error(call.id.clone(), output.content)
            } else {
                ContentBlock::tool_result(call.id.clone(), output.content)
            });
        }

        self.record(Message::tool_results(results));
        end
    }

    /// Responde a cada chamada pendente com um resultado de cancelamento.
    pub(super) fn close_pending_calls(&mut self, calls: &[ToolCall]) {
        if calls.is_empty() {
            return;
        }
        let results = calls
            .iter()
            .map(|call| ContentBlock::tool_error(call.id.clone(), CANCELLED_BY_USER))
            .collect();
        self.record(Message::tool_results(results));
    }

    /// Instala os hooks descobertos no workspace.
    #[must_use]
    pub fn with_hooks(mut self, hooks: crate::policy::Hooks) -> Self {
        self.hooks = hooks;
        self
    }

    /// A razão pela qual um hook vetou a chamada, se vetou.
    async fn vetoed(&self, call: &ToolCall) -> Option<String> {
        let payload = crate::policy::hooks::Payload {
            event: crate::policy::hooks::Event::PreToolUse,
            tool: Some(call.name.clone()),
            input: Some(call.input.clone()),
            output: None,
            cwd: self.ctx.root().display().to_string(),
        };

        let response = self
            .hooks
            .fire(crate::policy::hooks::Event::PreToolUse, &payload)
            .await?;
        if !response.is_denial() {
            return None;
        }

        // A razão chega ao modelo como resultado corrigível. Sem ela, ele só
        // saberia que falhou e tentaria de novo do mesmo jeito.
        Some(
            response.reason.unwrap_or_else(|| {
                format!("`{}` foi vetada por um hook do repositorio", call.name)
            }),
        )
    }

    pub(super) async fn execute(&self, call: &crate::tool::ToolCall) -> ToolOutput {
        // O hook vem antes do gate: ele é política do repositório, e uma
        // política que só roda depois de o gate aprovar não consegue proibir
        // nada que o gate permita.
        if let Some(reason) = self.vetoed(call).await {
            return ToolOutput::error(reason);
        }

        match self.gate.check(call) {
            Decision::Allow => {}
            Decision::Deny(reason) => return ToolOutput::error(reason),
            Decision::Ask if self.approver.approve(call).await => {}
            Decision::Ask => {
                // A recusa volta ao modelo como resultado corrigível, e não
                // como aborto: ele pode propor outro caminho em vez de o turno
                // inteiro se perder.
                return ToolOutput::error(format!(
                    "`{}` precisa de aprovacao e o usuario negou",
                    call.name
                ));
            }
        }
        let (name, input) = (call.name.as_str(), call.input.clone());
        let Some(tool) = self.tools.get(name) else {
            // Devolver como resultado de erro em vez de abortar deixa o modelo
            // se corrigir; abortar desperdicaria o turno inteiro.
            return ToolOutput::error(format!(
                "ferramenta desconhecida `{name}`; disponiveis: {}",
                self.specs()
                    .iter()
                    .map(|s| s.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        };

        if input.is_null() {
            return ToolOutput::error(format!(
                "argumentos de `{name}` nao formam JSON valido; reemita a chamada"
            ));
        }

        tool.execute(input, &self.ctx).await
    }
}
