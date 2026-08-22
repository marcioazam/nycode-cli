use super::*;
use nycode_ai::anthropic::ContentBlock;

fn store() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("sessoes")).unwrap();
    (dir, store)
}

#[test]
fn a_round_trip_preserves_the_conversation() {
    let (_dir, store) = store();
    let messages = vec![
        Message::user("pergunta"),
        Message::assistant(vec![ContentBlock::text("resposta")]),
        Message::tool_results(vec![ContentBlock::tool_error("t1", "falhou")]),
    ];
    for message in &messages {
        store.append("s1", message).unwrap();
    }
    assert_eq!(store.load("s1").unwrap(), messages);
}

#[test]
fn appending_does_not_reread_the_whole_session() {
    let (_dir, store) = store();
    for n in 0..20 {
        store.append("s1", &Message::user(format!("m{n}"))).unwrap();
    }

    assert!(store.reads() <= 1);
}

#[test]
fn resuming_reads_the_file_once() {
    let (_dir, store) = store();
    for n in 0..5 {
        store.append("s1", &Message::user(format!("m{n}"))).unwrap();
    }

    let resumed = Store::open(store.dir()).unwrap();
    assert_eq!(resumed.load("s1").unwrap().len(), 5);
    assert_eq!(resumed.reads(), 1);
}

#[test]
fn appending_never_rewrites_earlier_lines() {
    let (_dir, store) = store();
    store.append("s1", &Message::user("um")).unwrap();
    let after_first = std::fs::read_to_string(store.path_for("s1").unwrap()).unwrap();

    store.append("s1", &Message::user("dois")).unwrap();
    let after_second = std::fs::read_to_string(store.path_for("s1").unwrap()).unwrap();

    assert!(after_second.starts_with(&after_first));
}

#[test]
fn session_ids_reject_path_syntax_and_unbounded_lengths() {
    let (_dir, store) = store();

    assert!(store.path_for("").is_err());
    assert!(store.path_for("../outside").is_err());
    assert!(store.path_for(&"x".repeat(128)).is_ok());
    assert!(store.path_for(&"x".repeat(129)).is_err());
}

#[cfg(unix)]
#[test]
fn appending_to_a_symlinked_session_is_refused() {
    use std::os::unix::fs::symlink;

    let (dir, store) = store();
    let target = dir.path().join("outside.jsonl");
    let session = store.path_for("s1").unwrap();
    std::fs::write(&target, "").unwrap();
    symlink(&target, session).unwrap();

    assert!(store.append("s1", &Message::user("nao escrever")).is_err());
    assert_eq!(std::fs::read_to_string(target).unwrap(), "");
}

#[cfg(unix)]
#[test]
fn loading_a_symlinked_session_is_refused() {
    use std::os::unix::fs::symlink;

    let (dir, store) = store();
    let target = dir.path().join("outside.jsonl");
    let session = store.path_for("s1").unwrap();
    std::fs::write(&target, "").unwrap();
    symlink(&target, session).unwrap();

    assert!(store.load("s1").is_err());
}

#[cfg(unix)]
#[test]
fn listing_ignores_symlinked_sessions() {
    use std::os::unix::fs::symlink;

    let (_dir, store) = store();
    store.append("real", &Message::user("valida")).unwrap();
    symlink(
        store.path_for("real").unwrap(),
        store.path_for("falsa").unwrap(),
    )
    .unwrap();

    let ids: Vec<_> = store
        .list()
        .unwrap()
        .into_iter()
        .map(|session| session.id)
        .collect();
    assert_eq!(ids, vec!["real"]);
}

#[cfg(unix)]
#[test]
fn opening_a_symlinked_session_directory_is_refused() {
    use std::os::unix::fs::symlink;

    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("target");
    let sessions = dir.path().join("sessions");
    std::fs::create_dir(&target).unwrap();
    symlink(&target, &sessions).unwrap();

    assert!(Store::open(sessions).is_err());
    assert!(!target.join(".mac-key").exists());
}

#[test]
fn appends_from_two_store_instances_preserve_the_latest_parent() {
    let (_dir, first) = store();
    let second = Store::open(first.dir()).unwrap();
    first.append("s1", &Message::user("primeiro")).unwrap();
    second.append("s1", &Message::user("segundo")).unwrap();
    first.append("s1", &Message::user("terceiro")).unwrap();

    assert_eq!(
        first.load("s1").unwrap(),
        vec![
            Message::user("primeiro"),
            Message::user("segundo"),
            Message::user("terceiro")
        ]
    );
}

#[test]
fn a_corrupted_line_costs_one_turn_not_the_conversation() {
    let (_dir, store) = store();
    store.append("s1", &Message::user("antes")).unwrap();
    {
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(store.path_for("s1").unwrap())
            .unwrap();
        writeln!(file, "{{isto nao e json").unwrap();
    }
    store.append("s1", &Message::user("depois")).unwrap();

    assert_eq!(
        store.load("s1").unwrap(),
        vec![Message::user("antes"), Message::user("depois")]
    );
}

#[test]
fn an_unsigned_record_is_rejected_instead_of_becoming_an_empty_session() {
    let (_dir, store) = store();
    std::fs::write(
        store.path_for("s1").unwrap(),
        r#"{"v":2,"ts":1,"id":"r1","message":{"role":"user","content":[{"type":"text","text":"injetado"}]}}"#,
    )
    .unwrap();

    assert!(store.load("s1").is_err());
}

#[test]
fn an_expired_record_is_excluded_from_model_context() {
    let (_dir, store) = store();
    store.append("s1", &Message::user("expirado")).unwrap();
    let path = store.path_for("s1").unwrap();
    let mut record: Record =
        serde_json::from_str(std::fs::read_to_string(&path).unwrap().trim()).unwrap();
    record.ts = 1;
    record.mac = None;
    record.mac = Some(store.mac.sign(&record).unwrap());
    std::fs::write(path, serde_json::to_string(&record).unwrap()).unwrap();

    assert!(store.load("s1").unwrap().is_empty());
}

#[test]
fn a_record_from_another_workspace_is_excluded_from_model_context() {
    let dir_a = tempfile::tempdir().unwrap();
    let store_a = Store::open(dir_a.path().join(".nycode/sessions")).unwrap();
    store_a
        .append("s1", &Message::user("outro workspace"))
        .unwrap();
    let signed = std::fs::read_to_string(store_a.path_for("s1").unwrap()).unwrap();
    let key = std::fs::read(store_a.dir().join(".mac-key")).unwrap();

    let dir_b = tempfile::tempdir().unwrap();
    let store_b = Store::open(dir_b.path().join(".nycode/sessions")).unwrap();
    let key_path = store_b.dir().join(".mac-key");
    std::fs::write(&key_path, key).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    std::fs::write(store_b.path_for("s1").unwrap(), signed).unwrap();

    assert!(store_b.load("s1").unwrap().is_empty());
}

#[cfg(unix)]
#[test]
fn a_mac_key_symlink_is_rejected_before_session_access() {
    use std::os::unix::fs::symlink;

    let dir = tempfile::tempdir().unwrap();
    let sessions = dir.path().join("sessoes");
    std::fs::create_dir_all(&sessions).unwrap();
    let outside = dir.path().join("outside-key");
    std::fs::write(&outside, [0u8; 32]).unwrap();
    symlink(&outside, sessions.join(".mac-key")).unwrap();
    let store = Store::open(sessions).unwrap();

    assert!(store.append("s1", &Message::user("nao escrever")).is_err());
}
