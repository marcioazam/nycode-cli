//! O que um turno reporta ao chamador quando termina.
//!
//! Contabilidade de tokens e motivo de parada são o contrato observável de um
//! pedido: o modo JSON os publica, o harness de paridade os compara e o código
//! de saída do processo deriva deles. Um campo trocado por zero ou um motivo
//! inventado não fica dentro do agente — chega ao usuário como fato medido.

#![allow(clippy::unwrap_used, clippy::panic)]

use std::sync::Arc;

use nycode_ai::{StopReason, StreamEvent, Usage};

use async_trait::async_trait;
use serde_json::{Value, json};

use crate::agent::{Agent, Silent};
use crate::agent_test::{text_turn, tool_turn, workspace};
use crate::backend::fake::FakeBackend;
use crate::policy::AllowAll;
use crate::tool::{Tool, ToolContext, ToolOutput};

#[tokio::test]
async fn the_reasoning_tokens_of_a_turn_reach_the_total() {
    // O gateway cobra por eles e o modo JSON publica a struct inteira. Somar
    // cinco dos seis campos de `Usage` entrega um numero medido como zero, que
    // e a substituicao por default que o NFR-4 proibe.
    let (_dir, ctx) = workspace();
    let turn = vec![
        StreamEvent::MessageStart { id: "m".into() },
        StreamEvent::TextDelta("ok".into()),
        StreamEvent::Usage(Usage {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_tokens: 3,
            cache_write_tokens: 2,
            cache_write_1h_tokens: 1,
            reasoning_tokens: 4,
            estimated: false,
        }),
        StreamEvent::MessageEnd {
            stop_reason: StopReason::EndTurn,
        },
    ];
    let backend = Arc::new(FakeBackend::new(vec![turn]));
    let mut agent = Agent::new(backend, ctx);

    let outcome = agent.run("oi", &mut Silent).await.unwrap();

    assert_eq!(
        outcome.usage.reasoning_tokens, 4,
        "usage acumulado: {:?}",
        outcome.usage
    );
    assert_eq!(outcome.usage.cache_write_tokens, 2);
    assert_eq!(outcome.usage.input_tokens, 10);
}

#[tokio::test]
async fn every_field_of_usage_survives_two_turns() {
    // A soma e escrita campo a campo, entao um campo novo em `Usage` sai
    // zerado sem que nada quebre. Este teste falha no dia em que isso
    // acontecer, que e o unico aviso que existe.
    let (_dir, ctx) = workspace();
    let each = |n: u64| {
        vec![
            StreamEvent::MessageStart { id: "m".into() },
            StreamEvent::Usage(Usage {
                input_tokens: n,
                output_tokens: n,
                cache_read_tokens: n,
                cache_write_tokens: n,
                cache_write_1h_tokens: n,
                reasoning_tokens: n,
                estimated: false,
            }),
            StreamEvent::MessageEnd {
                stop_reason: StopReason::ToolUse,
            },
        ]
    };
    // O primeiro turno pede ferramenta sem chamada nenhuma, o que encerra o
    // laco; um turno so ja exercita a soma de todos os campos.
    let backend = Arc::new(FakeBackend::new(vec![each(7)]));
    let mut agent = Agent::new(backend, ctx);

    let usage = agent.run("oi", &mut Silent).await.unwrap().usage;

    assert_eq!(usage.input_tokens, 7);
    assert_eq!(usage.output_tokens, 7);
    assert_eq!(usage.cache_read_tokens, 7);
    assert_eq!(usage.cache_write_tokens, 7);
    assert_eq!(usage.cache_write_1h_tokens, 7);
    assert_eq!(usage.reasoning_tokens, 7);
}

#[tokio::test]
async fn an_estimated_turn_keeps_the_total_estimated() {
    // `estimated` e OR e nao soma: basta um turno heuristico para que o total
    // deixe de ser medido, e apresenta-lo como medido e o que o NFR-4 proibe.
    let (_dir, ctx) = workspace();
    let turn = vec![
        StreamEvent::MessageStart { id: "m".into() },
        StreamEvent::Usage(Usage {
            input_tokens: 1,
            estimated: true,
            ..Usage::default()
        }),
        StreamEvent::MessageEnd {
            stop_reason: StopReason::EndTurn,
        },
    ];
    let backend = Arc::new(FakeBackend::new(vec![turn]));
    let mut agent = Agent::new(backend, ctx);

    let outcome = agent.run("oi", &mut Silent).await.unwrap();

    assert!(outcome.usage.estimated);
}

#[tokio::test]
async fn what_a_run_produced_excludes_the_history_it_started_from() {
    // Quem persiste precisa saber o que acrescentar ao arquivo de sessao. Fazer
    // isso por indice sobre o historico e fragil: a compactacao reescreve a
    // lista no meio do pedido, e o indice passa a apontar para outra mensagem.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![crate::agent_test::text_turn("ok")]));
    let mut agent = Agent::new(backend, ctx)
        .with_message(nycode_ai::anthropic::Message::user("veio do disco"))
        .with_message(nycode_ai::anthropic::Message::assistant(vec![
            nycode_ai::anthropic::ContentBlock::text("tambem do disco"),
        ]));

    agent.run("oi", &mut Silent).await.unwrap();

    let produced = agent.produced();
    assert_eq!(
        produced.len(),
        2,
        "o pedido e a resposta deste turno, e nada do disco: {produced:?}"
    );
    assert_eq!(agent.history().len(), 4, "o historico completo continua la");
}

#[tokio::test]
async fn compaction_does_not_erase_what_the_run_produced() {
    // A compactacao encolhe o historico para caber na janela de contexto, e o
    // arquivo de sessao nao pode encolher junto: ele e o registro duravel da
    // conversa. Fatiar `history()` por indice depois disto grava o recorte
    // errado, ou estoura o fim do slice.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![crate::agent_test::text_turn("ok")]));
    let mut agent = Agent::new(backend, ctx);
    for n in 0..40 {
        agent = agent.with_message(nycode_ai::anthropic::Message::user(format!("antiga {n}")));
    }

    agent.run("oi", &mut Silent).await.unwrap();
    let antes = agent.produced().to_vec();
    agent.compact_now().await;

    assert_eq!(
        agent.produced(),
        antes.as_slice(),
        "compactar muda o contexto, nao o que este pedido acrescentou"
    );
}

#[tokio::test]
async fn a_turn_that_never_reported_a_stop_reason_is_not_passed_off_as_a_clean_end() {
    // `event.rs` promete que a projecao preserva o que o gateway emitiu e nunca
    // inventa um `EndTurn`. Inventa-lo aqui desfaz a promessa uma camada acima:
    // `exit::code_for` mapeia `EndTurn` para sucesso, entao um turno que nunca
    // disse como terminou sai com codigo 0 e o script que encadeia `nycode` nao
    // tem como perceber.
    let (_dir, ctx) = workspace();
    let turn = vec![
        StreamEvent::MessageStart { id: "m".into() },
        StreamEvent::TextDelta("parcial".into()),
    ];
    let backend = Arc::new(FakeBackend::new(vec![turn]));
    let mut agent = Agent::new(backend, ctx);

    let outcome = agent.run("oi", &mut Silent).await.unwrap();

    assert_ne!(
        outcome.stop_reason,
        StopReason::EndTurn,
        "um turno sem motivo de parada nao pode passar por concluido"
    );
    assert!(
        matches!(outcome.stop_reason, StopReason::Unrecognized(_)),
        "veio {:?}",
        outcome.stop_reason
    );
    assert_eq!(
        outcome.text, "parcial",
        "o texto que chegou continua sendo entregue"
    );
}

#[tokio::test]
async fn a_reported_stop_reason_is_handed_over_untouched() {
    // O caso simetrico do anterior: o que o gateway disse chega inteiro, sem
    // normalizacao para o valor conhecido mais proximo.
    let (_dir, ctx) = workspace();
    let turn = vec![
        StreamEvent::MessageStart { id: "m".into() },
        StreamEvent::MessageEnd {
            stop_reason: StopReason::Unrecognized("motivo_novo".to_owned()),
        },
    ];
    let backend = Arc::new(FakeBackend::new(vec![turn]));
    let mut agent = Agent::new(backend, ctx);

    let outcome = agent.run("oi", &mut Silent).await.unwrap();

    assert_eq!(
        outcome.stop_reason,
        StopReason::Unrecognized("motivo_novo".to_owned())
    );
}

#[derive(Debug)]
struct Done;

#[async_trait]
#[allow(clippy::unnecessary_literal_bound)]
impl Tool for Done {
    fn name(&self) -> &str {
        "done"
    }
    fn description(&self) -> &str {
        "encerra"
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object" })
    }
    async fn execute(&self, _input: Value, _ctx: &ToolContext) -> ToolOutput {
        let mut out = ToolOutput::ok("pronto");
        out.stop();
        out
    }
}

#[derive(Debug)]
struct Keep;

#[async_trait]
#[allow(clippy::unnecessary_literal_bound)]
impl Tool for Keep {
    fn name(&self) -> &str {
        "keep"
    }
    fn description(&self) -> &str {
        "continua"
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object" })
    }
    async fn execute(&self, _input: Value, _ctx: &ToolContext) -> ToolOutput {
        ToolOutput::ok("ainda")
    }
}

fn two_tools(first: &str, second: &str) -> Vec<StreamEvent> {
    vec![
        StreamEvent::MessageStart { id: "m".into() },
        StreamEvent::ToolCallStart {
            id: "t1".into(),
            name: first.into(),
        },
        StreamEvent::ToolCallDelta {
            id: "t1".into(),
            json_fragment: "{}".into(),
        },
        StreamEvent::ToolCallEnd { id: "t1".into() },
        StreamEvent::ToolCallStart {
            id: "t2".into(),
            name: second.into(),
        },
        StreamEvent::ToolCallDelta {
            id: "t2".into(),
            json_fragment: "{}".into(),
        },
        StreamEvent::ToolCallEnd { id: "t2".into() },
        StreamEvent::MessageEnd {
            stop_reason: StopReason::ToolUse,
        },
    ]
}

#[tokio::test]
async fn a_terminating_result_skips_the_follow_up_model_turn() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![
        tool_turn("t1", "done", "{}"),
        text_turn("nao deveria chegar"),
    ]));
    let mut agent = Agent::new(backend.clone(), ctx)
        .with_gate(Box::new(AllowAll))
        .with_tool(Arc::new(Done));

    let outcome = agent.run("feche", &mut Silent).await.unwrap();
    assert_eq!(backend.seen.lock().unwrap().len(), 1);
    assert_eq!(outcome.tool_rounds, 1);
}

#[tokio::test]
async fn a_mixed_batch_does_not_stop_the_turn() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![
        two_tools("done", "keep"),
        text_turn("continuou"),
    ]));
    let mut agent = Agent::new(backend.clone(), ctx)
        .with_gate(Box::new(AllowAll))
        .with_tool(Arc::new(Done))
        .with_tool(Arc::new(Keep));

    let _ = agent.run("misto", &mut Silent).await.unwrap();
    assert_eq!(backend.seen.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn a_post_tool_hook_stops_the_turn_without_denying() {
    let (dir, ctx) = workspace();
    let path = dir.path().join(".nycode/hooks/post-tool-use");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "#!/bin/sh\necho '{\"terminate\":true}'\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    let backend = Arc::new(FakeBackend::new(vec![
        tool_turn("t1", "keep", "{}"),
        text_turn("nao deveria chegar"),
    ]));
    let mut agent = Agent::new(backend.clone(), ctx)
        .with_gate(Box::new(AllowAll))
        .with_tool(Arc::new(Keep))
        .with_hooks(crate::policy::Hooks::discover(dir.path()));

    let _ = agent.run("feche", &mut Silent).await.unwrap();
    assert_eq!(backend.seen.lock().unwrap().len(), 1);
}
