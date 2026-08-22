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

async fn run(task: &Task, description: &str, ctx: &ToolContext) -> ToolOutput {
    task.execute(task.prepare(json!({ "description": description })), ctx)
        .await
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

    let task = Task::new(backend).await.unwrap();
    let out = run(&task, "onde fica o main", &ctx).await;

    assert!(!out.is_error);
    assert_eq!(out.content, "esta em src/main.rs");
}

#[tokio::test]
async fn the_child_does_not_see_the_conversation_of_the_parent() {
    // Herdar o historico desfaria a razao de existir da ferramenta: o custo
    // seria o mesmo e a janela do pai nao sobraria.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("pronto")]));

    let task = Task::new(backend.clone()).await.unwrap();
    run(&task, "faca algo", &ctx).await;

    let sent = backend.last_messages();
    assert_eq!(sent.len(), 1, "so a descricao da tarefa: {sent:?}");
}

#[tokio::test]
async fn the_child_gets_its_own_instruction() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("pronto")]));

    let task = Task::new(backend.clone()).await.unwrap();
    run(&task, "faca algo", &ctx).await;

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

    let task = Task::new(backend).await.unwrap();
    let out = run(&task, "leia alvo.txt", &ctx).await;

    assert!(!out.is_error, "{}", out.content);
    assert!(out.content.contains("conteudo procurado"));
}

#[tokio::test]
async fn a_child_cannot_spawn_another_child() {
    // A recursao e impedida pela construcao, e nao por um contador que
    // dependeria de o modelo respeita-lo.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("pronto")]));

    let task = Task::new(backend.clone()).await.unwrap();
    run(&task, "delegue de novo", &ctx).await;

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

    let task = Task::new(backend).await.unwrap();
    run(&task, "crie um arquivo", &ctx).await;

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

    let task = Task::new(backend)
        .await
        .unwrap()
        .with_gate(|| Box::new(crate::policy::AllowAll));
    run(&task, "crie um arquivo", &ctx).await;

    assert!(ctx.root().join("novo.txt").exists());
}

#[tokio::test]
async fn a_child_that_answers_nothing_is_reported_as_a_failure() {
    // Resultado inutil disfarcado de sucesso faria o pai seguir como se
    // tivesse a resposta.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("   ")]));

    let task = Task::new(backend).await.unwrap();
    let out = run(&task, "faca algo", &ctx).await;

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

    let task = Task::new(backend).await.unwrap();
    let out = run(&task, "faca algo", &ctx).await;

    assert!(out.is_error);
    assert!(out.content.contains("subagente falhou"), "{}", out.content);
}

#[tokio::test]
async fn an_empty_or_missing_description_is_refused() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("nao deveria rodar")]));
    let task = Task::new(backend.clone()).await.unwrap();

    assert!(task.execute(json!({}), &ctx).await.is_error);
    assert!(
        task.execute(json!({ "description": "  " }), &ctx)
            .await
            .is_error
    );
    assert_eq!(backend.call_count(), 0, "nao pode gastar um turno");
}

#[tokio::test]
async fn the_schema_and_the_description_tell_the_model_how_to_use_it() {
    let backend = Arc::new(FakeBackend::new(vec![]));
    let task = Task::new(backend).await.unwrap();

    assert_eq!(task.name(), "task");
    assert_eq!(task.input_schema()["required"][0], "description");
    assert!(task.input_schema()["properties"].get("envelope").is_none());
    // Sem isto o modelo escreveria uma descricao que so faz sentido no
    // contexto da conversa, e o filho nao a entenderia.
    assert!(task.description().contains("nao ve esta conversa"));
}

#[tokio::test]
async fn the_debug_view_does_not_dump_the_backend() {
    let backend = Arc::new(FakeBackend::new(vec![]));
    let rendered = format!("{:?}", Task::new(backend).await.unwrap());
    assert!(rendered.starts_with("Task"), "{rendered}");
}

#[tokio::test]
async fn a_spawn_without_envelope_is_refused() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("nao deveria rodar")]));
    let task = Task::new(backend.clone()).await.unwrap();

    let out = task
        .execute(json!({ "description": "faca algo" }), &ctx)
        .await;

    assert!(out.is_error, "{}", out.content);
    assert!(out.content.contains("envelope ausente"), "{}", out.content);
    assert_eq!(backend.call_count(), 0);
}

#[tokio::test]
async fn a_forged_or_expired_envelope_is_refused() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("nao deveria rodar")]));
    let task = Task::new(backend.clone()).await.unwrap();
    let sibling = Task::new(backend.clone()).await.unwrap();

    let mut forged = task.prepare(json!({ "description": "faca algo" }));
    forged["envelope"]["mac"] = json!("00deadbeef");
    let out = task.execute(forged, &ctx).await;
    assert!(out.is_error, "{}", out.content);
    assert!(
        out.content.contains("envelope rejeitado"),
        "{}",
        out.content
    );

    let mut expired = task.prepare(json!({ "description": "faca algo" }));
    expired["envelope"]["exp"] = json!(1);
    let out = task.execute(expired, &ctx).await;
    assert!(out.is_error, "{}", out.content);
    assert!(
        out.content.contains("envelope rejeitado"),
        "{}",
        out.content
    );

    let foreign = sibling.prepare(json!({ "description": "faca algo" }));
    let out = task.execute(foreign, &ctx).await;
    assert!(out.is_error, "{}", out.content);
    assert!(
        out.content.contains("envelope rejeitado"),
        "{}",
        out.content
    );

    assert_eq!(backend.call_count(), 0);
}
#[tokio::test]
async fn valid_envelopes_are_checked_against_the_current_time_and_ttl() {
    let backend = Arc::new(FakeBackend::new(vec![]));
    let task = Task::new(backend).await.unwrap();
    let description = "faca algo";

    let expired = 1;
    assert!(!task.envelope_ok(
        description,
        &json!({ "exp": expired, "mac": task.mac(description, expired).unwrap() })
    ));

    let far_future = u64::MAX;
    assert!(!task.envelope_ok(
        description,
        &json!({
            "exp": far_future,
            "mac": task.mac(description, far_future).unwrap()
        })
    ));

    let old_epoch_expiry = ENVELOPE_TTL_MS;
    assert!(!task.envelope_ok(
        description,
        &json!({
            "exp": old_epoch_expiry,
            "mac": task.mac(description, old_epoch_expiry).unwrap()
        })
    ));
}

#[test]
fn hmac_sha256_matches_vectors_inside_and_outside_the_block_size() {
    let short_key = b"Jefe";
    let short_message = b"what do ya want for nothing?";
    assert_eq!(
        sign_bytes(short_key, short_message).unwrap(),
        "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
    );

    let long_key = vec![0xaa; 131];
    let long_message = b"Test Using Larger Than Block-Size Key - Hash Key First";
    assert_eq!(
        sign_bytes(&long_key, long_message).unwrap(),
        "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
    );
}

#[test]
fn envelope_payload_starts_with_little_endian_expiry() {
    assert_eq!(
        envelope_payload("abc", 0x0102_0304_0506_0708),
        vec![8, 7, 6, 5, 4, 3, 2, 1, b'a', b'b', b'c']
    );
}

#[test]
fn hmac_sha256_handles_a_key_that_fills_the_block() {
    let key = vec![0x11; 64];

    assert_eq!(
        sign_bytes(&key, b"block boundary message").unwrap(),
        "80752bcda6c0a0e0d3d26930496c8d4b84e3c66a4574422f37ad6d6ceb93c8c9"
    );
}

#[test]
fn an_incomplete_entropy_source_is_rejected_instead_of_hashed() {
    let err = key_from(std::io::empty()).expect_err("entropia incompleta");
    assert!(matches!(err, crate::Error::Randomness(_)), "{err}");
}

#[test]
fn a_malformed_mac_is_rejected_without_panicking() {
    assert!(!verify_bytes(&[0u8; 32], b"payload", "not-hex"));
}

#[tokio::test]
async fn valid_hex_macs_with_wrong_length_or_content_are_rejected() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("nao deveria rodar")]));
    let task = Task::new(backend.clone()).await.unwrap();
    let exp = now_millis().saturating_add(1_000);

    for mac in ["00".repeat(31), "00".repeat(32)] {
        let input = json!({
            "description": "faca algo",
            "envelope": { "exp": exp, "mac": mac }
        });
        let out = task.execute(input, &ctx).await;
        assert!(out.is_error, "{mac}: {}", out.content);
        assert!(
            out.content.contains("envelope rejeitado"),
            "{}",
            out.content
        );
    }

    assert_eq!(backend.call_count(), 0);
}
