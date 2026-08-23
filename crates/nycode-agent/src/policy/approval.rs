//! Aprovação sob demanda de uma chamada de ferramenta.
//!
//! O gate ao lado decide sozinho quando a resposta é óbvia: ler sempre pode,
//! escrever nunca pode numa sessão somente-leitura. Isto cobre o caso do meio —
//! a sessão que quer perguntar em vez de decidir de antemão.
//!
//! Em modo headless não há a quem perguntar, e o padrão é negar. Aprovar por
//! omissão daria a um pipeline de CI a permissão que ninguém concedeu.

use async_trait::async_trait;
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime};

use crate::tool::ToolCall;

/// Quem responde quando o gate pergunta.
#[async_trait]
pub trait Approver: Send + Sync + std::fmt::Debug {
    /// Se esta chamada pode rodar.
    async fn approve(&self, call: &ToolCall) -> Decision;
}

/// Resultado de uma decisão de aprovação.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decision {
    pub approved: bool,
    pub receipt: Option<Receipt>,
}

impl Decision {
    #[must_use]
    pub const fn denied() -> Self {
        Self {
            approved: false,
            receipt: None,
        }
    }

    #[must_use]
    pub fn approved(call: &ToolCall, actor: &str) -> Self {
        Self {
            approved: true,
            receipt: Some(Receipt::new(call, actor)),
        }
    }

    #[must_use]
    pub fn authorizes(&self, call: &ToolCall) -> bool {
        self.approved
            && self
                .receipt
                .as_ref()
                .is_some_and(|receipt| receipt.matches(call) && receipt.not_expired())
    }
}

/// Recibo de uma decisão, amarrado à chamada exata e com validade curta.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Receipt {
    pub actor: String,
    pub call_id: String,
    pub tool: String,
    pub input_digest: String,
    pub expires_at: SystemTime,
}

impl Receipt {
    fn new(call: &ToolCall, actor: &str) -> Self {
        Self {
            actor: actor.to_owned(),
            call_id: call.id.clone(),
            tool: call.name.clone(),
            input_digest: digest(call),
            expires_at: SystemTime::now() + Duration::from_mins(5),
        }
    }

    fn matches(&self, call: &ToolCall) -> bool {
        self.call_id == call.id && self.tool == call.name && self.input_digest == digest(call)
    }

    fn not_expired(&self) -> bool {
        SystemTime::now() < self.expires_at
    }
}

fn digest(call: &ToolCall) -> String {
    let mut hasher = Sha256::new();
    hasher.update(call.id.as_bytes());
    hasher.update([0]);
    hasher.update(call.name.as_bytes());
    hasher.update([0]);
    hasher.update(call.input.to_string().as_bytes());
    hex::encode(hasher.finalize())
}

/// Nega tudo que chegar. É o padrão.
///
/// Vale para o modo headless, onde perguntar não é possível: a permissão
/// precisa ser dada de antemão, por flag, ou não é dada.
#[derive(Debug, Default, Clone, Copy)]
pub struct Never;

#[async_trait]
impl Approver for Never {
    async fn approve(&self, _call: &ToolCall) -> Decision {
        Decision::denied()
    }
}

/// Aprova tudo. Existe para quem já decidiu antes de abrir a sessão.
#[derive(Debug, Default, Clone, Copy)]
pub struct Always;

#[async_trait]
impl Approver for Always {
    async fn approve(&self, call: &ToolCall) -> Decision {
        Decision::approved(call, "pre-authorized")
    }
}

/// Um pedido de aprovação esperando resposta.
#[derive(Debug)]
pub struct Request {
    pub call: ToolCall,
    answer: tokio::sync::oneshot::Sender<Decision>,
}

impl Request {
    /// Responde ao pedido.
    ///
    /// Uma resposta perdida — porque a interface caiu, por exemplo — deixa o
    /// lado que pergunta com a resposta negativa, que é a segura.
    pub fn answer(self, approved: bool) {
        self.answer_as("interactive-user", approved);
    }

    /// Responde nomeando o ator que tomou a decisão.
    pub fn answer_as(self, actor: &str, approved: bool) {
        let decision = if approved {
            Decision::approved(&self.call, actor)
        } else {
            Decision::denied()
        };
        let _ = self.answer.send(decision);
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
    async fn approve(&self, call: &ToolCall) -> Decision {
        let (answer, response) = tokio::sync::oneshot::channel();
        let request = Request {
            call: call.clone(),
            answer,
        };

        // Ninguém atendendo é o mesmo que ninguém tendo aprovado. Bloquear
        // aqui penduraria o turno esperando uma resposta que não vem.
        if self.requests.send(request).await.is_err() {
            return Decision::denied();
        }
        response.await.unwrap_or_else(|_| Decision::denied())
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
        assert!(!Never.approve(&call("bash")).await.authorizes(&call("bash")));
    }

    #[tokio::test]
    async fn always_approves_for_whoever_already_decided() {
        let call = call("bash");
        assert!(Always.approve(&call).await.authorizes(&call));
    }

    #[tokio::test]
    async fn an_approval_receipt_does_not_authorize_another_call() {
        let original = call("bash");
        let mut changed = original.clone();
        changed.input = serde_json::json!({"command": "rm -rf /"});

        let decision = Always.approve(&original).await;

        assert!(!decision.authorizes(&changed));
    }

    #[test]
    fn an_expired_receipt_is_refused() {
        let call = call("bash");
        let receipt = Receipt {
            actor: "tester".to_owned(),
            call_id: call.id.clone(),
            tool: call.name.clone(),
            input_digest: digest(&call),
            expires_at: SystemTime::UNIX_EPOCH,
        };

        assert!(
            !Decision {
                approved: true,
                receipt: Some(receipt),
            }
            .authorizes(&call)
        );
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

        let call = call("bash");
        assert!(approver.approve(&call).await.authorizes(&call));
        attendant.await.unwrap();
    }

    #[tokio::test]
    async fn a_refusal_comes_back_as_a_refusal() {
        let (approver, mut inbox) = Asking::channel();
        tokio::spawn(async move {
            inbox.recv().await.expect("um pedido").answer(false);
        });

        let call = call("write");
        assert!(!approver.approve(&call).await.authorizes(&call));
    }

    #[tokio::test]
    async fn nobody_listening_is_the_same_as_nobody_approving() {
        // Bloquear aqui penduraria o turno esperando uma resposta que nao vem.
        let (approver, inbox) = Asking::channel();
        drop(inbox);

        let call = call("bash");
        assert!(!approver.approve(&call).await.authorizes(&call));
    }

    #[tokio::test]
    async fn an_answer_that_never_comes_is_a_refusal() {
        // A interface pode cair no meio da pergunta; a resposta segura e nao.
        let (approver, mut inbox) = Asking::channel();
        tokio::spawn(async move {
            let request = inbox.recv().await.expect("um pedido");
            drop(request);
        });

        let call = call("bash");
        assert!(!approver.approve(&call).await.authorizes(&call));
    }
}
