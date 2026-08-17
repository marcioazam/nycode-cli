//! B28: `/session`, `/copy`, `/new` e `/reload`.

use std::sync::Arc;

use crossterm::event::KeyCode;
use nycode_ai::anthropic::{ContentBlock, Message};

use super::fakes::{Recording, Scripted, delivered, key, typing};
use super::*;

fn store() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("sessions")).unwrap();
    (dir, store)
}

async fn submit(session: &mut Session, typed: &str) -> String {
    let mut events = typing(typed);
    events.push(key(KeyCode::Enter));
    let mut surface = Recording::new();
    session
        .run(&mut surface, &mut delivered(events))
        .await
        .unwrap();
    surface.scrollback
}

#[tokio::test]
async fn session_lists_id_name_and_message_count() {
    let (_dir, store) = store();
    store.append("sessao-1", &Message::user("oi")).unwrap();
    std::fs::write(store.dir().join("sessao-1.name"), "projeto").unwrap();
    let mut session = Session::with_turns(Box::new(Scripted::default()), store, "sessao-1");
    let out = submit(&mut session, "/session").await;
    assert!(
        out.contains("sessao-1") && out.contains("projeto") && out.contains("mensagens: 1"),
        "{out}"
    );
}

#[tokio::test]
async fn copy_shows_the_last_assistant_text() {
    let (_dir, store) = store();
    store
        .append(
            "sessao-1",
            &Message::assistant(vec![ContentBlock::text("resposta")]),
        )
        .unwrap();
    let mut session = Session::with_turns(Box::new(Scripted::default()), store, "sessao-1");
    let out = submit(&mut session, "/copy").await;
    assert!(out.contains("resposta"), "{out}");
}

#[tokio::test]
async fn a_new_session_drops_the_previous_history() {
    let (_dir, store) = store();
    let turns = Scripted {
        history: vec![Message::user("antigo")],
        ..Scripted::default()
    };
    let retargets = Arc::clone(&turns.retargets);
    let mut session = Session::with_turns(Box::new(turns), store, "sessao-1");
    submit(&mut session, "/new").await;
    assert!(session.turns.history().is_empty());
    assert_ne!(session.id, "sessao-1");
    assert!(session.panel.editor_mut().history().is_empty());
    assert_eq!(retargets.lock().unwrap()[0].0, session.id);
}

#[tokio::test]
async fn reload_picks_up_a_command_written_after_startup() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join(".nycode/commands")).unwrap();
    std::fs::write(dir.path().join(".nycode/commands/ping.md"), "pong\n").unwrap();
    let root = dir.path().to_path_buf();
    let store = Store::open(root.join("sessions")).unwrap();
    let mut session = Session::with_turns(Box::new(Scripted::default()), store, "sessao-1");
    session.root = root;
    submit(&mut session, "/reload").await;
    assert!(session.commands.iter().any(|c| c.name == "ping"));
}

#[tokio::test]
async fn reload_keeps_the_invocation_system_flag() {
    let (_dir, store) = store();
    let turns = Scripted::default();
    let last_system = Arc::clone(&turns.last_system);
    let mut session = Session::with_turns(Box::new(turns), store, "sessao-1");
    session.system = Some("so isto".to_owned());
    submit(&mut session, "/reload").await;
    let text = last_system.lock().unwrap();
    assert!(
        text.as_deref().unwrap_or("").contains("so isto"),
        "{text:?}"
    );
}
