use super::*;
use nycode_ai::anthropic::ContentBlock;
use std::io::Write as _;

fn store() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("sessoes")).unwrap();
    (dir, store)
}

#[test]
fn file_operations_stay_relative_to_the_open_store_directory() {
    let (_dir, store) = store();
    assert!(!store.session_exists("s1").unwrap());
    assert!(store.open_session("s1").is_err());
    assert!(store.name("s1").unwrap().is_none());
    let mut file = store.create_session_file("s1").unwrap();
    file.write_all(b"conteudo\n").unwrap();
    file.sync_all().unwrap();
    assert!(store.session_exists("s1").unwrap());
    let error = store.create_session_file("s1").unwrap_err();
    assert_eq!(error.to_string(), "workspace: sessao `s1` ja existe");
    store.write_name("s1", "uma sessao").unwrap();
    assert_eq!(store.name("s1").unwrap().as_deref(), Some("uma sessao"));
    store.remove_session("s1").unwrap();
    assert!(!store.session_exists("s1").unwrap());
}

#[cfg(unix)]
#[test]
fn file_operations_refuse_symlinked_metadata() {
    use std::os::unix::fs::symlink;
    let (dir, store) = store();
    let outside = dir.path().join("outside");
    std::fs::write(&outside, "nao tocar").unwrap();
    symlink(&outside, dir.path().join("sessoes").join("s1.name")).unwrap();
    assert!(store.name("s1").is_err());
    assert!(store.write_name("s1", "nao").is_err());
    assert_eq!(std::fs::read_to_string(outside).unwrap(), "nao tocar");
}
#[cfg(unix)]
#[test]
fn session_exists_refuses_a_symlinked_session() {
    use std::os::unix::fs::symlink;
    let (dir, store) = store();
    let outside = dir.path().join("outside.jsonl");
    std::fs::write(&outside, "").unwrap();
    symlink(&outside, store.path_for("s1").unwrap()).unwrap();
    assert!(store.session_exists("s1").is_err());
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
    // Reler o arquivo so para achar o pai faz uma sessao de N mensagens
    // custar O(N²) em leitura e em parse, e o append acontece por mensagem
    // e nao por turno.
    let (_dir, store) = store();
    for n in 0..20 {
        store.append("s1", &Message::user(format!("m{n}"))).unwrap();
    }

    assert!(
        store.reads() <= 1,
        "{} leituras completas para 20 mensagens",
        store.reads()
    );
}

#[test]
fn resuming_reads_the_file_once() {
    // `load` lia tudo para achar a ponta e relia tudo para montar o
    // caminho ate ela.
    let (_dir, store) = store();
    for n in 0..5 {
        store.append("s1", &Message::user(format!("m{n}"))).unwrap();
    }

    let recomecada = Store::open(store.dir()).unwrap();
    let carregadas = recomecada.load("s1").unwrap();

    assert_eq!(carregadas.len(), 5);
    assert_eq!(recomecada.reads(), 1, "o arquivo foi lido mais de uma vez");
}

#[test]
fn appending_never_rewrites_earlier_lines() {
    // Se o append virar reescrita, um crash no meio deixa a sessao truncada.
    let (_dir, store) = store();
    store.append("s1", &Message::user("um")).unwrap();
    let after_first = std::fs::read_to_string(store.path_for("s1").unwrap()).unwrap();

    store.append("s1", &Message::user("dois")).unwrap();
    let after_second = std::fs::read_to_string(store.path_for("s1").unwrap()).unwrap();

    assert!(
        after_second.starts_with(&after_first),
        "o prefixo anterior foi alterado"
    );
}

#[test]
fn a_corrupted_line_costs_one_turn_not_the_conversation() {
    // O resultado tipico de um crash no meio da escrita.
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

    let loaded = store.load("s1").unwrap();
    assert_eq!(
        loaded,
        vec![Message::user("antes"), Message::user("depois")]
    );
}

#[test]
fn appending_to_a_session_that_fails_admission_does_not_create_a_new_root() {
    let (_dir, store) = store();
    store.append("s1", &Message::user("antes")).unwrap();
    let path = store.path_for("s1").unwrap();
    let mut record: serde_json::Value =
        serde_json::from_str(std::fs::read_to_string(&path).unwrap().trim()).unwrap();
    record.as_object_mut().unwrap().remove("mac");
    std::fs::write(
        &path,
        format!("{}\n", serde_json::to_string(&record).unwrap()),
    )
    .unwrap();
    let before = std::fs::read_to_string(&path).unwrap();

    assert!(store.append("s1", &Message::user("nao escrever")).is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
    assert_eq!(
        store.records("s1").unwrap_err().to_string(),
        "workspace: registro de sessao v2 sem mac"
    );
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
fn opening_a_symlinked_session_directory_is_refused() {
    use std::os::unix::fs::symlink;

    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("outside");
    let sessions = dir.path().join("sessoes");
    std::fs::create_dir(&target).unwrap();
    symlink(&target, &sessions).unwrap();

    assert!(Store::open(sessions).is_err());
}

#[cfg(unix)]
#[test]
fn opening_a_session_directory_below_a_symlink_is_refused() {
    use std::os::unix::fs::symlink;

    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("outside");
    let link = dir.path().join("link");
    std::fs::create_dir(&target).unwrap();
    symlink(&target, &link).unwrap();

    assert!(Store::open(link.join("sessoes")).is_err());
}

#[cfg(unix)]
#[test]
fn replacing_an_opened_session_directory_cannot_redirect_an_append() {
    use std::os::unix::fs::symlink;

    let dir = tempfile::tempdir().unwrap();
    let sessions = dir.path().join("sessoes");
    let outside = dir.path().join("outside");
    std::fs::create_dir(&outside).unwrap();
    let store = Store::open(&sessions).unwrap();
    let moved = dir.path().join("sessoes-old");
    std::fs::rename(&sessions, &moved).unwrap();
    symlink(&outside, &sessions).unwrap();

    store.append("s1", &Message::user("nao")).unwrap();
    assert!(!outside.join("s1.jsonl").exists());
    assert!(moved.join("s1.jsonl").exists());
}

#[test]
fn session_ids_enforce_the_length_and_character_boundaries() {
    assert!(validate_id("").is_err());
    assert!(validate_id(&"a".repeat(128)).is_ok());
    assert!(validate_id(&"a".repeat(129)).is_err());
    assert!(validate_id("bad!").is_err());
}
