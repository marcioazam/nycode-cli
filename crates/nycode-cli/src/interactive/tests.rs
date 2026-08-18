//! Testes do laço interativo.

use std::sync::Arc;

use clap::Parser as _;
use crossterm::event::KeyCode;
use nycode_agent::Context;
use nycode_ai::anthropic::ContentBlock;

use super::fakes::{Recording, Scripted, ctrl, delivered, key, typing};
use super::*;

fn store() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("sessions")).unwrap();
    (dir, store)
}

/// Roda a sessão com uma lista fixa de eventos.
async fn drive_with(
    events: Vec<Event>,
    turns: Scripted,
) -> (Recording, tempfile::TempDir, Store, String) {
    with_commands(events, turns, Vec::new()).await
}

/// O mesmo, com comandos declarados.
async fn with_commands(
    events: Vec<Event>,
    turns: Scripted,
    commands: Vec<nycode_agent::Command>,
) -> (Recording, tempfile::TempDir, Store, String) {
    let (dir, store) = store();
    let id = "sessao-1".to_owned();
    let mut session =
        Session::with_turns(Box::new(turns), store.clone(), &id).with_commands(commands);

    let mut surface = Recording::new();
    session
        .run(&mut surface, &mut delivered(events))
        .await
        .unwrap();

    (surface, dir, store, id)
}

#[tokio::test]
async fn the_panel_is_drawn_before_the_first_keystroke() {
    // Abrir a sessao sem painel deixaria o usuario sem saber que pode digitar.
    let turns = Scripted::default();
    let (surface, ..) = drive_with(vec![], turns).await;

    assert_eq!(surface.frames.len(), 1);
    assert!(surface.last_frame()[0].starts_with(PROMPT));
}

#[tokio::test]
async fn typing_then_enter_runs_a_turn_with_what_was_typed() {
    let turns = Scripted::default();
    let prompts = turns.prompts.clone();

    let mut events = typing("oi");
    events.push(key(KeyCode::Enter));
    let (surface, ..) = drive_with(events, turns).await;

    assert_eq!(*prompts.lock().unwrap(), vec!["oi".to_owned()]);
    assert!(
        surface.scrollback.contains("oi"),
        "o pedido precisa ficar no scrollback: {}",
        surface.scrollback
    );
}

#[tokio::test]
async fn a_finished_turn_is_persisted_to_the_session_file() {
    // Sem isto, `--continue` na proxima execucao nao encontra nada.
    let turns = Scripted::default();
    let mut events = typing("grave isto");
    events.push(key(KeyCode::Enter));

    let (_surface, _dir, store, id) = drive_with(events, turns).await;

    let saved = store.load(&id).unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].content, vec![ContentBlock::text("grave isto")]);
}

#[tokio::test]
async fn a_turn_after_a_cancelled_one_still_reaches_the_backend() {
    // Ctrl+C interrompe um turno, nao a sessao. Sem rearme o sinal fica preso e
    // o pedido seguinte e aceito, gravado no disco e descartado antes de chegar
    // ao gateway — sem resposta e sem erro, que e a degradacao que NFR-4 proibe.
    let cancel = Cancel::new();
    let turns = super::fakes::CancelAware::new(cancel.clone());
    let prompts = turns.prompts.clone();

    // O turno anterior foi cancelado pelo usuario.
    cancel.cancel();

    let (_dir, store) = store();
    let mut session =
        Session::with_turns(Box::new(turns), store, "sessao-1").with_cancel(cancel.clone());

    let mut events = typing("e agora");
    events.push(key(KeyCode::Enter));
    let mut surface = Recording::new();
    session
        .run(&mut surface, &mut delivered(events))
        .await
        .unwrap();

    assert_eq!(
        *prompts.lock().unwrap(),
        vec!["e agora".to_owned()],
        "o pedido seguinte ao cancelamento precisa chegar ao backend"
    );
    assert!(!cancel.is_cancelled(), "o turno comeca com o sinal intacto");
}

#[tokio::test]
async fn a_failed_turn_is_reported_and_still_persisted() {
    // As ferramentas que rodaram antes da falha ja mudaram o disco.
    let turns = Scripted {
        fail_with: Some("gateway fora do ar".to_owned()),
        ..Scripted::default()
    };
    let mut events = typing("tente");
    events.push(key(KeyCode::Enter));

    let (surface, _dir, store, id) = drive_with(events, turns).await;

    assert!(
        surface.scrollback.contains("gateway fora do ar"),
        "o erro precisa chegar ao usuario: {}",
        surface.scrollback
    );
    assert_eq!(store.load(&id).unwrap().len(), 1);
}

#[tokio::test]
async fn the_footer_accumulates_the_cost_of_each_turn() {
    let turns = Scripted {
        usage: Usage {
            input_tokens: 1000,
            output_tokens: 200,
            cache_read_tokens: 500,
            ..Usage::default()
        },
        ..Scripted::default()
    };

    let mut events = typing("um");
    events.push(key(KeyCode::Enter));
    events.extend(typing("dois"));
    events.push(key(KeyCode::Enter));
    let (surface, ..) = drive_with(events, turns).await;

    let footer = surface.last_frame().last().unwrap();
    assert!(footer.contains("↑2.0k"), "dois turnos somam: {footer}");
    assert!(footer.contains("cache 50%"), "{footer}");
}

#[tokio::test]
async fn control_d_on_an_empty_editor_ends_the_session() {
    let turns = Scripted::default();
    let prompts = turns.prompts.clone();

    let events = vec![ctrl('d'), key(KeyCode::Char('x')), key(KeyCode::Enter)];
    drive_with(events, turns).await;

    assert!(
        prompts.lock().unwrap().is_empty(),
        "nada deveria rodar depois da saida"
    );
}

#[tokio::test]
async fn a_resize_redraws_at_the_new_width() {
    // O quadro anterior foi calculado para outra largura; sem redesenhar,
    // resto dele fica na tela.
    let turns = Scripted::default();
    let (surface, ..) = drive_with(vec![Event::Resize(40, 20)], turns).await;

    assert_eq!(surface.width, 40);
    assert_eq!(
        surface.frames.len(),
        2,
        "o inicial e o do redimensionamento"
    );
    for line in surface.last_frame() {
        assert!(nycode_tui::display_width(line) <= 40, "estourou: {line}");
    }
}

#[tokio::test]
async fn an_event_without_meaning_does_not_redraw() {
    // Redesenhar a cada movimento de mouse faria o painel piscar.
    let turns = Scripted::default();
    let (surface, ..) = drive_with(vec![key(KeyCode::F(7))], turns).await;
    assert_eq!(surface.frames.len(), 1, "so o quadro inicial");
}

#[tokio::test]
async fn a_resumed_session_seeds_the_editor_history() {
    // Sem isto a seta para cima nao devolve nada numa sessao retomada.
    let turns = Scripted {
        history: vec![Message::user("pedido antigo")],
        ..Scripted::default()
    };
    let prompts = turns.prompts.clone();

    drive_with(vec![key(KeyCode::Up), key(KeyCode::Enter)], turns).await;

    assert_eq!(*prompts.lock().unwrap(), vec!["pedido antigo".to_owned()]);
}

#[tokio::test]
async fn a_broken_event_stream_stops_the_session_instead_of_looping() {
    let (_dir, store) = store();
    let mut surface = Recording::new();
    let mut stream = futures_util::stream::iter(vec![Err(std::io::Error::other("tty sumiu"))]);
    let mut session = Session::with_turns(Box::new(Scripted::default()), store, "s");

    let result = session.run(&mut surface, &mut stream).await;

    assert!(result.is_err(), "um erro de leitura precisa sair do laco");
}

#[tokio::test]
async fn the_header_names_what_the_session_loaded_before_the_first_prompt() {
    // O usuario precisa saber, ao abrir, se o AGENTS.md dele foi lido.
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("AGENTS.md"), "convencao").unwrap();
    let root = dir.path().to_path_buf();

    let prepared = crate::session::Prepared {
        phases: crate::session::Phases::default(),
        lifecycle: nycode_agent::policy::Hooks::default(),
        agent: nycode_agent::Agent::new(
            Arc::new(super::fakes::Mute),
            nycode_agent::ToolContext::new(&root).unwrap(),
        ),
        cancel: Cancel::new(),
        store: Store::open(root.join(".nycode/sessions")).unwrap(),
        session_id: "sessao-1".to_owned(),
        model: "modelo-de-teste".to_owned(),
        persisted: 0,
        context: Context::from_sources(&root, None, Some(&root)),
        root,
        mcp: Vec::new(),
        models: Vec::new(),
        prices: std::collections::BTreeMap::new(),
        windows: std::collections::BTreeMap::new(),
        rebuild: Box::new(|_| anyhow::bail!("sem troca de modelo neste teste")),
        sampling: Arc::new(std::sync::Mutex::new(nycode_ai::Sampling::default())),
    };

    let cli = crate::Cli::try_parse_from(["nycode", "--quiet"]).unwrap();
    let mut session = Session::open(prepared, "nylla-sonnet-4.5".to_owned(), false, &cli, 80);
    let mut surface = Recording::new();
    session
        .run(&mut surface, &mut delivered(vec![]))
        .await
        .unwrap();

    assert!(
        surface.scrollback.contains("AGENTS.md"),
        "o cabecalho precisa dizer o que foi carregado: {}",
        surface.scrollback
    );
    assert_eq!(surface.frames.len(), 1, "o painel abre depois do cabecalho");
    assert!(
        surface.last_frame()[1].contains("somente-leitura"),
        "o rodape precisa refletir a permissao: {:?}",
        surface.last_frame()
    );
}

#[tokio::test]
async fn plan_mode_is_a_toggle_and_says_which_way_it_went() {
    let (_dir, store) = store();
    let scripted = Scripted::default();
    let mut session = Session::with_turns(Box::new(scripted), store, "s");

    let mut surface = Recording::new();
    let mut events = typing("/plan");
    events.push(key(KeyCode::Enter));
    events.extend(typing("/plan"));
    events.push(key(KeyCode::Enter));

    session
        .run(&mut surface, &mut delivered(events))
        .await
        .unwrap();

    assert!(
        surface.scrollback.contains("nada sera modificado"),
        "{}",
        surface.scrollback
    );
    assert!(
        surface.scrollback.contains("desligado"),
        "sair precisa ser dito tambem: {}",
        surface.scrollback
    );
}

#[tokio::test]
async fn entering_plan_mode_does_not_spend_a_turn() {
    // E uma mudanca de modo, nao um pedido ao modelo.
    let (_dir, store) = store();
    let scripted = Scripted::default();
    let prompts = scripted.prompts.clone();
    let mut session = Session::with_turns(Box::new(scripted), store, "s");

    let mut events = typing("/plan");
    events.push(key(KeyCode::Enter));
    session
        .run(&mut Recording::new(), &mut delivered(events))
        .await
        .unwrap();

    assert!(prompts.lock().unwrap().is_empty());
}

fn slash(name: &str, template: &str) -> nycode_agent::Command {
    nycode_agent::Command {
        name: name.to_owned(),
        description: "um comando".to_owned(),
        template: template.to_owned(),
        path: std::path::PathBuf::from("/x"),
    }
}

#[tokio::test]
async fn a_slash_command_reaches_the_model_already_expanded() {
    // O modelo nao sabe que existiu um comando: expandir no cliente mantem o
    // vocabulario de wire intacto.
    let turns = Scripted::default();
    let prompts = turns.prompts.clone();

    let mut events = typing("/revisar o modulo de auth");
    events.push(key(KeyCode::Enter));
    with_commands(events, turns, vec![slash("revisar", "Revise: $ARGUMENTS")]).await;

    assert_eq!(
        *prompts.lock().unwrap(),
        vec!["Revise: o modulo de auth".to_owned()]
    );
}

#[tokio::test]
async fn an_unknown_command_does_not_spend_a_turn() {
    // Mandar `/revisr` ao modelo gastaria um turno para descobrir o erro de
    // digitacao.
    let turns = Scripted::default();
    let prompts = turns.prompts.clone();

    let mut events = typing("/revisr");
    events.push(key(KeyCode::Enter));
    let (surface, ..) = with_commands(events, turns, vec![slash("revisar", "Revise")]).await;

    assert!(
        prompts.lock().unwrap().is_empty(),
        "nenhum turno deveria rodar"
    );
    assert!(
        surface.scrollback.contains("/revisar"),
        "precisa listar o que existe: {}",
        surface.scrollback
    );
}

#[tokio::test]
async fn a_workspace_without_commands_says_so_instead_of_listing_nothing() {
    let turns = Scripted::default();
    let mut events = typing("/qualquer");
    events.push(key(KeyCode::Enter));

    let (surface, ..) = with_commands(events, turns, Vec::new()).await;
    assert!(
        surface.scrollback.contains("nenhum comando"),
        "{}",
        surface.scrollback
    );
}

#[tokio::test]
async fn ordinary_text_is_not_treated_as_a_command() {
    let turns = Scripted::default();
    let prompts = turns.prompts.clone();

    let mut events = typing("explique o repositorio");
    events.push(key(KeyCode::Enter));
    with_commands(events, turns, vec![slash("revisar", "Revise")]).await;

    assert_eq!(
        *prompts.lock().unwrap(),
        vec!["explique o repositorio".to_owned()]
    );
}

#[tokio::test]
async fn a_session_carries_the_commands_the_workspace_declares() {
    let (_dir, store) = store();
    let scripted = Scripted::default();
    let prompts = scripted.prompts.clone();
    let mut session = Session::with_turns(Box::new(scripted), store, "sessao-1")
        .with_commands(vec![slash("testes", "Rode a bateria")]);

    let mut surface = Recording::new();
    let mut events = typing("/testes");
    events.push(key(KeyCode::Enter));
    session
        .run(&mut surface, &mut delivered(events))
        .await
        .unwrap();

    assert_eq!(*prompts.lock().unwrap(), vec!["Rode a bateria".to_owned()]);
}

#[tokio::test]
async fn a_session_runs_a_turn_through_its_own_loop() {
    // Prova que `Session` liga cabecalho, painel e laco, e nao so os guarda.
    let (_dir, store) = store();
    let scripted = Scripted::default();
    let prompts = scripted.prompts.clone();
    let mut session = Session::with_turns(Box::new(scripted), store, "sessao-1");

    let mut surface = Recording::new();
    let mut events = typing("oi");
    events.push(key(KeyCode::Enter));
    session
        .run(&mut surface, &mut delivered(events))
        .await
        .unwrap();

    assert_eq!(*prompts.lock().unwrap(), vec!["oi".to_owned()]);
    assert!(format!("{session:?}").contains("sessao-1"));
}

#[tokio::test]
async fn a_queued_follow_up_runs_after_the_turn() {
    let turns = Scripted::default();
    let prompts = turns.prompts.clone();
    let (_dir, store) = store();
    let mut session =
        Session::with_turns(Box::new(turns), store, "sessao-1").pending_follow_up("depois");

    let mut surface = Recording::new();
    let mut events = typing("primeiro");
    events.push(key(KeyCode::Enter));
    session
        .run(&mut surface, &mut delivered(events))
        .await
        .unwrap();

    assert_eq!(
        *prompts.lock().unwrap(),
        vec!["primeiro".to_owned(), "depois".to_owned()]
    );
}
