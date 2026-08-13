//! Recuperação do loop sob pressão de contexto.
//!
//! Separado do resto dos testes do agente porque protege outra coisa: não como
//! o loop despacha ferramentas, e sim o que ele faz quando o gateway diz que o
//! prompt não cabe. A alternativa a compactar é abortar a tarefa no meio, que é
//! o pior resultado possível numa sessão longa.

#![allow(clippy::unwrap_used, clippy::panic)]

use std::sync::Arc;

use nycode_ai::anthropic::{ContentBlock, Message};
use nycode_ai::{StopReason, StreamEvent};

use crate::agent::{Agent, Observer, Silent};
use crate::agent_test::{text_turn, workspace};
use crate::backend::fake::FakeBackend;
use crate::error::Error;

/// Observer que grava os avisos de sessão.
#[derive(Default)]
struct Noticed {
    notices: Vec<String>,
}

impl Observer for Noticed {
    fn on_notice(&mut self, text: &str) {
        self.notices.push(text.to_owned());
    }
}

/// Erro de estouro de janela, na forma que o gateway emite.
fn overflow() -> nycode_ai::Error {
    nycode_ai::Error::Api(nycode_ai::ApiError {
        status: Some(400),
        kind: "invalid_request_error".to_owned(),
        message: "prompt is too long: 250000 tokens".to_owned(),
        retry_after: None,
    })
}

/// Semeia um histórico longo o bastante para ter o que compactar.
fn long_history(agent: Agent, turns: usize) -> Agent {
    (0..turns).fold(agent, |agent, i| {
        if i % 2 == 0 {
            agent.with_message(Message::user(format!("pedido {i}")))
        } else {
            agent.with_message(Message::assistant(vec![ContentBlock::text(format!(
                "resposta {i}"
            ))]))
        }
    })
}

#[tokio::test]
async fn the_marker_carries_a_summary_of_what_was_dropped() {
    // Sem o resumo o modelo sabe em que arquivos mexeu e nao sabe por que: as
    // listas dizem "no que eu mexi" e o resumo diz "onde eu estava".
    let (_dir, ctx) = workspace();
    let backend = Arc::new(
        FakeBackend::failing_once(overflow(), vec![text_turn("segui")])
            .answering_oneshot("estava trocando o motor de busca"),
    );
    let mut agent = long_history(Agent::new(backend, ctx), 20);

    agent.run("e agora", &mut Silent).await.unwrap();

    let marcador = serde_json::to_string(&agent.history()[1]).unwrap();
    assert!(marcador.contains("estava trocando"), "{marcador}");
}

#[tokio::test]
async fn a_summary_that_never_comes_does_not_stop_the_compaction() {
    // Compactar acontece quando a janela estourou, que e quando uma chamada a
    // mais tem a maior chance de falhar. Depender dela seria nao compactar na
    // hora em que compactar mais importa.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::failing_once(
        overflow(),
        vec![text_turn("segui mesmo assim")],
    ));
    let mut agent = long_history(Agent::new(backend, ctx), 20);
    let before = agent.history().len();

    let outcome = agent.run("e agora", &mut Silent).await.unwrap();

    assert_eq!(outcome.text, "segui mesmo assim");
    assert!(agent.history().len() < before, "compactou sem o resumo");
}

#[tokio::test]
async fn a_context_overflow_compacts_and_retries_instead_of_aborting() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::failing_once(
        overflow(),
        vec![text_turn("continuei de onde parei")],
    ));
    let mut agent = long_history(Agent::new(backend.clone(), ctx), 20);
    let before = agent.history().len();

    let outcome = agent.run("e agora", &mut Silent).await.unwrap();

    assert_eq!(outcome.text, "continuei de onde parei");
    assert_eq!(
        backend.call_count(),
        2,
        "a segunda tentativa e a compactada"
    );
    assert!(
        agent.history().len() < before,
        "o historico precisa ter encolhido: {} contra {before}",
        agent.history().len()
    );
}

#[tokio::test]
async fn the_original_request_survives_the_compaction() {
    // Perder o primeiro turno faz o agente esquecer o que estava fazendo, que
    // e pior que estourar a janela.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::failing_once(overflow(), vec![text_turn("ok")]));
    let seeded = Agent::new(backend.clone(), ctx).with_message(Message::user("a tarefa original"));
    let mut agent = long_history(seeded, 20);

    agent.run("e agora", &mut Silent).await.unwrap();

    let sent = backend.last_messages();
    assert_eq!(
        sent.first().map(|m| m.content.clone()),
        Some(vec![ContentBlock::text("a tarefa original")]),
        "a tarefa original precisa encabecar o historico compactado"
    );
}

#[tokio::test]
async fn compacting_tells_the_user_that_it_happened() {
    // Encolher o que o modelo lembra em silencio deixaria o usuario sem
    // explicacao para o agente ter esquecido algo.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::failing_once(overflow(), vec![text_turn("ok")]));
    let mut agent = long_history(Agent::new(backend, ctx), 20);

    let mut recorder = Noticed::default();
    agent.run("e agora", &mut recorder).await.unwrap();

    assert_eq!(recorder.notices.len(), 1, "{:?}", recorder.notices);
    assert!(
        recorder.notices[0].contains("compactad"),
        "{}",
        recorder.notices[0]
    );
}

#[tokio::test]
async fn a_history_already_at_its_minimum_reports_the_overflow_instead_of_looping() {
    // Compactar o que ja esta minimo nao muda nada; insistir repetiria o mesmo
    // pedido e o mesmo erro para sempre.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::failing(overflow()));
    let mut agent = Agent::new(backend.clone(), ctx);

    let err = agent
        .run("um pedido gigante", &mut Silent)
        .await
        .expect_err("sem o que compactar, o erro precisa chegar ao usuario");

    assert!(matches!(err, Error::Wire(wire) if wire.is_context_overflow()));
    assert_eq!(backend.call_count(), 1, "nao pode ficar tentando");
}

#[tokio::test]
async fn an_error_that_is_not_an_overflow_is_not_answered_with_compaction() {
    // Compactar em resposta a um erro de validacao perderia contexto sem
    // nenhum motivo.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::failing(nycode_ai::Error::TruncatedStream {
        bytes: 12,
    }));
    let mut agent = long_history(Agent::new(backend.clone(), ctx), 20);
    let before = agent.history().len();

    let err = agent
        .run("oi", &mut Silent)
        .await
        .expect_err("erro de wire");

    assert!(matches!(err, Error::Wire(_)));
    assert_eq!(backend.call_count(), 1);
    assert_eq!(
        agent.history().len(),
        before + 1,
        "so o pedido novo; nada foi compactado"
    );
}

#[tokio::test]
async fn what_the_user_typed_during_the_turn_reaches_the_next_round() {
    // Sem isto, corrigir o rumo exige cancelar e recomecar, jogando fora o que
    // as ferramentas ja fizeram.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![
        crate::agent_test::tool_turn("t1", "read", r#"{"path":"a.txt"}"#),
        text_turn("pronto"),
    ]));

    let (steering, inbox) = tokio::sync::mpsc::channel(4);
    let mut agent = Agent::new(backend.clone(), ctx).with_steering(inbox);
    for tool in crate::tools::all() {
        agent = agent.with_tool(tool);
    }
    steering
        .send("na verdade, olhe b.txt".to_owned())
        .await
        .unwrap();

    agent.run("olhe a.txt", &mut Silent).await.unwrap();

    let sent = backend.last_messages();
    let joined = format!("{sent:?}");
    assert!(joined.contains("na verdade, olhe b.txt"), "{joined}");
}

#[tokio::test]
async fn steering_lands_between_rounds_and_never_inside_one() {
    // Injetar entre um `tool_use` e o `tool_result` par quebraria a conversa, e
    // o backend recusaria o turno inteiro.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![
        crate::agent_test::tool_turn("t1", "read", r#"{"path":"a.txt"}"#),
        text_turn("pronto"),
    ]));

    let (steering, inbox) = tokio::sync::mpsc::channel(4);
    let mut agent = Agent::new(backend, ctx).with_steering(inbox);
    for tool in crate::tools::all() {
        agent = agent.with_tool(tool);
    }
    steering.send("corrija o rumo".to_owned()).await.unwrap();
    agent.run("olhe a.txt", &mut Silent).await.unwrap();

    // Todo `tool_use` precisa ter o `tool_result` dele na mensagem seguinte.
    let history = agent.history();
    for (index, message) in history.iter().enumerate() {
        let opened: Vec<&str> = message
            .content
            .iter()
            .filter_map(|b| match b {
                ContentBlock::ToolUse { id, .. } => Some(id.as_str()),
                _ => None,
            })
            .collect();
        if opened.is_empty() {
            continue;
        }
        let answered = format!("{:?}", history.get(index + 1));
        for id in opened {
            assert!(
                answered.contains(id),
                "`{id}` ficou sem resposta: {answered}"
            );
        }
    }
}

#[tokio::test]
async fn an_empty_steering_message_is_not_sent_to_the_model() {
    // Enter num campo vazio nao e um pedido; manda-lo gastaria contexto.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("ok")]));
    let (steering, inbox) = tokio::sync::mpsc::channel(4);
    let mut agent = Agent::new(backend.clone(), ctx).with_steering(inbox);
    steering.send("   ".to_owned()).await.unwrap();

    agent.run("oi", &mut Silent).await.unwrap();
    assert_eq!(backend.last_messages().len(), 1, "so o pedido original");
}

#[tokio::test]
async fn the_user_is_told_what_was_added_to_the_turn() {
    // Uma mensagem que entra em silencio faz o modelo mudar de rumo sem que o
    // usuario saiba por que.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("ok")]));
    let (steering, inbox) = tokio::sync::mpsc::channel(4);
    let mut agent = Agent::new(backend, ctx).with_steering(inbox);
    steering.send("mude o rumo".to_owned()).await.unwrap();

    let mut recorder = Noticed::default();
    agent.run("oi", &mut recorder).await.unwrap();

    assert!(
        recorder.notices.iter().any(|n| n.contains("mude o rumo")),
        "{:?}",
        recorder.notices
    );
}

#[tokio::test]
async fn a_session_without_steering_behaves_exactly_as_before() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("ok")]));
    let mut agent = Agent::new(backend.clone(), ctx);

    agent.run("oi", &mut Silent).await.unwrap();
    assert_eq!(backend.last_messages().len(), 1);
}

#[tokio::test]
async fn switching_the_gate_mid_session_takes_effect_on_the_next_call() {
    // E o que o plan mode precisa: entrar e sair sem derrubar a conversa.
    // Refazer a sessao perderia o contexto que e o insumo do plano.
    let (dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![
        crate::agent_test::tool_turn("t1", "write", r#"{"path":"a.txt","content":"x"}"#),
        text_turn("terminei"),
    ]));

    let mut agent = Agent::new(backend, ctx).with_gate(Box::new(crate::policy::AllowAll));
    for tool in crate::tools::all() {
        agent = agent.with_tool(tool);
    }
    agent.set_gate(Box::new(crate::policy::ReadOnly));

    agent.run("escreva algo", &mut Silent).await.unwrap();

    assert!(
        !dir.path().join("a.txt").exists(),
        "o gate novo precisa valer ja na proxima chamada"
    );
}

#[tokio::test]
async fn switching_the_system_prompt_mid_session_keeps_the_history() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("ok")]));
    let seeded = Agent::new(backend.clone(), ctx).with_system("base");
    let mut agent = long_history(seeded, 6);

    agent.set_system(Some("base + planejamento".to_owned()));
    agent.run("oi", &mut Silent).await.unwrap();

    assert_eq!(
        backend.last_system().as_deref(),
        Some("base + planejamento")
    );
    assert!(
        backend.last_messages().len() > 1,
        "o historico nao pode ter sido perdido"
    );
}

#[tokio::test]
async fn a_session_without_pressure_never_compacts() {
    // O gatilho e o erro do gateway, nao um palpite sobre tamanho.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("tranquilo")]));
    let mut agent = long_history(Agent::new(backend.clone(), ctx), 40);
    let before = agent.history().len();

    let mut recorder = Noticed::default();
    agent.run("oi", &mut recorder).await.unwrap();

    assert!(recorder.notices.is_empty());
    assert_eq!(agent.history().len(), before + 2, "pedido e resposta");
}

// --- Estouro que o provider reporta sem erro (FR-5) ---------------------------
//
// Os dois casos abaixo chegam como sucesso: status 200, stream bem formado,
// nenhum `Error::Wire` para `should_compact` olhar. Sao a forma mais cara de
// degradacao silenciosa que o fio tem, porque o harness os trata como resposta.

/// Turno que para no limite sem emitir conteudo nenhum.
fn empty_max_tokens_turn() -> Vec<StreamEvent> {
    vec![
        StreamEvent::MessageStart { id: "m".into() },
        StreamEvent::MessageEnd {
            stop_reason: StopReason::MaxTokens,
        },
    ]
}

/// Turno que responde normalmente, declarando a entrada que consumiu.
fn turn_using(input_tokens: u64, text: &str) -> Vec<StreamEvent> {
    vec![
        StreamEvent::MessageStart { id: "m".into() },
        StreamEvent::TextDelta(text.into()),
        StreamEvent::Usage(nycode_ai::Usage {
            input_tokens,
            output_tokens: 10,
            ..nycode_ai::Usage::default()
        }),
        StreamEvent::MessageEnd {
            stop_reason: StopReason::EndTurn,
        },
    ]
}

#[tokio::test]
async fn a_limit_stop_with_nothing_produced_is_treated_as_overflow() {
    // O provider nao errou: respondeu 200, disse que parou no limite e nao
    // emitiu conteudo nenhum. Isso so acontece quando o prompt ocupou a janela
    // inteira e nao sobrou espaco para gerar. Devolver ao usuario um texto
    // vazio com `stop_reason` de limite entrega uma falha com cara de resposta.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![
        empty_max_tokens_turn(),
        text_turn("agora coube"),
    ]));
    let mut agent = long_history(Agent::new(backend.clone(), ctx), 12);

    let mut noticed = Noticed::default();
    let outcome = agent.run("e agora", &mut noticed).await.unwrap();

    assert_eq!(outcome.text, "agora coube");
    assert_eq!(backend.call_count(), 2, "o turno vazio precisa ser refeito");
    assert!(
        noticed.notices.iter().any(|n| n.contains("compactad")),
        "a compactacao precisa ser dita: {:?}",
        noticed.notices
    );
}

#[tokio::test]
async fn a_limit_stop_that_produced_text_is_an_output_cap_and_not_an_overflow() {
    // Bater no teto de saida com texto produzido e outro defeito: a resposta
    // veio truncada, e compactar o historico nao a completa. Confundir os dois
    // gastaria o orcamento de compactacao no problema errado e ainda jogaria
    // fora o texto que chegou.
    let (_dir, ctx) = workspace();
    let capped = vec![
        StreamEvent::MessageStart { id: "m".into() },
        StreamEvent::TextDelta("resposta cortada no meio".into()),
        StreamEvent::MessageEnd {
            stop_reason: StopReason::MaxTokens,
        },
    ];
    let backend = Arc::new(FakeBackend::new(vec![capped]));
    let mut agent = long_history(Agent::new(backend.clone(), ctx), 12);

    let mut noticed = Noticed::default();
    let outcome = agent.run("escreva", &mut noticed).await.unwrap();

    assert_eq!(outcome.text, "resposta cortada no meio");
    assert_eq!(backend.call_count(), 1, "nao ha o que refazer");
    assert!(noticed.notices.is_empty(), "{:?}", noticed.notices);
}

#[tokio::test]
async fn input_above_the_declared_window_is_recognised_without_discarding_the_answer() {
    // O provider aceitou o pedido, respondeu, e o usage diz que a entrada
    // passou da janela que o catalogo declara: ele truncou o comeco em
    // silencio. Refazer o turno jogaria fora uma resposta boa; nao reconhecer
    // deixaria o proximo turno ser truncado igual, e nada no rodape explicaria
    // por que o modelo esqueceu o inicio da conversa.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![turn_using(250_000, "respondi")]));
    let mut agent = long_history(Agent::new(backend.clone(), ctx), 12).with_context_window(200_000);

    let mut noticed = Noticed::default();
    let outcome = agent.run("oi", &mut noticed).await.unwrap();

    assert_eq!(outcome.text, "respondi");
    assert_eq!(
        backend.call_count(),
        1,
        "uma resposta produzida nao se joga fora"
    );
    assert!(
        noticed.notices.iter().any(|n| n.contains("janela")),
        "o truncamento silencioso precisa ser dito: {:?}",
        noticed.notices
    );
}

#[tokio::test]
async fn input_within_the_declared_window_says_nothing() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![turn_using(1_000, "respondi")]));
    let mut agent = long_history(Agent::new(backend.clone(), ctx), 12).with_context_window(200_000);

    let mut noticed = Noticed::default();
    agent.run("oi", &mut noticed).await.unwrap();

    assert!(noticed.notices.is_empty(), "{:?}", noticed.notices);
}

#[tokio::test]
async fn a_catalog_that_declares_no_window_does_not_invent_one() {
    // Sem janela declarada nao ha com o que comparar. Chutar um numero faria o
    // harness acusar truncamento onde nao houve, que e o oposto do NFR-4.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![turn_using(9_000_000, "respondi")]));
    let mut agent = long_history(Agent::new(backend.clone(), ctx), 12);

    let mut noticed = Noticed::default();
    agent.run("oi", &mut noticed).await.unwrap();

    assert!(noticed.notices.is_empty(), "{:?}", noticed.notices);
}
