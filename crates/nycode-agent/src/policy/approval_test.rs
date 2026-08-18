#![allow(clippy::unwrap_used, clippy::panic)]
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

fn write_to(path: &str, content: &str) -> ToolCall {
    ToolCall {
        id: "t1".to_owned(),
        name: "write".to_owned(),
        input: serde_json::json!({ "path": path, "content": content }),
    }
}

#[derive(Debug)]
struct CountAlways {
    hits: std::sync::atomic::AtomicUsize,
}

#[async_trait]
impl Approver for CountAlways {
    async fn approve(&self, _call: &ToolCall) -> bool {
        self.hits.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        true
    }
}

#[tokio::test]
async fn a_session_grant_for_one_path_does_not_approve_a_different_path() {
    let (asking, mut inbox) = Asking::channel();
    let bound = Bound::new("session-1", Arc::new(asking));
    let attendant = tokio::spawn(async move {
        let request = inbox.recv().await.expect("primeiro");
        assert_eq!(request.call.input["path"], "a.txt");
        request.answer(true);
        let request = inbox.recv().await.expect("segundo");
        assert_eq!(request.call.input["path"], "b.txt");
        request.answer(false);
    });

    assert!(bound.approve(&write_to("a.txt", "x")).await);
    assert!(!bound.approve(&write_to("b.txt", "x")).await);
    attendant.await.unwrap();
}

#[tokio::test]
async fn the_same_path_with_different_params_does_not_reuse_the_grant() {
    let inner = Arc::new(CountAlways {
        hits: std::sync::atomic::AtomicUsize::new(0),
    });
    let bound = Bound::new("session-1", inner.clone());
    assert!(bound.approve(&write_to("a.txt", "x")).await);
    assert!(bound.approve(&write_to("a.txt", "y")).await);
    assert_eq!(inner.hits.load(std::sync::atomic::Ordering::Relaxed), 2);
}

#[tokio::test]
async fn a_child_actor_does_not_reuse_the_parent_grant() {
    let parent = Bound::new("parent", Arc::new(Always));
    assert!(parent.approve(&write_to("a.txt", "x")).await);
    let child = Bound::new("child", Arc::new(Never));
    assert!(!child.approve(&write_to("a.txt", "x")).await);
}

#[tokio::test]
async fn an_unlinkable_call_is_refused_and_not_cached() {
    let inner = Arc::new(CountAlways {
        hits: std::sync::atomic::AtomicUsize::new(0),
    });
    let bound = Bound::new("session-1", inner.clone());
    assert!(!bound.approve(&call("write")).await);
    assert_eq!(inner.hits.load(std::sync::atomic::Ordering::Relaxed), 0);
}

#[tokio::test]
async fn a_repeated_call_with_the_same_key_does_not_ask_again() {
    let inner = Arc::new(CountAlways {
        hits: std::sync::atomic::AtomicUsize::new(0),
    });
    let bound = Bound::new("session-1", inner.clone());
    let first = write_to("a.txt", "x");
    assert!(bound.approve(&first).await);
    assert!(bound.approve(&first).await);
    assert_eq!(inner.hits.load(std::sync::atomic::Ordering::Relaxed), 1);
}

#[tokio::test]
async fn a_file_key_binds_the_same_way_as_path() {
    let bound = Bound::new("session-1", Arc::new(Always));
    let call = ToolCall {
        id: "t1".to_owned(),
        name: "edit".to_owned(),
        input: serde_json::json!({ "file": "a.rs" }),
    };
    assert!(bound.approve(&call).await);
}

#[tokio::test]
async fn bash_without_argv_or_command_is_unlinkable() {
    let bound = Bound::new("session-1", Arc::new(Always));
    assert!(!bound.approve(&call("bash")).await);
    assert!(
        !bound
            .approve(&ToolCall {
                id: "t1".to_owned(),
                name: "bash".to_owned(),
                input: serde_json::json!({ "argv": [] }),
            })
            .await
    );
}

#[tokio::test]
async fn bash_argv_and_command_are_distinct_targets() {
    let inner = Arc::new(CountAlways {
        hits: std::sync::atomic::AtomicUsize::new(0),
    });
    let bound = Bound::new("session-1", inner.clone());
    let command = ToolCall {
        id: "t1".to_owned(),
        name: "bash".to_owned(),
        input: serde_json::json!({ "command": "echo a" }),
    };
    let argv = ToolCall {
        id: "t1".to_owned(),
        name: "bash".to_owned(),
        input: serde_json::json!({ "argv": ["echo", "a"] }),
    };
    assert!(bound.approve(&command).await);
    assert!(bound.approve(&argv).await);
    assert_eq!(inner.hits.load(std::sync::atomic::Ordering::Relaxed), 2);
}

#[tokio::test]
async fn a_blank_path_does_not_become_a_target() {
    let bound = Bound::new("session-1", Arc::new(Always));
    assert!(
        !bound
            .approve(&ToolCall {
                id: "t1".to_owned(),
                name: "write".to_owned(),
                input: serde_json::json!({ "path": "   " }),
            })
            .await
    );
}

#[tokio::test]
async fn an_inspection_tool_binds_to_its_name() {
    let bound = Bound::new("session-1", Arc::new(Always));
    assert!(bound.approve(&call("ls")).await);
}

#[tokio::test]
async fn a_task_description_is_the_target() {
    let bound = Bound::new("session-1", Arc::new(Always));
    assert!(
        bound
            .approve(&ToolCall {
                id: "t1".to_owned(),
                name: "task".to_owned(),
                input: serde_json::json!({ "description": "summarize" }),
            })
            .await
    );
    assert!(!bound.approve(&call("task")).await);
}
