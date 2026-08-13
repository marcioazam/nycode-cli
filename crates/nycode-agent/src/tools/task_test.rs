//! Subagentes (FR-15, ADR-0007).

#![allow(clippy::unwrap_used, clippy::panic)]

use super::*;
use crate::agent_test::text_turn;
use crate::backend::fake::FakeBackend;
use nycode_ai::StopReason;
use nycode_ai::event::StreamEvent;

fn workspace() -> (tempfile::TempDir, ToolContext) {
    let dir = tempfile::tempdir().unwrap();
    let ctx = ToolContext::new(dir.path()).unwrap();
    (dir, ctx)
}

fn tool_turn(id: &str, name: &str, args: &str) -> Vec<StreamEvent> {
    vec![
        StreamEvent::MessageStart { id: "m".into() },
        StreamEvent::ToolCallStart {
            id: id.into(),
            name: name.into(),
        },
        StreamEvent::ToolCallDelta {
            id: id.into(),
            json_fragment: args.into(),
        },
        StreamEvent::ToolCallEnd { id: id.into() },
        StreamEvent::MessageEnd {
            stop_reason: StopReason::ToolUse,
        },
    ]
}

#[tokio::test]
async fn the_child_answers_and_only_the_answer_comes_back() {
    // O pai recebe so o texto final: a narracao do caminho gastaria a janela
    // que a delegacao existe para poupar.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("esta em src/main.rs")]));

    let out = Task::new(backend)
        .execute(json!({ "description": "onde fica o main" }), &ctx)
        .await;

    assert!(!out.is_error);
    assert_eq!(out.content, "esta em src/main.rs");
}

#[tokio::test]
async fn the_child_does_not_see_the_conversation_of_the_parent() {
    // Herdar o historico desfaria a razao de existir da ferramenta: o custo
    // seria o mesmo e a janela do pai nao sobraria.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("pronto")]));

    Task::new(backend.clone())
        .execute(json!({ "description": "faca algo" }), &ctx)
        .await;

    let sent = backend.last_messages();
    assert_eq!(sent.len(), 1, "so a descricao da tarefa: {sent:?}");
}

#[tokio::test]
async fn the_child_gets_its_own_instruction() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("pronto")]));

    Task::new(backend.clone())
        .execute(json!({ "description": "faca algo" }), &ctx)
        .await;

    let system = backend.last_system().unwrap_or_default();
    assert!(system.contains("subagente"), "{system}");
}

#[tokio::test]
async fn the_child_can_use_the_tools_it_needs() {
    let (_dir, ctx) = workspace();
    std::fs::write(ctx.root().join("alvo.txt"), "conteudo procurado").unwrap();

    let backend = Arc::new(FakeBackend::new(vec![
        tool_turn("t1", "read", r#"{"path":"alvo.txt"}"#),
        text_turn("achei: conteudo procurado"),
    ]));

    let out = Task::new(backend)
        .execute(json!({ "description": "leia alvo.txt" }), &ctx)
        .await;

    assert!(!out.is_error, "{}", out.content);
    assert!(out.content.contains("conteudo procurado"));
}

#[tokio::test]
async fn a_child_cannot_spawn_another_child() {
    // A recursao e impedida pela construcao, e nao por um contador que
    // dependeria de o modelo respeita-lo.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("pronto")]));

    Task::new(backend.clone())
        .execute(json!({ "description": "delegue de novo" }), &ctx)
        .await;

    let offered = format!("{:?}", backend.last_tools());
    assert!(
        !offered.contains("task"),
        "`task` foi oferecida ao filho: {offered}"
    );
}

#[tokio::test]
async fn the_child_inherits_the_permission_of_the_parent() {
    // Um subagente que pudesse mais que quem o chamou seria uma escada de
    // privilegio.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![
        tool_turn("t1", "write", r#"{"path":"novo.txt","content":"x"}"#),
        text_turn("terminei"),
    ]));

    Task::new(backend)
        .execute(json!({ "description": "crie um arquivo" }), &ctx)
        .await;

    assert!(
        !ctx.root().join("novo.txt").exists(),
        "o filho escreveu apesar de o padrao ser somente-leitura"
    );
}

#[tokio::test]
async fn a_child_with_write_permission_can_write() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![
        tool_turn("t1", "write", r#"{"path":"novo.txt","content":"x"}"#),
        text_turn("terminei"),
    ]));

    Task::new(backend)
        .with_gate(|| Box::new(crate::policy::AllowAll))
        .execute(json!({ "description": "crie um arquivo" }), &ctx)
        .await;

    assert!(ctx.root().join("novo.txt").exists());
}

#[tokio::test]
async fn a_child_that_answers_nothing_is_reported_as_a_failure() {
    // Resultado inutil disfarcado de sucesso faria o pai seguir como se
    // tivesse a resposta.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("   ")]));

    let out = Task::new(backend)
        .execute(json!({ "description": "faca algo" }), &ctx)
        .await;

    assert!(out.is_error);
    assert!(
        out.content.contains("sem produzir resposta"),
        "{}",
        out.content
    );
}

#[tokio::test]
async fn a_child_that_fails_says_so_instead_of_answering_empty() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::failing(nycode_ai::Error::TruncatedStream {
        bytes: 3,
    }));

    let out = Task::new(backend)
        .execute(json!({ "description": "faca algo" }), &ctx)
        .await;

    assert!(out.is_error);
    assert!(out.content.contains("subagente falhou"), "{}", out.content);
}

#[tokio::test]
async fn an_empty_or_missing_description_is_refused() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("nao deveria rodar")]));
    let task = Task::new(backend.clone());

    assert!(task.execute(json!({}), &ctx).await.is_error);
    assert!(
        task.execute(json!({ "description": "  " }), &ctx)
            .await
            .is_error
    );
    assert_eq!(backend.call_count(), 0, "nao pode gastar um turno");
}

#[test]
fn the_schema_and_the_description_tell_the_model_how_to_use_it() {
    let backend = Arc::new(FakeBackend::new(vec![]));
    let task = Task::new(backend);

    assert_eq!(task.name(), "task");
    assert_eq!(task.input_schema()["required"][0], "description");
    // Sem isto o modelo escreveria uma descricao que so faz sentido no
    // contexto da conversa, e o filho nao a entenderia.
    assert!(task.description().contains("nao ve esta conversa"));
}

#[test]
fn the_debug_view_does_not_dump_the_backend() {
    let backend = Arc::new(FakeBackend::new(vec![]));
    let rendered = format!("{:?}", Task::new(backend));
    assert!(rendered.starts_with("Task"), "{rendered}");
}
