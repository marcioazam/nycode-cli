//! Pedir aprovação ao usuário no meio de um turno.
//!
//! O gate decide sozinho quando a resposta é óbvia. Quando não é, quem sabe
//! perguntar é este laço — e ele não pode ser chamado de dentro do loop de
//! agente, porque os dois correm ao mesmo tempo. O canal é o que os une sem
//! inverter a posse: o loop pergunta, este arquivo atende.

use crossterm::event::{Event, KeyCode, KeyModifiers};
use futures_util::{Stream, StreamExt};
use nycode_agent::Cancel;
use nycode_agent::policy::approval::Request;
use nycode_ai::Usage;
use nycode_tui::{Action, Editor, Reaction};

use super::{Surface, Turns, interrupts};

/// Fila de pedidos de aprovação vindos do loop de agente.
pub type Approvals = tokio::sync::mpsc::Receiver<Request>;

/// Roda um turno, atendendo o teclado e os pedidos de aprovação enquanto corre.
///
/// Devolve o usage do pedido para que o rodapé some a conta da sessão. Um turno
/// cancelado devolve zero em vez de erro: ele já foi gravado, e o usuário sabe
/// que cancelou.
///
/// Os dois canais de teclado não se fundem: um injeta no turno, o outro espera.
#[allow(clippy::too_many_arguments)]
pub async fn run_turn<E, S>(
    turns: &mut dyn Turns,
    events: &mut E,
    surface: &mut S,
    cancel: &Cancel,
    approvals: Option<&mut Approvals>,
    steering: Option<&tokio::sync::mpsc::Sender<String>>,
    later: Option<&tokio::sync::mpsc::Sender<String>>,
    prompt: &str,
) -> anyhow::Result<Usage>
where
    E: Stream<Item = std::io::Result<Event>> + Unpin,
    S: Surface,
{
    let turn = turns.run(prompt);
    tokio::pin!(turn);
    let mut approvals = approvals;
    let mut typed = Editor::new();

    loop {
        // Sem aprovador este braço nunca completa. Um `Option` vazio num
        // `select!` fecharia o laço na primeira volta.
        let pending = async {
            match approvals.as_mut() {
                Some(inbox) => inbox.recv().await,
                None => std::future::pending().await,
            }
        };

        tokio::select! {
            // Enviesado de propósito. Sem isto o `select!` escolhe ao acaso
            // entre ramos prontos, e uma tecla que chega no instante em que o
            // turno termina vira direcionamento do turno seguinte em vez do
            // pedido que o usuário digitou.
            biased;

            result = &mut turn => return result,
            // Aguardar aqui pausa o turno de propósito: o agente já está
            // parado esperando a resposta, e a pergunta é a única coisa
            // acontecendo até ser respondida.
            Some(request) = pending => ask(surface, events, request).await?,
            Some(Ok(event)) = events.next() => {
                steer(surface, cancel, steering, later, &mut typed, &event)?;
            }
        }
    }
}

/// Trata uma tecla apertada enquanto o turno corre.
///
/// Digitar durante um turno é comum e a alternativa — descartar — perde o que o
/// usuário escreveu sem dizer nada. O que ele completa com Enter entra no turno
/// na próxima rodada, que é onde o histórico está fechado e a injeção é segura.
fn steer<S: Surface>(
    surface: &mut S,
    cancel: &Cancel,
    steering: Option<&tokio::sync::mpsc::Sender<String>>,
    later: Option<&tokio::sync::mpsc::Sender<String>>,
    typed: &mut Editor,
    event: &Event,
) -> anyhow::Result<()> {
    if interrupts(event) {
        cancel.cancel();
        return Ok(());
    }

    let Event::Key(key) = event else {
        return Ok(());
    };

    if key.code == KeyCode::Enter && key.modifiers.contains(KeyModifiers::ALT) {
        let Some(sender) = later else {
            return Ok(());
        };
        let Reaction::Submitted(message) = typed.apply(Action::Submit) else {
            return Ok(());
        };
        if message.trim().is_empty() {
            return Ok(());
        }
        return push_queue(surface, sender, &message, "depois");
    }

    let Some(sender) = steering else {
        return Ok(());
    };

    let nycode_tui::Key::Edit(action) = nycode_tui::translate(*key) else {
        return Ok(());
    };
    let Reaction::Submitted(message) = typed.apply(action) else {
        return Ok(());
    };
    if message.trim().is_empty() {
        return Ok(());
    }
    push_queue(surface, sender, &message, "na fila")
}

fn push_queue<S: Surface>(
    surface: &mut S,
    sender: &tokio::sync::mpsc::Sender<String>,
    message: &str,
    label: &str,
) -> anyhow::Result<()> {
    if sender.try_send(message.to_owned()).is_err() {
        surface.emit("\n  (a fila esta cheia; a mensagem nao entrou)\n")?;
    } else {
        surface.emit(&format!("\n  {label}: {message}\n"))?;
    }
    Ok(())
}

/// Pergunta ao usuário e responde ao pedido.
///
/// Fechar o teclado, interromper, ou responder qualquer outra coisa conta como
/// recusa: a resposta segura é a que não concede o que ninguém concedeu.
async fn ask<S, E>(surface: &mut S, events: &mut E, request: Request) -> anyhow::Result<()>
where
    S: Surface,
    E: Stream<Item = std::io::Result<Event>> + Unpin,
{
    surface.emit(&question(&request))?;
    let answer = read_answer(events).await;

    surface.emit(if answer {
        "  permitido\n\n"
    } else {
        "  recusado\n\n"
    })?;
    request.answer(answer);
    Ok(())
}

/// Lê a resposta do teclado.
async fn read_answer<E>(events: &mut E) -> bool
where
    E: Stream<Item = std::io::Result<Event>> + Unpin,
{
    while let Some(event) = events.next().await {
        let Ok(event) = event else { continue };
        if interrupts(&event) {
            return false;
        }
        let Event::Key(key) = event else { continue };
        match key.code {
            KeyCode::Char('s' | 'S' | 'y' | 'Y') => return true,
            KeyCode::Char('n' | 'N') | KeyCode::Esc => return false,
            _ => {}
        }
    }
    false
}

/// A pergunta que o usuário lê.
fn question(request: &Request) -> String {
    format!(
        "\npermitir `{}`{}?\n  [s] sim  ·  [n] nao\n",
        request.call.name,
        summarize(&request.call.input)
    )
}

/// Resumo de uma linha dos argumentos, para o usuário decidir com contexto.
///
/// Sem ele a pergunta seria "permitir `bash`?", que não é decidível: o que
/// importa é qual comando.
fn summarize(input: &serde_json::Value) -> String {
    let Some(object) = input.as_object() else {
        return String::new();
    };
    let rendered: Vec<String> = object
        .iter()
        .map(|(key, value)| {
            let text = match value {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            let clipped: String = text.chars().take(120).collect();
            format!("{key}={clipped}")
        })
        .collect();

    if rendered.is_empty() {
        return String::new();
    }
    format!(" com {}", rendered.join(", "))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use nycode_agent::ToolCall;
    use nycode_agent::policy::{Approver, Asking};
    use serde_json::json;

    use crate::interactive::fakes::{ctrl, delivered, key};

    fn call(name: &str, input: serde_json::Value) -> ToolCall {
        ToolCall {
            id: "t1".to_owned(),
            name: name.to_owned(),
            input,
        }
    }

    /// Pergunta e devolve o que a interface teria escrito, com a resposta.
    async fn answered(events: Vec<Event>, call: ToolCall) -> (bool, String) {
        let (approver, mut inbox) = Asking::channel();
        let expected = call.clone();
        let asked = tokio::spawn(async move { approver.approve(&call).await });

        let request = inbox.recv().await.expect("um pedido");
        let mut surface = crate::interactive::fakes::Recording::new();
        ask(&mut surface, &mut delivered(events), request)
            .await
            .unwrap();

        (
            asked.await.unwrap().authorizes(&expected),
            surface.scrollback,
        )
    }

    #[tokio::test]
    async fn pressing_yes_lets_the_call_through() {
        let (approved, shown) = answered(
            vec![key(KeyCode::Char('s'))],
            call("bash", json!({ "command": "cargo test" })),
        )
        .await;

        assert!(approved);
        assert!(shown.contains("permitido"), "{shown}");
    }

    #[tokio::test]
    async fn the_question_says_which_command_is_being_asked_about() {
        // "permitir `bash`?" nao e uma pergunta decidivel: o que importa e
        // qual comando.
        let (_, shown) = answered(
            vec![key(KeyCode::Char('s'))],
            call("bash", json!({ "command": "rm -rf /" })),
        )
        .await;

        assert!(shown.contains("rm -rf /"), "{shown}");
    }

    #[tokio::test]
    async fn pressing_no_refuses() {
        let (approved, shown) =
            answered(vec![key(KeyCode::Char('n'))], call("write", json!({}))).await;

        assert!(!approved);
        assert!(shown.contains("recusado"), "{shown}");
    }

    #[tokio::test]
    async fn escape_refuses_too() {
        let (approved, _) = answered(vec![key(KeyCode::Esc)], call("write", json!({}))).await;
        assert!(!approved);
    }

    #[tokio::test]
    async fn interrupting_refuses() {
        let (approved, _) = answered(vec![ctrl('c')], call("bash", json!({}))).await;
        assert!(!approved);
    }

    #[tokio::test]
    async fn a_key_without_meaning_keeps_asking() {
        // Uma tecla qualquer nao pode contar como sim: seria conceder por
        // acidente.
        let (approved, _) = answered(
            vec![key(KeyCode::Char('x')), key(KeyCode::Char('n'))],
            call("bash", json!({})),
        )
        .await;
        assert!(!approved);
    }

    #[tokio::test]
    async fn a_keyboard_that_closed_counts_as_a_refusal() {
        // A resposta segura e a que nao concede o que ninguem concedeu.
        let (approved, _) = answered(Vec::new(), call("bash", json!({}))).await;
        assert!(!approved);
    }

    /// Digita `text` e Enter, devolvendo o que entrou na fila e o que foi
    /// escrito na tela.
    fn steered(text: &str, capacity: usize) -> (Vec<String>, String, bool) {
        let (sender, mut inbox) = tokio::sync::mpsc::channel(capacity);
        let cancel = Cancel::new();
        let mut surface = crate::interactive::fakes::Recording::new();
        let mut editor = Editor::new();

        let mut events: Vec<Event> = text.chars().map(|c| key(KeyCode::Char(c))).collect();
        events.push(key(KeyCode::Enter));
        for event in events {
            steer(
                &mut surface,
                &cancel,
                Some(&sender),
                None,
                &mut editor,
                &event,
            )
            .unwrap();
        }

        let mut queued = Vec::new();
        while let Ok(message) = inbox.try_recv() {
            queued.push(message);
        }
        (queued, surface.scrollback, cancel.is_cancelled())
    }

    #[test]
    fn typing_during_a_turn_is_queued_instead_of_discarded() {
        // Descartar perderia o que o usuario escreveu sem dizer nada.
        let (queued, shown, _) = steered("olhe b.txt tambem", 4);

        assert_eq!(queued, vec!["olhe b.txt tambem".to_owned()]);
        assert!(shown.contains("na fila"), "{shown}");
    }

    #[test]
    fn an_empty_line_does_not_enter_the_queue() {
        let (queued, _, _) = steered("   ", 4);
        assert!(queued.is_empty());
    }

    #[test]
    fn a_full_queue_says_the_message_did_not_get_in() {
        // Perder em silencio seria pior: o usuario acharia que corrigiu o rumo.
        let (sender, _inbox) = tokio::sync::mpsc::channel(1);
        sender.try_send("ja estava aqui".to_owned()).unwrap();

        let cancel = Cancel::new();
        let mut surface = crate::interactive::fakes::Recording::new();
        let mut editor = Editor::new();
        for event in [key(KeyCode::Char('x')), key(KeyCode::Enter)] {
            steer(
                &mut surface,
                &cancel,
                Some(&sender),
                None,
                &mut editor,
                &event,
            )
            .unwrap();
        }

        assert!(
            surface.scrollback.contains("fila esta cheia"),
            "{}",
            surface.scrollback
        );
    }

    #[test]
    fn interrupting_during_a_turn_still_cancels() {
        // O direcionamento nao pode ter tirado o Ctrl+C do caminho.
        let (sender, _inbox) = tokio::sync::mpsc::channel(4);
        let cancel = Cancel::new();
        let mut surface = crate::interactive::fakes::Recording::new();
        let mut editor = Editor::new();

        steer(
            &mut surface,
            &cancel,
            Some(&sender),
            None,
            &mut editor,
            &ctrl('c'),
        )
        .unwrap();
        assert!(cancel.is_cancelled());
    }

    #[test]
    fn without_a_steering_channel_typing_is_simply_ignored() {
        // E o caso do modo headless: nao ha turno interativo a direcionar.
        let cancel = Cancel::new();
        let mut surface = crate::interactive::fakes::Recording::new();
        let mut editor = Editor::new();

        steer(
            &mut surface,
            &cancel,
            None,
            None,
            &mut editor,
            &key(KeyCode::Char('x')),
        )
        .unwrap();
        assert!(surface.scrollback.is_empty());
    }

    #[test]
    fn arguments_without_an_object_summarize_to_nothing() {
        assert_eq!(summarize(&serde_json::Value::Null), "");
        assert_eq!(summarize(&json!({})), "");
    }

    #[test]
    fn a_very_long_argument_is_clipped() {
        // Um comando de dez mil caracteres tornaria a pergunta ilegivel.
        let long = "x".repeat(5000);
        let rendered = summarize(&json!({ "command": long }));
        assert!(rendered.len() < 200, "{} bytes", rendered.len());
    }

    #[test]
    fn non_string_arguments_are_rendered_as_json() {
        assert!(summarize(&json!({ "limit": 42 })).contains("limit=42"));
    }
    fn alt_enter() -> Event {
        Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::ALT,
        ))
    }

    #[test]
    fn alt_enter_during_a_turn_queues_a_follow_up_instead_of_steering() {
        let (steer_tx, mut steer_rx) = tokio::sync::mpsc::channel(4);
        let (later_tx, mut later_rx) = tokio::sync::mpsc::channel(4);
        let cancel = Cancel::new();
        let mut surface = crate::interactive::fakes::Recording::new();
        let mut editor = Editor::new();

        for event in crate::interactive::fakes::typing("olhe depois") {
            steer(
                &mut surface,
                &cancel,
                Some(&steer_tx),
                Some(&later_tx),
                &mut editor,
                &event,
            )
            .unwrap();
        }
        steer(
            &mut surface,
            &cancel,
            Some(&steer_tx),
            Some(&later_tx),
            &mut editor,
            &alt_enter(),
        )
        .unwrap();

        assert!(steer_rx.try_recv().is_err());
        assert_eq!(later_rx.try_recv().unwrap(), "olhe depois");
        assert!(
            surface.scrollback.contains("depois"),
            "{}",
            surface.scrollback
        );
        assert!(
            !surface.scrollback.contains("na fila"),
            "{}",
            surface.scrollback
        );
    }
}
