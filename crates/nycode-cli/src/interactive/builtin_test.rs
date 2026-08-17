//! Comandos embutidos: o que significam e o que fazem com a sessão.
//!
//! Os dois níveis ficam juntos porque mudam juntos: acrescentar um embutido
//! exige decidir o que ele resolve e o que a sessão faz com o efeito.

use crossterm::event::KeyCode;
use nycode_agent::Store;
use nycode_ai::anthropic::{ContentBlock, Message, Role};

use super::{Available, Effect, resolve, summarize};
use crate::interactive::Session;
use crate::interactive::fakes::{Recording, Scripted, delivered, key, typing};

fn store() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("s")).unwrap();
    (dir, store)
}

fn shown(effect: Effect) -> String {
    match effect {
        Effect::Show(text) => text,
        Effect::Fork { shown, .. } => shown,
        other => panic!("esperava texto, veio {other:?}"),
    }
}

#[test]
fn ordinary_text_is_not_a_builtin() {
    let (_dir, store) = store();
    assert_eq!(
        resolve("explique isto", &store, "s", &Available::default()),
        Effect::Passthrough
    );
}

#[test]
fn a_file_command_is_left_for_the_file_resolver() {
    let (_dir, store) = store();
    assert_eq!(
        resolve("/revisar", &store, "s", &Available::default()),
        Effect::Passthrough
    );
}

#[test]
fn help_lists_the_builtins_and_the_workspace_commands() {
    let (_dir, store) = store();
    let text = shown(resolve(
        "/help",
        &store,
        "s",
        &Available {
            commands: &["revisar".to_owned()],
            models: &[],
        },
    ));

    assert!(text.contains("/tree"), "{text}");
    assert!(text.contains("/fork"), "{text}");
    assert!(text.contains("/revisar"), "{text}");
}

#[test]
fn help_without_workspace_commands_does_not_promise_any() {
    let (_dir, store) = store();
    let text = shown(resolve("/help", &store, "s", &Available::default()));
    assert!(!text.contains("deste workspace"), "{text}");
}

#[test]
fn the_tree_of_an_empty_session_says_it_is_empty() {
    // Uma listagem vazia faria o usuario achar que o comando falhou.
    let (_dir, store) = store();
    let text = shown(resolve("/tree", &store, "s", &Available::default()));
    assert!(text.contains("nada gravado"), "{text}");
}

#[test]
fn the_tree_numbers_the_user_turns() {
    let (_dir, store) = store();
    store
        .append("s", &Message::user("primeiro pedido"))
        .unwrap();
    store
        .append(
            "s",
            &Message::assistant(vec![ContentBlock::text("resposta")]),
        )
        .unwrap();
    store.append("s", &Message::user("segundo pedido")).unwrap();

    let text = shown(resolve("/tree", &store, "s", &Available::default()));
    assert!(text.contains("1  primeiro pedido"), "{text}");
    assert!(text.contains("2  segundo pedido"), "{text}");
    assert!(!text.contains("resposta"), "so turnos do usuario: {text}");
}

#[test]
fn a_tool_result_is_not_offered_as_a_resume_point() {
    // Ramificar dali deixaria um `tool_use` sem o `tool_result` par, e o
    // backend recusa a conversa.
    let (_dir, store) = store();
    store.append("s", &Message::user("pedido")).unwrap();
    store
        .append(
            "s",
            &Message {
                role: Role::User,
                content: vec![ContentBlock::tool_result("t1", "saida")],
                discarded: false,
            },
        )
        .unwrap();

    let text = shown(resolve("/tree", &store, "s", &Available::default()));
    assert!(text.contains("1  pedido"), "{text}");
    assert!(!text.contains("  2  "), "so um ponto: {text}");
}

#[test]
fn forking_names_the_point_it_resumed_from() {
    let (_dir, store) = store();
    store.append("s", &Message::user("primeiro")).unwrap();
    store.append("s", &Message::user("segundo")).unwrap();

    match resolve("/fork 1", &store, "s", &Available::default()) {
        Effect::Fork { shown, record_id } => {
            assert!(shown.contains("primeiro"), "{shown}");
            assert!(!record_id.is_empty());
        }
        other => panic!("esperava fork, veio {other:?}"),
    }
}

#[test]
fn forking_to_a_point_that_does_not_exist_says_how_many_there_are() {
    let (_dir, store) = store();
    store.append("s", &Message::user("um")).unwrap();

    let text = shown(resolve("/fork 9", &store, "s", &Available::default()));
    assert!(text.contains("nao existe"), "{text}");
    assert!(text.contains("1 pontos"), "{text}");
}

#[test]
fn forking_without_a_number_explains_what_is_missing() {
    let (_dir, store) = store();
    let text = shown(resolve("/fork", &store, "s", &Available::default()));
    assert!(text.contains("numero"), "{text}");
}

#[test]
fn forking_to_zero_is_refused_rather_than_wrapping_around() {
    // `0 - 1` num indice sem sinal daria a volta e escolheria o ultimo.
    let (_dir, store) = store();
    store.append("s", &Message::user("um")).unwrap();
    let text = shown(resolve("/fork 0", &store, "s", &Available::default()));
    assert!(text.contains("nao existe"), "{text}");
}

#[test]
fn compact_and_quit_are_actions_not_text() {
    let (_dir, store) = store();
    assert_eq!(
        resolve("/compact", &store, "s", &Available::default()),
        Effect::Compact
    );
    assert_eq!(
        resolve("/quit", &store, "s", &Available::default()),
        Effect::Quit
    );
    assert_eq!(
        resolve("/exit", &store, "s", &Available::default()),
        Effect::Quit
    );
}

#[test]
fn export_renders_the_conversation_as_markdown() {
    let (_dir, store) = store();
    store.append("s", &Message::user("qual a hora")).unwrap();
    store
        .append("s", &Message::assistant(vec![ContentBlock::text("tres")]))
        .unwrap();

    let text = shown(resolve("/export", &store, "s", &Available::default()));
    assert!(text.contains("## usuario"), "{text}");
    assert!(text.contains("qual a hora"), "{text}");
    assert!(text.contains("## nycode"), "{text}");
    assert!(text.contains("tres"), "{text}");
}

#[test]
fn export_of_an_empty_session_says_so() {
    let (_dir, store) = store();
    let text = shown(resolve("/export", &store, "s", &Available::default()));
    assert!(text.contains("nada gravado"), "{text}");
}

#[test]
fn a_tool_call_appears_in_the_export_without_its_arguments() {
    // O texto exportado e para ler; argumentos de ferramenta poluem sem
    // acrescentar o que o leitor procura.
    let (_dir, store) = store();
    store
        .append(
            "s",
            &Message::assistant(vec![ContentBlock::ToolUse {
                id: "t1".to_owned(),
                name: "bash".to_owned(),
                input: serde_json::json!({ "command": "ls" }),
            }]),
        )
        .unwrap();

    let text = shown(resolve("/export", &store, "s", &Available::default()));
    assert!(text.contains("chamou `bash`"), "{text}");
}

#[test]
fn a_long_turn_is_summarized_to_one_line() {
    let long = "palavra ".repeat(50);
    let summary = summarize(&long);
    assert!(summary.chars().count() <= 70, "{summary}");
    assert!(summary.ends_with("..."), "{summary}");
}

#[test]
fn a_multiline_turn_becomes_one_line() {
    // Uma quebra de linha no meio destruiria o alinhamento da listagem.
    assert_eq!(summarize("uma\nlinha\n  e outra"), "uma linha e outra");
}

/// Digita cada linha seguida de Enter numa sessão com histórico semeado.
async fn session_typing(lines: &[&str], history: Vec<Message>) -> (Recording, Store, String) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("s")).unwrap();
    let id = "sessao-1".to_owned();
    for message in &history {
        store.append(&id, message).unwrap();
    }

    let scripted = Scripted {
        history,
        ..Scripted::default()
    };
    let mut session = Session::with_turns(Box::new(scripted), store.clone(), &id);

    let mut events = Vec::new();
    for line in lines {
        events.extend(typing(line));
        events.push(key(KeyCode::Enter));
    }

    let mut surface = Recording::new();
    session
        .run(&mut surface, &mut delivered(events))
        .await
        .unwrap();

    // A pasta precisa sobreviver ao `store`, que ainda sera lido.
    std::mem::forget(dir);
    (surface, store, id)
}

fn with_models(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|id| (*id).to_owned()).collect()
}

#[test]
fn model_without_an_argument_lists_what_the_endpoint_serves() {
    // Trocar exige saber o que existe; o usuario nao tem como adivinhar o
    // identificador que o endpoint aceita.
    let (_dir, store) = store();
    let models = with_models(&["nylla-sonnet-4.5", "nylla-opus-4"]);
    let text = shown(resolve(
        "/model",
        &store,
        "s",
        &Available {
            commands: &[],
            models: &models,
        },
    ));

    assert!(text.contains("nylla-sonnet-4.5"), "{text}");
    assert!(text.contains("nylla-opus-4"), "{text}");
}

#[test]
fn model_switches_to_one_the_endpoint_serves() {
    let (_dir, store) = store();
    let models = with_models(&["nylla-opus-4"]);
    assert_eq!(
        resolve(
            "/model nylla-opus-4",
            &store,
            "s",
            &Available {
                commands: &[],
                models: &models,
            }
        ),
        Effect::SwitchModel("nylla-opus-4".to_owned())
    );
}

#[test]
fn model_refuses_an_id_the_endpoint_does_not_serve() {
    // Aceitar so falharia no proximo turno, quando o gateway recusasse, longe
    // da causa.
    let (_dir, store) = store();
    let models = with_models(&["nylla-opus-4"]);
    let text = shown(resolve(
        "/model inventado",
        &store,
        "s",
        &Available {
            commands: &[],
            models: &models,
        },
    ));

    assert!(text.contains("nao serve `inventado`"), "{text}");
}

#[test]
fn model_without_a_catalog_says_the_list_is_unknown() {
    // Sem catalogo nao da para validar; dizer isso e melhor que listar vazio.
    let (_dir, store) = store();
    let text = shown(resolve("/model", &store, "s", &Available::default()));
    assert!(text.contains("nenhum modelo conhecido"), "{text}");
}

#[test]
fn without_a_catalog_any_id_is_accepted_rather_than_blocked() {
    // Recusar com base numa lista que nao foi obtida transformaria a
    // indisponibilidade do catalogo em erro de uso.
    let (_dir, store) = store();
    assert_eq!(
        resolve("/model qualquer", &store, "s", &Available::default()),
        Effect::SwitchModel("qualquer".to_owned())
    );
}

#[tokio::test]
async fn switching_the_model_shows_it_in_the_footer() {
    let (_dir, store) = store();
    let scripted = Scripted::default();
    let mut session = Session::with_turns(Box::new(scripted), store, "s");

    let mut events = typing("/model nylla-opus-4");
    events.push(key(KeyCode::Enter));
    let mut surface = Recording::new();
    session
        .run(&mut surface, &mut delivered(events))
        .await
        .unwrap();

    assert!(
        surface.scrollback.contains("modelo agora: nylla-opus-4"),
        "{}",
        surface.scrollback
    );
    assert!(
        surface
            .last_frame()
            .last()
            .unwrap()
            .contains("nylla-opus-4"),
        "o rodape precisa refletir a troca: {:?}",
        surface.last_frame()
    );
}

#[tokio::test]
async fn help_reaches_the_screen_without_spending_a_turn() {
    let (surface, ..) = session_typing(&["/help"], Vec::new()).await;
    assert!(
        surface.scrollback.contains("/tree"),
        "{}",
        surface.scrollback
    );
}

#[tokio::test]
async fn tree_lists_the_turns_of_the_session_on_screen() {
    let history = vec![Message::user("primeiro pedido")];
    let (surface, ..) = session_typing(&["/tree"], history).await;
    assert!(
        surface.scrollback.contains("primeiro pedido"),
        "{}",
        surface.scrollback
    );
}

#[tokio::test]
async fn forking_names_the_point_the_session_went_back_to() {
    let history = vec![
        Message::user("primeiro"),
        Message::assistant(vec![ContentBlock::text("resposta")]),
        Message::user("segundo"),
    ];
    let (surface, ..) = session_typing(&["/fork 1"], history).await;

    assert!(
        surface.scrollback.contains("retomando de: primeiro"),
        "{}",
        surface.scrollback
    );
}

#[tokio::test]
async fn a_turn_after_a_fork_hangs_off_the_point_that_was_chosen() {
    // Sem isto o ramo novo continuaria a ponta antiga e a arvore nao existiria.
    let history = vec![Message::user("primeiro"), Message::user("segundo")];
    let (_surface, store, id) = session_typing(&["/fork 1", "novo rumo"], history).await;

    let texts: Vec<String> = store
        .load(&id)
        .unwrap()
        .iter()
        .filter_map(|m| match m.content.first() {
            Some(ContentBlock::Text { text }) => Some(text.clone()),
            _ => None,
        })
        .collect();

    assert!(texts.contains(&"primeiro".to_owned()), "{texts:?}");
    assert!(texts.contains(&"novo rumo".to_owned()), "{texts:?}");
    assert!(
        texts.iter().any(|text| text.contains("ramo abandonado")),
        "o ramo abandonado precisa de aviso no caminho novo: {texts:?}"
    );
    assert!(
        !texts.contains(&"segundo".to_owned()),
        "o ramo abandonado nao pode voltar ao caminho ativo: {texts:?}"
    );
}

#[tokio::test]
async fn compacting_by_hand_says_how_much_was_dropped() {
    let history = vec![
        Message::user("um"),
        Message::user("dois"),
        Message::user("tres"),
    ];
    let (surface, ..) = session_typing(&["/compact"], history).await;
    assert!(
        surface.scrollback.contains("compactadas"),
        "{}",
        surface.scrollback
    );
}

#[tokio::test]
async fn quit_ends_the_session_without_reading_what_comes_after() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("s")).unwrap();
    let scripted = Scripted::default();
    let prompts = scripted.prompts.clone();
    let mut session = Session::with_turns(Box::new(scripted), store, "s");

    let mut events = typing("/quit");
    events.push(key(KeyCode::Enter));
    events.extend(typing("nao deveria rodar"));
    events.push(key(KeyCode::Enter));

    session
        .run(&mut Recording::new(), &mut delivered(events))
        .await
        .unwrap();

    assert!(prompts.lock().unwrap().is_empty());
}
