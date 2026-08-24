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
    let after_first = std::fs::read_to_string(store.path_for("s1").unwrap()).unwrap();

    store.append("s1", &Message::user("dois")).unwrap();
    let after_second = std::fs::read_to_string(store.path_for("s1").unwrap()).unwrap();

    assert!(
        after_second.starts_with(&after_first),
        "o prefixo anterior foi alterado"
    );
}

#[test]
fn session_ids_enforce_the_length_and_character_boundaries() {
    assert!(validate_id("").is_err());
    assert!(validate_id(&"a".repeat(128)).is_ok());
    assert!(validate_id(&"a".repeat(129)).is_err());
    assert!(validate_id("bad!").is_err());
}
