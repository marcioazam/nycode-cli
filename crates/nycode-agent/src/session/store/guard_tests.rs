#![allow(clippy::unwrap_used, clippy::panic)]

use super::*;
use nycode_ai::anthropic::Message;
use std::path::Path;

fn store() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("sessoes")).unwrap();
    (dir, store)
}

#[test]
fn an_empty_store_has_no_latest_session() {
    let (_dir, store) = store();
    assert!(store.latest().unwrap().is_none());
    assert!(store.list().unwrap().is_empty());
}

#[test]
fn non_session_files_are_ignored_when_listing() {
    let (_dir, store) = store();
    std::fs::write(store.dir().join("anotacoes.txt"), "nada a ver").unwrap();
    store.append("s1", &Message::user("x")).unwrap();

    let ids: Vec<_> = store.list().unwrap().into_iter().map(|s| s.id).collect();
    assert_eq!(ids, vec!["s1"]);
}

#[test]
fn generated_ids_sort_chronologically() {
    let first = Store::new_id();
    std::thread::sleep(std::time::Duration::from_millis(5));
    let second = Store::new_id();
    assert!(
        second > first,
        "ids precisam ordenar por tempo: {first} vs {second}"
    );
}

#[test]
fn malformed_session_paths_fail_closed_before_opening() {
    assert!(super::guard::open_session_for_append(Path::new("")).is_err());
    assert!(super::guard::open_session_for_append(Path::new("/")).is_err());

    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("missing").join("session.jsonl");
    assert!(super::guard::open_session_for_append(&missing).is_err());
    assert!(super::guard::SessionLock::acquire(&missing).is_err());
}
