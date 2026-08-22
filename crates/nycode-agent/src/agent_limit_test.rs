//! Testes do orçamento agregado de chamadas de ferramenta.

#![allow(clippy::unwrap_used, clippy::panic)]

use std::sync::Arc;

use nycode_ai::{StopReason, StreamEvent};

use crate::agent::{Agent, Silent};
use crate::backend::fake::FakeBackend;
use crate::error::Error;
use crate::tool::ToolContext;
use crate::tools::Read;

fn multi_tool_turn(calls: &[(&str, &str, &str)]) -> Vec<StreamEvent> {
    let mut events = vec![StreamEvent::MessageStart { id: "m".into() }];
    for (id, name, args) in calls {
        events.extend([
            StreamEvent::ToolCallStart {
                id: (*id).into(),
                name: (*name).into(),
            },
            StreamEvent::ToolCallDelta {
                id: (*id).into(),
                json_fragment: (*args).into(),
            },
            StreamEvent::ToolCallEnd { id: (*id).into() },
        ]);
    }
    events.push(StreamEvent::MessageEnd {
        stop_reason: StopReason::ToolUse,
    });
    events
}

#[tokio::test]
async fn a_tool_round_cannot_exceed_the_aggregate_tool_limit() {
    let dir = tempfile::tempdir().unwrap();
    let ctx = ToolContext::new(dir.path()).unwrap();
    let backend = Arc::new(FakeBackend::new(vec![multi_tool_turn(&[
        ("t1", "read", r#"{"path":"a.txt"}"#),
        ("t2", "read", r#"{"path":"b.txt"}"#),
    ])]));
    let mut agent = Agent::new(backend.clone(), ctx)
        .with_tool(Arc::new(Read))
        .with_tool_limit(1);

    let err = agent.run("leia os dois arquivos", &mut Silent).await;
    assert!(matches!(err, Err(Error::ToolLoopLimit { limit: 1 })));
    assert_eq!(backend.call_count(), 1);
}

#[tokio::test]
async fn a_tool_round_that_exactly_reaches_the_aggregate_limit_is_allowed() {
    let dir = tempfile::tempdir().unwrap();
    let ctx = ToolContext::new(dir.path()).unwrap();
    let backend = Arc::new(FakeBackend::new(vec![
        multi_tool_turn(&[("t1", "read", r#"{"path":"a.txt"}"#)]),
        vec![
            StreamEvent::TextDelta("pronto".into()),
            StreamEvent::MessageEnd {
                stop_reason: StopReason::EndTurn,
            },
        ],
    ]));
    let mut agent = Agent::new(backend.clone(), ctx)
        .with_tool(Arc::new(Read))
        .with_tool_limit(1);

    let outcome = agent.run("leia o arquivo", &mut Silent).await.unwrap();
    assert_eq!(outcome.text, "pronto");
    assert_eq!(backend.call_count(), 2);
}
