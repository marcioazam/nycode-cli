//! A sessão como árvore (FR-14, ADR-0006).
//!
//! Separado dos testes de persistência porque protege outra coisa: não que uma
//! linha sobreviva a um crash, e sim que dois ramos coexistam no mesmo arquivo
//! sem que um contamine a leitura do outro.

#![allow(clippy::unwrap_used, clippy::panic)]

use nycode_ai::anthropic::Message;

use super::{FORMAT_VERSION, Record, Store, now_millis};

fn store() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("sessions")).unwrap();
    (dir, store)
}

fn texts(messages: &[Message]) -> Vec<String> {
    messages
        .iter()
        .map(|m| match m.content.first() {
            Some(nycode_ai::anthropic::ContentBlock::Text { text }) => text.clone(),
            other => format!("{other:?}"),
        })
        .collect()
}

#[test]
fn a_linear_session_reads_back_in_order() {
    let (_dir, store) = store();
    store.append("s", &Message::user("um")).unwrap();
    store.append("s", &Message::user("dois")).unwrap();

    assert_eq!(texts(&store.load("s").unwrap()), vec!["um", "dois"]);
}

#[test]
fn a_session_id_cannot_escape_the_store_directory() {
    let (dir, store) = store();

    assert!(store.append("../escape", &Message::user("nao")).is_err());
    assert!(!dir.path().join("escape.jsonl").exists());
}

#[test]
fn session_ids_accept_the_boundary_and_reject_invalid_values() {
    assert!(super::guard::validate_id(&"a".repeat(128)).is_ok());
    assert!(super::guard::validate_id(&"a".repeat(129)).is_err());
    assert!(super::guard::validate_id("a/b").is_err());
    assert!(super::guard::validate_id("").is_err());
}

#[test]
fn independent_store_instances_keep_the_append_chain_consistent() {
    let (_dir, store_a) = store();
    let store_b = Store::open(store_a.dir()).unwrap();

    store_a.append("s", &Message::user("raiz")).unwrap();
    store_b.append("s", &Message::user("b")).unwrap();
    store_a.append("s", &Message::user("a")).unwrap();

    let records = store_a.records("s").unwrap();
    assert_eq!(records.len(), 3);
    assert_eq!(records[1].parent_id, records[0].id);
    assert_eq!(records[2].parent_id, records[1].id);
}

#[test]
fn every_record_gets_an_identifier_of_its_own() {
    // Sem identificador nao ha o que apontar, e a arvore vira lista.
    let (_dir, store) = store();
    store.append("s", &Message::user("um")).unwrap();
    store.append("s", &Message::user("dois")).unwrap();

    let ids: Vec<_> = store
        .records("s")
        .unwrap()
        .into_iter()
        .filter_map(|r| r.id)
        .collect();
    assert_eq!(ids.len(), 2);
    assert_ne!(
        ids[0], ids[1],
        "dois registros no mesmo milissegundo colidiriam"
    );
}

#[test]
fn each_record_points_at_the_one_before_it() {
    let (_dir, store) = store();
    store.append("s", &Message::user("um")).unwrap();
    store.append("s", &Message::user("dois")).unwrap();

    let records = store.records("s").unwrap();
    assert_eq!(records[0].parent_id, None, "o primeiro e raiz");
    assert_eq!(records[1].parent_id, records[0].id);
}

#[test]
fn branching_from_the_middle_does_not_rewrite_anything() {
    // O arquivo continua append-only: a ramificacao existe porque dois
    // registros passam a compartilhar o mesmo pai.
    let (_dir, store) = store();
    store.append("s", &Message::user("comum")).unwrap();
    let fork_point = store.tip("s").unwrap();
    store.append("s", &Message::user("ramo A")).unwrap();

    let before = std::fs::read_to_string(store.path_for("s")).unwrap();
    store
        .append_child("s", Some(&fork_point), &Message::user("ramo B"))
        .unwrap();
    let after = std::fs::read_to_string(store.path_for("s")).unwrap();

    assert!(after.starts_with(&before), "nada foi reescrito");
}

#[test]
fn the_active_path_is_the_one_that_leads_to_the_last_record() {
    // Devolver o arquivo inteiro mandaria ramos abandonados ao modelo como se
    // fossem parte da conversa.
    let (_dir, store) = store();
    store.append("s", &Message::user("comum")).unwrap();
    let fork_point = store.tip("s").unwrap();
    store.append("s", &Message::user("ramo A")).unwrap();
    store
        .append_child("s", Some(&fork_point), &Message::user("ramo B"))
        .unwrap();

    assert_eq!(texts(&store.load("s").unwrap()), vec!["comum", "ramo B"]);
}

#[test]
fn an_abandoned_branch_is_still_readable_by_its_own_tip() {
    // E o que torna a ramificacao util: o ramo antigo nao se perde.
    let (_dir, store) = store();
    store.append("s", &Message::user("comum")).unwrap();
    let fork_point = store.tip("s").unwrap();
    store.append("s", &Message::user("ramo A")).unwrap();
    let branch_a = store.tip("s").unwrap();
    store
        .append_child("s", Some(&fork_point), &Message::user("ramo B"))
        .unwrap();

    assert_eq!(
        texts(&store.path_to("s", &branch_a).unwrap()),
        vec!["comum", "ramo A"]
    );
}

#[test]
fn reconstruction_stops_at_a_compaction_marker() {
    // O marcador e autocontido: o que veio antes ja esta dentro, e reler o
    // historico anterior recolocaria na janela o que a compactacao tirou.
    let (_dir, store) = store();
    store.append("s", &Message::user("tarefa")).unwrap();
    store.append("s", &Message::user("meio")).unwrap();
    store
        .append("s", &Message::user("[historico anterior compactado]"))
        .unwrap();
    store.append("s", &Message::user("depois")).unwrap();

    assert_eq!(
        texts(&store.load("s").unwrap()),
        vec!["[historico anterior compactado]", "depois"]
    );
}

#[test]
fn a_branch_notice_does_not_drop_the_shared_prefix() {
    // O aviso descreve o que ficou para trás; o ponto do fork continua no
    // caminho. Parar a reconstrução nele apagaria a tarefa original.
    let (_dir, store) = store();
    store.append("s", &Message::user("comum")).unwrap();
    let fork = store.tip("s").unwrap();
    store.append("s", &Message::user("exploracao")).unwrap();
    store
        .append_child(
            "s",
            Some(&fork),
            &Message::user(
                "[ramo abandonado; o que aconteceu nele continua valendo como contexto]",
            ),
        )
        .unwrap();
    store.append("s", &Message::user("depois")).unwrap();

    let loaded = texts(&store.load("s").unwrap());
    assert_eq!(loaded[0], "comum");
    assert!(
        loaded.iter().any(|text| text.contains("ramo abandonado")),
        "{loaded:?}"
    );
    assert!(loaded.iter().any(|text| text == "depois"), "{loaded:?}");
    assert!(
        !loaded.iter().any(|text| text == "exploracao"),
        "{loaded:?}"
    );
}

#[test]
fn a_branch_continues_from_where_it_was_resumed() {
    let (_dir, store) = store();
    store.append("s", &Message::user("comum")).unwrap();
    let fork_point = store.tip("s").unwrap();
    store.append("s", &Message::user("ramo A")).unwrap();
    store
        .append_child("s", Some(&fork_point), &Message::user("ramo B"))
        .unwrap();
    store.append("s", &Message::user("segue B")).unwrap();

    assert_eq!(
        texts(&store.load("s").unwrap()),
        vec!["comum", "ramo B", "segue B"]
    );
}

#[test]
fn a_v1_file_without_identifiers_is_rejected_explicitly() {
    let (_dir, store) = store();
    let path = store.path_for("antiga");
    let lines = [
        r#"{"v":1,"ts":1,"message":{"role":"user","content":[{"type":"text","text":"um"}]}}"#,
        r#"{"v":1,"ts":2,"message":{"role":"user","content":[{"type":"text","text":"dois"}]}}"#,
    ];
    std::fs::write(&path, lines.join("\n")).unwrap();

    assert!(
        store.load("antiga").is_err(),
        "v1 sem mac deve falhar explicitamente"
    );
}

#[test]
fn appending_to_a_v1_session_keeps_the_legacy_error_explicit() {
    let (_dir, store) = store();
    let path = store.path_for("antiga");
    let lines = [
        r#"{"v":1,"ts":1,"message":{"role":"user","content":[{"type":"text","text":"um"}]}}"#,
        r#"{"v":1,"ts":2,"message":{"role":"user","content":[{"type":"text","text":"dois"}]}}"#,
    ];
    std::fs::write(&path, format!("{}\n", lines.join("\n"))).unwrap();

    store
        .append("antiga", &Message::user("tres"))
        .expect("acrescentar a uma sessao v1");

    assert!(store.load("antiga").is_err());
}

#[test]
fn appending_repeatedly_to_a_v1_session_keeps_the_legacy_error_explicit() {
    let (_dir, store) = store();
    let path = store.path_for("antiga");
    std::fs::write(
        &path,
        "{\"v\":1,\"ts\":1,\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"um\"}]}}\n",
    )
    .unwrap();

    for texto in ["dois", "tres"] {
        store.append("antiga", &Message::user(texto)).unwrap();
    }

    assert!(store.load("antiga").is_err());
}

#[test]
fn a_record_from_a_future_version_is_ignored_rather_than_guessed_at() {
    let (_dir, store) = store();
    let path = store.path_for("futura");
    std::fs::write(
        &path,
        format!(
            r#"{{"v":{},"ts":1,"message":{{"role":"user","content":[{{"type":"text","text":"?"}}]}}}}"#,
            FORMAT_VERSION + 1
        ),
    )
    .unwrap();

    assert!(store.load("futura").unwrap().is_empty());
}

#[test]
fn a_parent_that_does_not_exist_stops_the_walk_instead_of_hanging() {
    let (_dir, store) = store();
    let path = store.path_for("orfa");
    let mut record = Record {
        v: FORMAT_VERSION,
        ts: now_millis(),
        id: Some("filho".to_owned()),
        parent_id: Some("pai-inexistente".to_owned()),
        message: Message::user("sozinho"),
        mac: None,
    };
    record.mac = Some(store.mac.sign(&record).unwrap());
    std::fs::write(&path, serde_json::to_string(&record).unwrap()).unwrap();

    assert_eq!(texts(&store.load("orfa").unwrap()), vec!["sozinho"]);
}

#[test]
fn a_cycle_in_the_parents_does_not_hang_the_read() {
    // Um arquivo editado a mao pode fechar um ciclo; ler ate o fim do arquivo
    // e melhor que pendurar o processo.
    let (_dir, store) = store();
    let path = store.path_for("ciclo");
    let lines: Vec<String> = [("a", "b"), ("b", "a")]
        .iter()
        .map(|(id, parent)| {
            let mut record = Record {
                v: FORMAT_VERSION,
                ts: now_millis(),
                id: Some((*id).to_owned()),
                parent_id: Some((*parent).to_owned()),
                message: Message::user(*id),
                mac: None,
            };
            record.mac = Some(store.mac.sign(&record).unwrap());
            serde_json::to_string(&record).unwrap()
        })
        .collect();
    std::fs::write(&path, lines.join("\n")).unwrap();

    let loaded = store.load("ciclo").unwrap();
    assert!(loaded.len() <= 3, "a leitura precisa terminar: {loaded:?}");
}

#[test]
fn the_tip_of_a_session_that_does_not_exist_is_nothing() {
    let (_dir, store) = store();
    assert_eq!(store.tip("nao-existe"), None);
}

#[test]
fn a_path_to_a_record_that_does_not_exist_is_empty() {
    let (_dir, store) = store();
    store.append("s", &Message::user("um")).unwrap();
    assert!(store.path_to("s", "inventado").unwrap().is_empty());
}
