//! Testes das pecas puras da sessao interativa.
//!
//! Separados do laco porque protegem outra coisa: nao o que a sessao faz com um
//! evento, e sim o que uma tecla significa e o que o painel calcula. Mudam
//! quando o teclado ou a apresentacao mudam, nao quando o laco muda.

use crossterm::event::KeyCode;

use nycode_agent::Context;
use nycode_ai::anthropic::{ContentBlock, Message};

use super::*;
use crate::interactive::fakes::{ctrl, key};
use crate::interactive::{interrupts, loaded, previous_prompts};

fn panel() -> Panel {
    Panel::new(
        "~/proj".to_owned(),
        "sessao-1".to_owned(),
        "nylla-sonnet-4.5".to_owned(),
        true,
        None,
    )
}

/// Um painel cujo modelo tem tarifa declarada pelo catálogo.
fn priced_panel() -> Panel {
    Panel::new(
        "~/proj".to_owned(),
        "sessao-1".to_owned(),
        "nylla-sonnet-4.5".to_owned(),
        true,
        Some(nycode_ai::catalog::Price {
            base: nycode_ai::catalog::Rates {
                input: 3.0,
                output: 15.0,
                cache_read: 0.3,
                cache_write: 3.75,
            },
            tiers: Vec::new(),
        }),
    )
}

#[test]
fn a_priced_model_turns_token_counts_into_a_cost_in_the_footer() {
    // O FR-19 pede custo. Ate a spec 002 o rodape mostrava volume e chamava
    // aquilo de custo — duas grandezas que divergem por ordens de magnitude.
    let mut panel = priced_panel();
    panel.absorb(Usage {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        ..Usage::default()
    });

    let linha = &panel.frame(200)[1];
    assert!(linha.contains("$18.00"), "{linha}");
}

#[test]
fn a_model_without_a_declared_price_shows_no_cost_at_all() {
    // Estimar daria um numero inventado com a mesma cara de um medido.
    let mut panel = panel();
    panel.absorb(Usage {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        ..Usage::default()
    });

    let linha = &panel.frame(200)[1];
    assert!(!linha.contains('$'), "{linha}");
}

#[test]
fn switching_model_switches_the_price_with_it() {
    // Cobrar os turnos do modelo novo a tarifa do antigo daria um numero
    // errado com a mesma cara de um certo.
    let mut panel = priced_panel();
    panel.set_model("outro".to_owned(), None);
    panel.absorb(Usage {
        input_tokens: 1_000_000,
        ..Usage::default()
    });

    assert!(!panel.frame(200)[1].contains('$'));
}

fn typed(editor: &mut Editor, text: &str) {
    for ch in text.chars() {
        editor.apply(Action::Insert(ch));
    }
}

#[test]
fn typing_asks_for_a_redraw_and_enter_submits() {
    let mut editor = Editor::new();
    assert_eq!(step(&key(KeyCode::Char('o')), &mut editor), Step::Redraw);
    assert_eq!(
        step(&key(KeyCode::Enter), &mut editor),
        Step::Submit("o".to_owned())
    );
}

#[test]
fn enter_on_an_empty_editor_does_not_start_a_turn() {
    let mut editor = Editor::new();
    assert_eq!(step(&key(KeyCode::Enter), &mut editor), Step::Idle);
}

#[test]
fn control_d_quits_only_when_there_is_nothing_written() {
    // Sair com texto escrito apagaria trabalho sem confirmacao, e Ctrl+D com
    // texto e quase sempre engano de quem quis apagar para a frente.
    let mut editor = Editor::new();
    typed(&mut editor, "quase pronto");
    assert_eq!(step(&ctrl('d'), &mut editor), Step::Idle);

    editor.apply(Action::Discard);
    assert_eq!(step(&ctrl('d'), &mut editor), Step::Quit);
}

#[test]
fn control_c_outside_a_turn_clears_the_editor_instead_of_quitting() {
    let mut editor = Editor::new();
    typed(&mut editor, "engano");

    assert_eq!(step(&ctrl('c'), &mut editor), Step::Redraw);
    assert!(editor.is_empty());
    assert_eq!(step(&ctrl('c'), &mut editor), Step::Idle);
}

#[test]
fn control_l_redraws_without_touching_the_text() {
    let mut editor = Editor::new();
    typed(&mut editor, "intacto");
    assert_eq!(step(&ctrl('l'), &mut editor), Step::Redraw);
    assert_eq!(editor.text(), "intacto");
}

#[test]
fn a_paste_lands_in_the_editor_in_one_step() {
    let mut editor = Editor::new();
    assert_eq!(
        step(&Event::Paste("um paragrafo".to_owned()), &mut editor),
        Step::Redraw
    );
    assert_eq!(editor.text(), "um paragrafo");
    assert_eq!(step(&Event::Paste(String::new()), &mut editor), Step::Idle);
}

#[test]
fn only_control_c_counts_as_an_interruption() {
    assert!(interrupts(&ctrl('c')));
    assert!(!interrupts(&ctrl('d')));
    assert!(!interrupts(&Event::Resize(80, 24)));
}

#[test]
fn the_panel_shows_the_editor_above_the_footer() {
    let frame = panel().frame(80);
    assert_eq!(frame.len(), 2, "uma linha de editor e uma de rodape");
    assert!(frame[0].starts_with(PROMPT));
    assert!(frame[1].contains("~/proj"));
    assert!(frame[1].contains("nylla-sonnet-4.5"));
}

#[test]
fn the_panel_grows_with_a_multiline_prompt() {
    let mut panel = panel();
    typed(panel.editor_mut(), "uma");
    panel.editor_mut().apply(Action::Newline);
    typed(panel.editor_mut(), "duas");

    assert_eq!(panel.frame(80).len(), 3);
}

#[test]
fn an_estimated_usage_marks_the_whole_session_as_estimated() {
    // Basta um turno heuristico para o total deixar de ser medido.
    let mut panel = panel();
    panel.absorb(Usage {
        input_tokens: 10,
        output_tokens: 1,
        ..Usage::default()
    });
    panel.absorb(Usage {
        input_tokens: 10,
        output_tokens: 1,
        estimated: true,
        ..Usage::default()
    });
    assert!(panel.frame(200)[1].contains("estimado"));
}

#[test]
fn a_resumed_history_yields_prompts_but_not_tool_results() {
    // Resultados de ferramenta chegam como mensagem de usuario; entrariam no
    // historico do editor como lixo se nao fossem filtrados.
    let history = vec![
        Message::user("primeiro pedido"),
        Message::assistant(vec![ContentBlock::text("resposta")]),
        Message::tool_results(vec![ContentBlock::tool_result("t1", "conteudo")]),
        Message::user("segundo pedido"),
    ];
    assert_eq!(
        previous_prompts(&history),
        vec!["primeiro pedido".to_owned(), "segundo pedido".to_owned()]
    );
    assert!(previous_prompts(&[]).is_empty());
}

#[test]
fn the_loaded_summary_names_context_files_relative_to_the_root() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("AGENTS.md"), "convencao").unwrap();
    let skill = dir.path().join(".nycode/skills/revisar");
    std::fs::create_dir_all(&skill).unwrap();
    std::fs::write(
        skill.join("SKILL.md"),
        "---\nname: revisar\ndescription: revisa\n---\ncorpo\n",
    )
    .unwrap();

    let (files, skills) = loaded(&Context::discover(dir.path()), dir.path());
    assert_eq!(files, vec!["AGENTS.md".to_owned()]);
    assert_eq!(skills, vec!["revisar".to_owned()]);
}

#[test]
fn an_empty_workspace_loads_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (files, skills) = loaded(&Context::discover(dir.path()), dir.path());
    assert!(files.is_empty());
    assert!(skills.is_empty());
}
