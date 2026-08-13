//! O que um turno reporta ao chamador quando termina.
//!
//! Contabilidade de tokens e motivo de parada são o contrato observável de um
//! pedido: o modo JSON os publica, o harness de paridade os compara e o código
//! de saída do processo deriva deles. Um campo trocado por zero ou um motivo
//! inventado não fica dentro do agente — chega ao usuário como fato medido.

#![allow(clippy::unwrap_used, clippy::panic)]

use std::sync::Arc;

use nycode_ai::{StopReason, StreamEvent, Usage};

use crate::agent::{Agent, Silent};
use crate::agent_test::workspace;
use crate::backend::fake::FakeBackend;

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
