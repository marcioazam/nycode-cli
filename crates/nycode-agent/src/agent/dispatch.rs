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
                extension: tool.is_extension(),
            })
            .collect();
        // Estaveis primeiro, extensoes depois: uma ferramenta de servidor no
        // meio do prefixo deslocaria o ponto de corte do cache (NFR-7).
        specs.sort_by(|a, b| a.extension.cmp(&b.extension).then(a.name.cmp(&b.name)));
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
        let mut stops = Vec::with_capacity(calls.len());

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
            stops.push(output.terminate);
            results.extend(output.into_blocks(&call.id));
        }

        if end == RoundEnd::Complete && !stops.is_empty() && stops.iter().all(|stop| *stop) {
            end = RoundEnd::Stopped;
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
        let payload =
            crate::policy::hooks::Payload::for_call(&call.name, &call.input, self.ctx.root());

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

    /// Conta ao hook o que a ferramenta produziu.
    ///
    /// Não veta, e não tem como vetar: quando isto roda, o arquivo já foi
    /// escrito e o comando já rodou. Uma recusa que chegue aqui é registrada em
    /// voz alta e ignorada — obedecê-la seria inventar um veto retroativo, e
    /// calá-la deixaria quem escreveu o hook acreditando que ele protege
    /// alguma coisa ([ADR-0022](../../../../docs/architecture/decisions/0022-o-post-tool-use-recebe-a-saida-cortada-e-o-tamanho-dela.md)).
    ///
    /// Um hook que falha ou estoura o prazo também não muda o resultado. A
    /// assimetria com `pre-tool-use` é real e deliberada: lá a falha aberta
    /// deixa passar uma chamada que talvez devesse ser barrada, aqui não há o
    /// que deixar passar.
    async fn observed(&self, call: &ToolCall, output: &mut ToolOutput) {
        use crate::policy::hooks::{Event, Payload};

        // Sem hook não se monta o payload: ele carrega uma cópia da saída da
        // ferramenta, e pagá-la a cada chamada para descartar em seguida seria
        // cobrar de todo workspace o preço de um recurso que ele não usa.
        if !self.hooks.has(Event::PostToolUse) {
            return;
        }

        let payload = Payload::for_result(&call.name, &call.input, output, self.ctx.root());
        if let Some(response) = self.hooks.fire(Event::PostToolUse, &payload).await {
            if response.is_denial() {
                tracing::warn!(
                    tool = %call.name,
                    "post-tool-use respondeu `deny`; so `pre-tool-use` veta, e a ferramenta ja rodou"
                );
            }
            if response.terminate {
                output.stop();
            }
        }
    }

    pub(super) async fn execute(&self, call: &crate::tool::ToolCall) -> ToolOutput {
        // Um valor certo no tipo errado — `"limit": "10"` — fazia a ferramenta
        // cair no padrão sem dizer nada: o modelo pedia dez linhas, recebia
        // outra coisa, e nada no turno registrava a diferença.
        //
        // Antes do hook e do gate, e não depois: o que a política inspeciona e
        // o que o usuário aprova precisa ser exatamente o que roda. Coagir
        // depois trocaria o argumento sob uma decisão já tomada.
        //
        // Uma ferramenta desconhecida segue como veio — não há schema contra o
        // qual comparar, e o erro dela sai mais abaixo, depois de o hook ter
        // visto a tentativa como via antes.
        let coerced;
        let call = match self.tools.get(call.name.as_str()) {
            Some(tool) => {
                coerced = crate::tool::ToolCall {
                    input: crate::tool::coerce::coerce(call.input.clone(), &tool.input_schema()),
                    ..call.clone()
                };
                &coerced
            }
            None => call,
        };

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

        // O evento é `post-tool-use`, e só dispara depois de a ferramenta ter
        // rodado de fato. Um veto, uma recusa do gate ou um nome desconhecido
        // saem acima sem passar por aqui: anunciar uso de ferramenta onde não
        // houve uso faria um hook de auditoria registrar o que não aconteceu.
        let mut output = tool.execute(input, &self.ctx).await;
        self.observed(call, &mut output).await;
        output
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::tool::Tool;

    /// Uma ferramenta de mentira que declara de que lado do corte fica.
    #[derive(Debug)]
    struct Fake {
        name: &'static str,
        extension: bool,
    }

    #[async_trait::async_trait]
    #[allow(clippy::unnecessary_literal_bound)]
    impl Tool for Fake {
        fn name(&self) -> &str {
            self.name
        }
        fn description(&self) -> &str {
            "de mentira"
        }
        fn input_schema(&self) -> serde_json::Value {
            serde_json::json!({ "type": "object" })
        }
        fn is_extension(&self) -> bool {
            self.extension
        }
        async fn execute(
            &self,
            _input: serde_json::Value,
            _ctx: &crate::tool::ToolContext,
        ) -> crate::tool::ToolOutput {
            crate::tool::ToolOutput::ok(RESULTADO)
        }
    }

    /// O que a ferramenta de mentira devolve, para o hook ter o que ler.
    const RESULTADO: &str = "a ferramenta produziu isto";

    /// Ferramenta que declara tipo e devolve o que recebeu.
    ///
    /// A [`Fake`] não serve para a coerção: o schema dela não tem propriedade
    /// nenhuma, e sem tipo declarado não há o que coagir.
    struct Typed;

    #[async_trait::async_trait]
    #[allow(clippy::unnecessary_literal_bound)]
    impl Tool for Typed {
        fn name(&self) -> &str {
            "typed"
        }
        fn description(&self) -> &str {
            "declara tipo e devolve o que recebeu"
        }
        fn input_schema(&self) -> serde_json::Value {
            serde_json::json!({
                "type": "object",
                "properties": { "limit": { "type": "integer" } }
            })
        }
        async fn execute(
            &self,
            input: serde_json::Value,
            _ctx: &crate::tool::ToolContext,
        ) -> crate::tool::ToolOutput {
            crate::tool::ToolOutput::ok(input.to_string())
        }
    }

    fn agent_with(tools: &[(&'static str, bool)]) -> (tempfile::TempDir, crate::Agent) {
        let dir = tempfile::tempdir().expect("um diretorio temporario");
        let ctx = crate::ToolContext::new(dir.path()).expect("uma raiz valida");
        let backend: Arc<dyn crate::Backend> =
            Arc::new(crate::backend::fake::FakeBackend::new(Vec::new()));
        let mut agent = crate::Agent::new(backend, ctx);
        for (name, extension) in tools {
            agent = agent.with_tool(Arc::new(Fake {
                name,
                extension: *extension,
            }));
        }
        (dir, agent)
    }

    #[test]
    fn a_server_tool_never_lands_in_the_middle_of_the_native_ones() {
        // Ordenar tudo junto por nome punha `docs__search` entre `bash` e
        // `edit`, entao conectar um servidor deslocava o resto do array e o
        // ponto de corte do cache passava a cobrir outra coisa (NFR-7).
        let (_dir, agent) = agent_with(&[("edit", false), ("docs__search", true), ("bash", false)]);

        let nomes: Vec<_> = agent.specs().into_iter().map(|s| s.name).collect();
        assert_eq!(nomes, vec!["bash", "edit", "docs__search"]);
    }

    #[test]
    fn the_order_does_not_change_between_calls() {
        let (_dir, agent) = agent_with(&[("edit", false), ("docs__search", true), ("bash", false)]);
        assert_eq!(agent.specs(), agent.specs());
    }

    /// Instala um hook executável na raiz do agente.
    fn install(root: &std::path::Path, event: crate::policy::hooks::Event, body: &str) {
        let path = root.join(".nycode/hooks").join(event.filename());
        std::fs::create_dir_all(path.parent().expect("o diretorio de hooks")).expect("criar");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("escrever");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
                .expect("bit de execucao");
        }
    }

    fn call(name: &str) -> crate::tool::ToolCall {
        crate::tool::ToolCall {
            id: "t1".to_owned(),
            name: name.to_owned(),
            input: serde_json::json!({ "arg": 1 }),
        }
    }

    /// Um agente que permite tudo, com os hooks do diretório já descobertos.
    fn agent_with_hooks(dir: &tempfile::TempDir) -> crate::Agent {
        let ctx = crate::ToolContext::new(dir.path()).expect("uma raiz valida");
        let backend: Arc<dyn crate::Backend> =
            Arc::new(crate::backend::fake::FakeBackend::new(Vec::new()));
        crate::Agent::new(backend, ctx)
            .with_tool(Arc::new(Fake {
                name: "read",
                extension: false,
            }))
            .with_gate(Box::new(crate::policy::AllowAll))
            .with_hooks(crate::policy::Hooks::discover(dir.path()))
    }

    #[tokio::test]
    async fn a_value_in_the_wrong_type_reaches_the_tool_in_the_declared_one() {
        // Sem a coercao, `as_u64` devolvia `None` e a ferramenta caia no
        // padrao: o modelo pedia dez, recebia outra coisa, e nada dizia.
        let dir = tempfile::tempdir().expect("um diretorio temporario");
        let ctx = crate::ToolContext::new(dir.path()).expect("uma raiz valida");
        let backend: Arc<dyn crate::Backend> =
            Arc::new(crate::backend::fake::FakeBackend::new(Vec::new()));
        let agent = crate::Agent::new(backend, ctx)
            .with_tool(Arc::new(Typed))
            .with_gate(Box::new(crate::policy::AllowAll));

        let output = agent
            .execute(&crate::tool::ToolCall {
                id: "t1".to_owned(),
                name: "typed".to_owned(),
                input: serde_json::json!({ "limit": "10" }),
            })
            .await;

        assert_eq!(output.content, r#"{"limit":10}"#, "{}", output.content);
    }

    #[tokio::test]
    async fn the_policy_inspects_the_argument_that_will_actually_run() {
        // A ordem e de seguranca, nao de conveniencia: coagir depois do hook
        // faria a politica decidir sobre um argumento e a ferramenta rodar com
        // outro. O hook precisa ver `10`, nao `"10"`.
        let dir = tempfile::tempdir().expect("um diretorio temporario");
        install(
            dir.path(),
            crate::policy::hooks::Event::PreToolUse,
            "cat > visto.json",
        );
        let ctx = crate::ToolContext::new(dir.path()).expect("uma raiz valida");
        let backend: Arc<dyn crate::Backend> =
            Arc::new(crate::backend::fake::FakeBackend::new(Vec::new()));
        let agent = crate::Agent::new(backend, ctx)
            .with_tool(Arc::new(Typed))
            .with_gate(Box::new(crate::policy::AllowAll))
            .with_hooks(crate::policy::Hooks::discover(dir.path()));

        agent
            .execute(&crate::tool::ToolCall {
                id: "t1".to_owned(),
                name: "typed".to_owned(),
                input: serde_json::json!({ "limit": "10" }),
            })
            .await;

        let visto = std::fs::read_to_string(dir.path().join("visto.json")).expect("o hook rodou");
        let visto: serde_json::Value = serde_json::from_str(&visto).expect("contrato JSON");
        assert_eq!(visto["input"]["limit"], 10, "{visto}");
    }

    #[tokio::test]
    async fn a_post_tool_hook_sees_what_the_tool_produced() {
        // O evento so serve se carregar o resultado: um hook de auditoria que
        // recebesse so o nome registraria que `read` rodou e nada do que leu.
        let dir = tempfile::tempdir().expect("um diretorio temporario");
        install(
            dir.path(),
            crate::policy::hooks::Event::PostToolUse,
            "cat > visto.json",
        );
        let agent = agent_with_hooks(&dir);

        let output = agent.execute(&call("read")).await;

        let visto = std::fs::read_to_string(dir.path().join("visto.json")).expect("o hook rodou");
        let visto: serde_json::Value = serde_json::from_str(&visto).expect("contrato JSON");
        assert_eq!(visto["event"], "post-tool-use");
        assert_eq!(visto["tool"], "read");
        assert_eq!(visto["output"], RESULTADO);
        assert_eq!(visto["input"]["arg"], 1);
        assert_eq!(output.content, RESULTADO, "o resultado segue intacto");
    }

    #[tokio::test]
    async fn a_denial_after_the_fact_does_not_turn_a_good_result_into_an_error() {
        // O veto e de `pre-tool-use` e so dele. Obedecer uma recusa aqui seria
        // inventar veto retroativo sobre um arquivo que ja foi escrito.
        let dir = tempfile::tempdir().expect("um diretorio temporario");
        install(
            dir.path(),
            crate::policy::hooks::Event::PostToolUse,
            r#"echo '{"decision":"deny","reason":"tarde demais"}'"#,
        );
        let agent = agent_with_hooks(&dir);

        let output = agent.execute(&call("read")).await;

        assert!(!output.is_error, "{}", output.content);
        assert_eq!(output.content, RESULTADO);
    }

    #[tokio::test]
    async fn a_hook_that_hangs_after_the_fact_does_not_fail_a_tool_that_worked() {
        // O hook nao pode virar um caminho de falha da ferramenta: ela ja
        // rodou, e transformar o sucesso dela em erro faria o modelo desfazer
        // um trabalho que aconteceu.
        let dir = tempfile::tempdir().expect("um diretorio temporario");
        install(
            dir.path(),
            crate::policy::hooks::Event::PostToolUse,
            "sleep 60",
        );
        let mut agent = agent_with_hooks(&dir);
        agent = agent.with_hooks(
            crate::policy::Hooks::discover(dir.path())
                .with_timeout(std::time::Duration::from_millis(200)),
        );

        let output = agent.execute(&call("read")).await;

        assert!(!output.is_error, "{}", output.content);
        assert_eq!(output.content, RESULTADO);
    }

    #[tokio::test]
    async fn a_call_that_never_ran_produces_no_post_tool_event() {
        // Anunciar uso de ferramenta onde nao houve uso faria um hook de
        // auditoria registrar o que nao aconteceu — e faria o veto do
        // `pre-tool-use` parecer, no registro, uma execucao.
        let dir = tempfile::tempdir().expect("um diretorio temporario");
        install(
            dir.path(),
            crate::policy::hooks::Event::PreToolUse,
            r#"echo '{"decision":"deny","reason":"nao"}'"#,
        );
        install(
            dir.path(),
            crate::policy::hooks::Event::PostToolUse,
            "cat > visto.json",
        );
        let agent = agent_with_hooks(&dir);

        let vetada = agent.execute(&call("read")).await;
        let desconhecida = agent.execute(&call("nao-existe")).await;

        assert!(vetada.is_error);
        assert!(desconhecida.is_error);
        assert!(
            !dir.path().join("visto.json").exists(),
            "nenhuma das duas chegou a rodar ferramenta nenhuma"
        );
    }
}
