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
    let after_first = std::fs::read_to_string(store.path_for("s1")).unwrap();

    store.append("s1", &Message::user("dois")).unwrap();
    let after_second = std::fs::read_to_string(store.path_for("s1")).unwrap();

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
            .open(store.path_for("s1"))
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
fn a_record_from_an_unknown_format_version_is_skipped() {
    let (_dir, store) = store();
    std::fs::write(
        store.path_for("s1"),
        r#"{"v":999,"ts":0,"message":{"role":"user","content":[{"type":"text","text":"futuro"}]}}"#,
    )
    .unwrap();
    assert!(
        store.load("s1").unwrap().is_empty(),
        "versao desconhecida foi interpretada"
    );
}

#[test]
fn every_line_carries_the_format_version() {
    let (_dir, store) = store();
    store.append("s1", &Message::user("x")).unwrap();

    let line = std::fs::read_to_string(store.path_for("s1")).unwrap();
    let record: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
    assert_eq!(record["v"], FORMAT_VERSION);
    assert!(record["ts"].as_u64().unwrap() > 0);
}

#[test]
fn loading_an_unknown_session_is_an_error_not_an_empty_conversation() {
    // Devolver vazio faria o usuario achar que retomou uma sessao e comecar
    // do zero sem perceber.
    let (_dir, store) = store();
    assert!(store.load("nao-existe").is_err());
}

#[test]
fn listing_orders_the_most_recent_first() {
    let (_dir, store) = store();
    store.append("antiga", &Message::user("a")).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    store.append("recente", &Message::user("b")).unwrap();

    let ids: Vec<_> = store.list().unwrap().into_iter().map(|s| s.id).collect();
    assert_eq!(ids.first().map(String::as_str), Some("recente"));
    assert_eq!(store.latest().unwrap().unwrap().id, "recente");
}

#[test]
fn listing_breaks_a_mtime_tie_with_the_newer_id() {
    // `--continue` escolhe `latest()`. No runner do CI os dois appends
    // caem no mesmo segundo e a ordem de `readdir` vence — a sessão
    // antiga volta como se fosse a recente.
    let (_dir, store) = store();
    store
        .append("0000000002", &Message::user("recente"))
        .unwrap();
    store
        .append("0000000001", &Message::user("antiga"))
        .unwrap();
    let tied = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
    for id in ["0000000001", "0000000002"] {
        std::fs::File::open(store.dir().join(format!("{id}.jsonl")))
            .unwrap()
            .set_modified(tied)
            .unwrap();
    }
    assert_eq!(store.latest().unwrap().unwrap().id, "0000000002");
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
