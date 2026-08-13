//! O que a posse do terminal produz, verificado sem um TTY.
//!
//! Separado do módulo porque é o volume: a apresentação e o turno são
//! testáveis com um `Vec<u8>` e um backend de mentira, e são muitos casos.

use std::sync::Arc;

use nycode_agent::{Agent, Cancel};
use nycode_ai::anthropic::Message;

use super::*;

fn translated(chunks: &[&str]) -> String {
    let mut writer = Crlf::new(Vec::new());
    for chunk in chunks {
        writer.write_all(chunk.as_bytes()).unwrap();
    }
    String::from_utf8(writer.into_inner()).unwrap()
}

#[test]
fn a_newline_becomes_a_carriage_return_and_newline() {
    // Sem isto, em modo bruto o texto sai em escada.
    assert_eq!(translated(&["a\nb"]), "a\r\nb");
}

#[test]
fn text_without_newlines_passes_through_untouched() {
    assert_eq!(translated(&["sem quebra"]), "sem quebra");
}

#[test]
fn an_existing_carriage_return_is_not_duplicated() {
    // Emitir `\r\r\n` deixaria uma linha em branco a cada quebra.
    assert_eq!(translated(&["a\r\nb"]), "a\r\nb");
}

#[test]
fn consecutive_newlines_each_get_their_own_return() {
    assert_eq!(translated(&["a\n\nb"]), "a\r\n\r\nb");
}

#[test]
fn a_leading_newline_is_translated() {
    assert_eq!(translated(&["\na"]), "\r\na");
}

#[test]
fn a_trailing_newline_is_translated() {
    assert_eq!(translated(&["a\n"]), "a\r\n");
}

#[test]
fn translation_survives_being_split_across_writes() {
    // O texto do modelo chega em fragmentos arbitrarios; a traducao nao
    // pode depender de a quebra vir inteira num deles.
    assert_eq!(translated(&["a", "\n", "b"]), "a\r\nb");
}

#[test]
fn the_reported_count_is_the_input_length_not_the_output() {
    // Reportar os bytes de saida faria `write_all` acreditar que escreveu
    // mais do que pediram e cortar o proximo fragmento.
    let mut writer = Crlf::new(Vec::new());
    assert_eq!(writer.write(b"a\nb").unwrap(), 3);
}

#[test]
fn the_panel_writes_the_frame_with_raw_mode_line_endings() {
    let mut panel = Panel::new(Vec::new(), 80);
    panel.draw(&["linha".to_owned()]).unwrap();

    assert_eq!(panel.width(), 80);
    let written = String::from_utf8_lossy(panel.written()).to_string();
    assert!(written.contains("linha"), "{written}");
    assert!(
        written.contains("\u{1b}[?2026h"),
        "o desenho precisa vir em saida sincronizada (ADR-0008): {written:?}"
    );
}

#[test]
fn an_unchanged_frame_writes_nothing_through_the_panel() {
    // E a razao de existir do renderizador diferencial; perde-la aqui
    // faria o painel piscar a cada delta de token.
    let mut panel = Panel::new(Vec::new(), 80);
    let frame = vec!["igual".to_owned()];
    panel.draw(&frame).unwrap();

    let before = panel.written().len();
    panel.draw(&frame).unwrap();
    assert_eq!(panel.written().len(), before);
}

#[test]
fn emitting_to_the_scrollback_translates_line_endings() {
    let mut panel = Panel::new(Vec::new(), 80);
    panel.emit("uma\nduas\n").unwrap();

    let written = String::from_utf8_lossy(panel.written()).to_string();
    assert_eq!(written, "uma\r\nduas\r\n");
}

#[test]
fn what_goes_to_the_scrollback_cannot_repaint_what_is_already_there() {
    // O scrollback recebe conteudo que o harness nao escreveu: o que `/tree`
    // mostra, o erro que carrega saida de comando, o que foi enfileirado. Com o
    // escape intacto esse texto sobe linhas e escreve por cima do que ja estava
    // ali — que pode ter sido a pergunta de aprovacao.
    let mut panel = Panel::new(Vec::new(), 80);
    panel
        .emit("\u{1b}[3A\u{1b}[2Kaprovar bash? (s/n)\n")
        .unwrap();

    let written = String::from_utf8_lossy(panel.written()).to_string();
    assert!(!written.contains('\u{1b}'), "{written:?}");
    assert_eq!(written, "aprovar bash? (s/n)\r\n");
}

#[test]
fn resizing_changes_the_reported_width() {
    let mut panel = Panel::new(Vec::new(), 80);
    panel.resize(40);
    assert_eq!(panel.width(), 40);
}

#[test]
fn the_detected_width_is_usable_even_without_a_terminal() {
    assert!(detect_width() > 0);
}

/// Backend de mentira, para exercitar `Agentic` sem rede.
#[derive(Debug)]
struct Canned {
    events: std::sync::Mutex<Vec<Vec<nycode_ai::StreamEvent>>>,
}

#[async_trait::async_trait]
impl nycode_agent::Backend for Canned {
    async fn stream(
        &self,
        _messages: Vec<Message>,
        _system: Option<String>,
        _tools: Vec<nycode_ai::anthropic::ToolSpec>,
    ) -> nycode_ai::Result<nycode_agent::backend::EventStream> {
        let turn = self.events.lock().unwrap().pop().unwrap_or_default();
        Ok(Box::pin(futures_util::stream::iter(
            turn.into_iter().map(Ok),
        )))
    }
}

fn agentic(events: Vec<nycode_ai::StreamEvent>, persisted: usize) -> (tempfile::TempDir, Agentic) {
    with_cancel(events, persisted, &Cancel::new())
}

fn with_cancel(
    events: Vec<nycode_ai::StreamEvent>,
    persisted: usize,
    cancel: &Cancel,
) -> (tempfile::TempDir, Agentic) {
    let dir = tempfile::tempdir().unwrap();
    let ctx = nycode_agent::ToolContext::new(dir.path()).unwrap();
    let backend = std::sync::Arc::new(Canned {
        events: std::sync::Mutex::new(vec![events]),
    });
    let agent = Agent::new(backend, ctx).with_cancel(cancel.clone());
    (dir, Agentic::new(agent, persisted, true))
}

fn plain_turn(text: &str, usage: nycode_ai::Usage) -> Vec<nycode_ai::StreamEvent> {
    vec![
        nycode_ai::StreamEvent::TextDelta(text.to_owned()),
        nycode_ai::StreamEvent::Usage(usage),
        nycode_ai::StreamEvent::MessageEnd {
            stop_reason: nycode_ai::StopReason::EndTurn,
        },
    ]
}

#[tokio::test]
async fn a_turn_reports_the_usage_the_gateway_sent() {
    // E o numero que alimenta o rodape; perde-lo esconde o custo.
    let usage = Usage {
        input_tokens: 120,
        output_tokens: 30,
        cache_read_tokens: 60,
        ..Usage::default()
    };
    let (_dir, mut turns) = agentic(plain_turn("pronto", usage), 0);

    assert_eq!(turns.run("oi").await.unwrap(), usage);
}

#[tokio::test]
async fn draining_yields_each_message_exactly_once() {
    // Entregar duas vezes duplicaria a conversa no arquivo de sessao.
    let (_dir, mut turns) = agentic(plain_turn("pronto", Usage::default()), 0);
    turns.run("oi").await.unwrap();

    let first = turns.drain();
    assert_eq!(first.len(), 2, "o pedido e a resposta");
    assert!(turns.drain().is_empty(), "nada novo desde a ultima coleta");
}

#[tokio::test]
async fn a_resumed_session_does_not_rewrite_what_was_already_on_disk() {
    let (_dir, mut turns) = agentic(plain_turn("pronto", Usage::default()), 0);
    turns.run("oi").await.unwrap();
    let already = turns.history().len();

    // Um `Agentic` novo apontando para o mesmo ponto nao reentrega nada.
    let (_dir2, mut resumed) = agentic(plain_turn("x", Usage::default()), already);
    assert!(resumed.drain().is_empty());
}

#[tokio::test]
async fn the_history_is_what_seeds_a_resumed_editor() {
    let (_dir, mut turns) = agentic(plain_turn("pronto", Usage::default()), 0);
    assert!(turns.history().is_empty());
    turns.run("um pedido").await.unwrap();
    assert_eq!(
        crate::interactive::previous_prompts(&turns.history()),
        vec!["um pedido".to_owned()]
    );
}

#[tokio::test]
async fn a_cancelled_turn_is_not_reported_as_an_error() {
    // O usuario sabe que cancelou; o que rodou antes ja esta no historico
    // esperando para ser gravado. Erro aqui poluiria a tela sem informar.
    let cancel = Cancel::new();
    cancel.cancel();
    let (_dir, mut turns) = with_cancel(plain_turn("x", Usage::default()), 0, &cancel);

    assert_eq!(turns.run("oi").await.unwrap(), Usage::default());
    assert!(!turns.drain().is_empty(), "o pedido precisa ficar gravavel");
}

#[test]
fn the_debug_view_does_not_leak_the_conversation() {
    let (_dir, turns) = agentic(Vec::new(), 3);
    let rendered = format!("{turns:?}");
    assert!(rendered.contains("drained"));
}

#[test]
fn planning_takes_the_mutating_tools_away_and_says_why() {
    // O gate e a contencao de verdade; a instrucao evita o desperdicio de
    // o modelo tentar escrever e descobrir na recusa.
    let (_dir, mut turns) = agentic(plain_turn("x", nycode_ai::Usage::default()), 0);

    turns.set_planning(true);
    let planning = turns.agent.system().unwrap_or_default().to_owned();
    assert!(planning.contains("MODO DE PLANEJAMENTO"), "{planning}");

    turns.set_planning(false);
    let normal = turns.agent.system().unwrap_or_default();
    assert!(
        !normal.contains("MODO DE PLANEJAMENTO"),
        "sair precisa remover o adendo: {normal}"
    );
}

#[test]
fn leaving_plan_mode_asks_the_session_for_its_gate_back() {
    // Voltar a um padrao seria mudar a sessao pelas costas de quem usou
    // `--allow-writes`.
    use std::sync::atomic::{AtomicBool, Ordering};

    let asked = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&asked);

    let (_dir, turns) = agentic(plain_turn("x", nycode_ai::Usage::default()), 0);
    let mut turns = turns.restoring(move || {
        flag.store(true, Ordering::SeqCst);
        Box::new(nycode_agent::AllowAll)
    });

    turns.set_planning(true);
    assert!(
        !asked.load(Ordering::SeqCst),
        "entrar nao pode pedir o gate de volta"
    );

    turns.set_planning(false);
    assert!(asked.load(Ordering::SeqCst));
}

#[test]
fn replacing_the_history_does_not_make_the_fork_rewrite_the_whole_path() {
    // Sem reancorar o marcador, o proximo `drain` regravaria tudo que veio
    // do disco.
    let (_dir, mut turns) = agentic(plain_turn("x", nycode_ai::Usage::default()), 0);
    turns.replace_history(vec![Message::user("um"), Message::user("dois")]);

    assert_eq!(turns.history().len(), 2);
    assert!(turns.drain().is_empty(), "nada novo a gravar");
}

#[test]
fn switching_the_model_keeps_the_conversation() {
    // Recomecar ja dava para fazer abrindo outra sessao; o ponto e
    // continuar a mesma conversa com outro modelo.
    let (_dir, turns) = agentic(plain_turn("x", nycode_ai::Usage::default()), 0);
    let mut turns = turns.rebuilding(|_| {
        Ok(std::sync::Arc::new(Canned {
            events: std::sync::Mutex::new(Vec::new()),
        }) as Arc<dyn nycode_agent::Backend>)
    });
    turns.replace_history(vec![Message::user("um")]);

    turns.switch_model("nylla-opus-4").unwrap();
    assert_eq!(turns.history().len(), 1, "o historico precisa sobreviver");
}

#[test]
fn switching_the_model_takes_the_declared_window_with_it() {
    // Comparar o usage do modelo novo contra a janela do antigo e como o
    // numero certo produz a conclusao errada: num modelo maior, todo turno
    // seria acusado de truncamento; num menor, o truncamento passaria batido.
    let (_dir, turns) = agentic(plain_turn("x", nycode_ai::Usage::default()), 0);
    let mut turns = turns
        .rebuilding(|_| {
            Ok(std::sync::Arc::new(Canned {
                events: std::sync::Mutex::new(Vec::new()),
            }) as Arc<dyn nycode_agent::Backend>)
        })
        .with_windows(
            [
                ("grande".to_owned(), 1_000_000_u64),
                ("pequeno".to_owned(), 8_192),
            ]
            .into_iter()
            .collect(),
        );

    turns.switch_model("grande").unwrap();
    assert_eq!(turns.context_window(), Some(1_000_000));

    turns.switch_model("pequeno").unwrap();
    assert_eq!(turns.context_window(), Some(8_192));

    // Um modelo que o catalogo nao dimensiona apaga a janela em vez de herdar
    // a do anterior.
    turns.switch_model("sem-tamanho").unwrap();
    assert_eq!(turns.context_window(), None);
}

#[test]
fn a_session_that_cannot_rebuild_says_so_instead_of_pretending() {
    let (_dir, mut turns) = agentic(plain_turn("x", nycode_ai::Usage::default()), 0);
    let err = turns.switch_model("nylla-opus-4").unwrap_err();
    assert!(err.to_string().contains("nylla-opus-4"), "{err}");
}

#[tokio::test]
async fn compacting_reanchors_what_is_left_to_persist() {
    // Sem reancorar, o `drain` seguinte fatiaria alem do fim e devolveria
    // vazio para sempre.
    let (_dir, mut turns) = agentic(plain_turn("x", nycode_ai::Usage::default()), 0);
    let long: Vec<Message> = (0..20).map(|i| Message::user(format!("{i}"))).collect();
    turns.replace_history(long);

    let removed = turns.compact().await;
    assert!(removed > 0, "havia o que cortar");
    assert!(turns.drain().is_empty());
}
