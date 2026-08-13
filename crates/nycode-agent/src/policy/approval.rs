//! Aprovação sob demanda de uma chamada de ferramenta.
//!
//! O gate ao lado decide sozinho quando a resposta é óbvia: ler sempre pode,
//! escrever nunca pode numa sessão somente-leitura. Isto cobre o caso do meio —
//! a sessão que quer perguntar em vez de decidir de antemão.
//!
//! Em modo headless não há a quem perguntar, e o padrão é negar. Aprovar por
//! omissão daria a um pipeline de CI a permissão que ninguém concedeu.

use async_trait::async_trait;

use crate::tool::ToolCall;

/// Quem responde quando o gate pergunta.
#[async_trait]
pub trait Approver: Send + Sync + std::fmt::Debug {
    /// Se esta chamada pode rodar.
    async fn approve(&self, call: &ToolCall) -> bool;
}

/// Nega tudo que chegar. É o padrão.
///
/// Vale para o modo headless, onde perguntar não é possível: a permissão
/// precisa ser dada de antemão, por flag, ou não é dada.
#[derive(Debug, Default, Clone, Copy)]
pub struct Never;

#[async_trait]
impl Approver for Never {
    async fn approve(&self, _call: &ToolCall) -> bool {
        false
    }
}

/// Aprova tudo. Existe para quem já decidiu antes de abrir a sessão.
#[derive(Debug, Default, Clone, Copy)]
pub struct Always;

#[async_trait]
impl Approver for Always {
    async fn approve(&self, _call: &ToolCall) -> bool {
        true
    }
}

/// Um pedido de aprovação esperando resposta.
#[derive(Debug)]
pub struct Request {
    pub call: ToolCall,
    answer: tokio::sync::oneshot::Sender<bool>,
}

impl Request {
    /// Responde ao pedido.
    ///
    /// Uma resposta perdida — porque a interface caiu, por exemplo — deixa o
    /// lado que pergunta com a resposta negativa, que é a segura.
    pub fn answer(self, approved: bool) {
        let _ = self.answer.send(approved);
    }
}

/// Aprovador que delega a decisão a quem estiver atendendo o canal.
///
/// Existe porque quem sabe perguntar é o laço de interface, e ele não pode ser
/// chamado de dentro do loop de agente: os dois correm ao mesmo tempo, e o laço
/// já está esperando eventos. O canal é o que os une sem inverter a posse.
#[derive(Debug)]
pub struct Asking {
    requests: tokio::sync::mpsc::Sender<Request>,
}

impl Asking {
    /// Cria o aprovador e a ponta que recebe os pedidos.
    #[must_use]
    pub fn channel() -> (Self, tokio::sync::mpsc::Receiver<Request>) {
        let (requests, inbox) = tokio::sync::mpsc::channel(1);
        (Self { requests }, inbox)
    }
}

#[async_trait]
impl Approver for Asking {
    async fn approve(&self, call: &ToolCall) -> bool {
        let (answer, response) = tokio::sync::oneshot::channel();
        let request = Request {
            call: call.clone(),
            answer,
        };

        // Ninguém atendendo é o mesmo que ninguém tendo aprovado. Bloquear
        // aqui penduraria o turno esperando uma resposta que não vem.
        if self.requests.send(request).await.is_err() {
            return false;
        }
        response.await.unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(name: &str) -> ToolCall {
        ToolCall {
            id: "t1".to_owned(),
            name: name.to_owned(),
            input: serde_json::Value::Null,
        }
    }

    #[tokio::test]
    async fn the_default_answer_is_no() {
        // Aprovar por omissao daria a um pipeline de CI a permissao que
        // ninguem concedeu.
        assert!(!Never.approve(&call("bash")).await);
    }

    #[tokio::test]
    async fn always_approves_for_whoever_already_decided() {
        assert!(Always.approve(&call("bash")).await);
    }

    #[tokio::test]
    async fn a_call_the_gate_asks_about_runs_only_if_approved() {
        // E o ponto da decisao `Ask`: nao decidir de antemao entre sessao
        // inutil e cheque em branco.
        use crate::agent::{Agent, Silent};
        use crate::backend::fake::FakeBackend;
        use crate::policy::Ask;

        let dir = tempfile::tempdir().unwrap();
        let ctx = crate::ToolContext::new(dir.path()).unwrap();
        let backend = std::sync::Arc::new(FakeBackend::new(vec![
            crate::agent_test::tool_turn(
                "t1",
                "write",
                r#"{"path":"criado.txt","content":"conteudo"}"#,
            ),
            crate::agent_test::text_turn("pronto"),
        ]));

        let mut agent = Agent::new(backend, ctx)
            .with_gate(Box::new(Ask))
            .with_approver(std::sync::Arc::new(Always));
        for tool in crate::tools::all() {
            agent = agent.with_tool(tool);
        }

        agent.run("crie o arquivo", &mut Silent).await.unwrap();
        assert!(dir.path().join("criado.txt").exists());
    }

    #[tokio::test]
    async fn a_refused_call_comes_back_as_a_correctable_result() {
        // Abortar o turno perderia o trabalho ja feito; o modelo precisa poder
        // propor outro caminho.
        use crate::agent::{Agent, Silent};
        use crate::backend::fake::FakeBackend;
        use crate::policy::Ask;

        let dir = tempfile::tempdir().unwrap();
        let ctx = crate::ToolContext::new(dir.path()).unwrap();
        let backend = std::sync::Arc::new(FakeBackend::new(vec![
            crate::agent_test::tool_turn(
                "t1",
                "write",
                r#"{"path":"criado.txt","content":"conteudo"}"#,
            ),
            crate::agent_test::text_turn("entendi, nao vou escrever"),
        ]));

        let mut agent = Agent::new(backend, ctx).with_gate(Box::new(Ask));
        for tool in crate::tools::all() {
            agent = agent.with_tool(tool);
        }

        let outcome = agent.run("crie o arquivo", &mut Silent).await.unwrap();

        assert!(!dir.path().join("criado.txt").exists());
        assert_eq!(outcome.text, "entendi, nao vou escrever");
        let told = format!("{:?}", agent.history());
        assert!(told.contains("aprovacao"), "o modelo precisa saber: {told}");
    }

    #[tokio::test]
    async fn a_request_reaches_whoever_is_listening_and_the_answer_comes_back() {
        let (approver, mut inbox) = Asking::channel();

        let attendant = tokio::spawn(async move {
            let request = inbox.recv().await.expect("um pedido");
            assert_eq!(request.call.name, "bash");
            request.answer(true);
        });

        assert!(approver.approve(&call("bash")).await);
        attendant.await.unwrap();
    }

    #[tokio::test]
    async fn a_refusal_comes_back_as_a_refusal() {
        let (approver, mut inbox) = Asking::channel();
        tokio::spawn(async move {
            inbox.recv().await.expect("um pedido").answer(false);
        });

        assert!(!approver.approve(&call("write")).await);
    }

    #[tokio::test]
    async fn nobody_listening_is_the_same_as_nobody_approving() {
        // Bloquear aqui penduraria o turno esperando uma resposta que nao vem.
        let (approver, inbox) = Asking::channel();
        drop(inbox);

        assert!(!approver.approve(&call("bash")).await);
    }

    #[tokio::test]
    async fn an_answer_that_never_comes_is_a_refusal() {
        // A interface pode cair no meio da pergunta; a resposta segura e nao.
        let (approver, mut inbox) = Asking::channel();
        tokio::spawn(async move {
            let request = inbox.recv().await.expect("um pedido");
            drop(request);
        });

        assert!(!approver.approve(&call("bash")).await);
    }
}
