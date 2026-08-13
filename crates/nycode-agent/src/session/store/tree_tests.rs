//! A sessão como árvore (FR-14, ADR-0006).
//!
//! Separado dos testes de persistência porque protege outra coisa: não que uma
//! linha sobreviva a um crash, e sim que dois ramos coexistam no mesmo arquivo
//! sem que um contamine a leitura do outro.

#![allow(clippy::unwrap_used, clippy::panic)]

use nycode_ai::anthropic::Message;

use super::{FORMAT_VERSION, Record, Store};

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
fn a_v1_file_without_identifiers_still_reads_as_a_conversation() {
    // Uma sessao gravada antes da v2 nao pode virar ilegivel: seria perder a
    // conversa por causa de uma mudanca de formato.
    let (_dir, store) = store();
    let path = store.path_for("antiga");
    let lines = [
        r#"{"v":1,"ts":1,"message":{"role":"user","content":[{"type":"text","text":"um"}]}}"#,
        r#"{"v":1,"ts":2,"message":{"role":"user","content":[{"type":"text","text":"dois"}]}}"#,
    ];
    std::fs::write(&path, lines.join("\n")).unwrap();

    assert_eq!(texts(&store.load("antiga").unwrap()), vec!["um", "dois"]);
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
    let record = Record {
        v: FORMAT_VERSION,
        ts: 1,
        id: Some("filho".to_owned()),
        parent_id: Some("pai-inexistente".to_owned()),
        message: Message::user("sozinho"),
    };
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
            serde_json::to_string(&Record {
                v: FORMAT_VERSION,
                ts: 1,
                id: Some((*id).to_owned()),
                parent_id: Some((*parent).to_owned()),
                message: Message::user(*id),
            })
            .unwrap()
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
