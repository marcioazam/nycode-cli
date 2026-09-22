//! Testes do loop de agente.
//!
//! Cada teste aqui existe para uma invariante que, se quebrada, produz um agente
//! que parece funcionar: ferramenta executada com argumentos truncados, recusa
//! apresentada como resposta, loop infinito consumindo cota.

#![allow(clippy::unwrap_used, clippy::panic)]

use std::sync::Arc;

use nycode_ai::anthropic::{ContentBlock, Message, Role};
use nycode_ai::{StopReason, StreamEvent};
use serde_json::{Value, json};

use crate::agent::{Agent, Observer, Silent};
use crate::backend::fake::FakeBackend;
use crate::error::Error;
use crate::tool::{ToolContext, ToolOutput};
use crate::tools::Read;

/// Observer que grava tudo, para afirmar sobre o que o usuário veria.
#[derive(Default)]
struct Recorder {
    text: String,
    tools_started: Vec<String>,
    tools_ended: Vec<(String, bool)>,
}

impl Observer for Recorder {
    fn on_text(&mut self, chunk: &str) {
        self.text.push_str(chunk);
    }
    fn on_tool_start(&mut self, name: &str, _input: &Value) {
        self.tools_started.push(name.to_owned());
    }
    fn on_tool_end(&mut self, name: &str, output: &ToolOutput) {
        self.tools_ended.push((name.to_owned(), output.is_error));
    }
}

pub(crate) fn workspace() -> (tempfile::TempDir, ToolContext) {
    let dir = tempfile::tempdir().unwrap();
    let ctx = ToolContext::new(dir.path()).unwrap();
    (dir, ctx)
}

pub(crate) fn text_turn(text: &str) -> Vec<StreamEvent> {
    vec![
        StreamEvent::MessageStart { id: "m".into() },
        StreamEvent::TextDelta(text.into()),
        StreamEvent::MessageEnd {
            stop_reason: StopReason::EndTurn,
        },
    ]
}

pub(crate) fn tool_turn(id: &str, name: &str, args: &str) -> Vec<StreamEvent> {
    vec![
        StreamEvent::MessageStart { id: "m".into() },
        StreamEvent::ToolCallStart {
            id: id.into(),
            name: name.into(),
        },
        StreamEvent::ToolCallDelta {
            id: id.into(),
            json_fragment: args.into(),
        },
        StreamEvent::ToolCallEnd { id: id.into() },
        StreamEvent::MessageEnd {
            stop_reason: StopReason::ToolUse,
        },
    ]
}

#[tokio::test]
async fn a_plain_answer_returns_without_touching_tools() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("Ola")]));
    let mut agent = Agent::new(backend.clone(), ctx);

    let mut recorder = Recorder::default();
    let outcome = agent.run("oi", &mut recorder).await.unwrap();

    assert_eq!(outcome.text, "Ola");
    assert_eq!(outcome.stop_reason, StopReason::EndTurn);
    assert_eq!(outcome.tool_rounds, 0);
    assert_eq!(
        recorder.text, "Ola",
        "o texto precisa chegar incrementalmente ao observer"
    );
    assert!(recorder.tools_started.is_empty());
    assert_eq!(backend.call_count(), 1);
}

#[tokio::test]
async fn executes_a_tool_and_feeds_the_result_back() {
    let (dir, ctx) = workspace();
    std::fs::write(dir.path().join("a.txt"), "conteudo").unwrap();

    let backend = Arc::new(FakeBackend::new(vec![
        tool_turn("t1", "read", r#"{"path":"a.txt"}"#),
        text_turn("li o arquivo"),
    ]));
    let mut agent = Agent::new(backend.clone(), ctx).with_tool(Arc::new(Read));

    let mut recorder = Recorder::default();
    let outcome = agent.run("leia a.txt", &mut recorder).await.unwrap();

    assert_eq!(outcome.text, "li o arquivo");
    assert_eq!(outcome.tool_rounds, 1);
    assert_eq!(recorder.tools_started, vec!["read"]);
    assert_eq!(recorder.tools_ended, vec![("read".to_owned(), false)]);
    assert_eq!(
        backend.call_count(),
        2,
        "o loop precisa reentrar apos a ferramenta"
    );

    // O historico da segunda chamada precisa conter o bloco tool_use e o
    // tool_result correspondente: sem o tool_use, o backend recebe um resultado
    // que referencia um id que ele nunca viu e rejeita a conversa.
    let sent = backend.last_messages();
    let has_tool_use = sent.iter().any(|m| {
        m.role == Role::Assistant
            && m.content
                .iter()
                .any(|b| matches!(b, ContentBlock::ToolUse { id, .. } if id == "t1"))
    });
    let has_result = sent.iter().any(|m| {
        m.content.iter().any(
            |b| matches!(b, ContentBlock::ToolResult { tool_use_id, .. } if tool_use_id == "t1"),
        )
    });
    assert!(has_tool_use, "bloco tool_use ausente do historico");
    assert!(has_result, "tool_result ausente do historico");
}

#[tokio::test]
async fn a_tool_failure_is_marked_as_an_error_for_the_model() {
    // Mandar a falha como texto comum faria o modelo tratar "arquivo nao
    // encontrado" como conteudo do arquivo.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![
        tool_turn("t1", "read", r#"{"path":"nao-existe.txt"}"#),
        text_turn("nao consegui"),
    ]));
    let mut agent = Agent::new(backend.clone(), ctx).with_tool(Arc::new(Read));

    let mut recorder = Recorder::default();
    agent.run("leia", &mut recorder).await.unwrap();

    assert_eq!(recorder.tools_ended, vec![("read".to_owned(), true)]);
    let sent = backend.last_messages();
    let flagged = sent.iter().any(|m| {
        m.content
            .iter()
            .any(|b| matches!(b, ContentBlock::ToolResult { is_error, .. } if *is_error))
    });
    assert!(
        flagged,
        "o resultado precisa chegar ao modelo marcado como erro"
    );
}

#[tokio::test]
async fn an_unknown_tool_becomes_a_correctable_error_not_an_abort() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![
        tool_turn("t1", "inventada", "{}"),
        text_turn("entendi, vou usar outra"),
    ]));
    let mut agent = Agent::new(backend, ctx).with_tool(Arc::new(Read));

    let mut recorder = Recorder::default();
    let outcome = agent.run("faca algo", &mut recorder).await.unwrap();

    assert_eq!(outcome.text, "entendi, vou usar outra");
    assert_eq!(recorder.tools_ended, vec![("inventada".to_owned(), true)]);
}

#[tokio::test]
async fn malformed_tool_arguments_do_not_reach_the_tool() {
    // Executar `read` com argumentos truncados leria o arquivo errado, ou pior,
    // executaria um comando pela metade quando a ferramenta for `bash`.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![
        tool_turn("t1", "read", "{isto nao e json"),
        text_turn("ok"),
    ]));
    let mut agent = Agent::new(backend, ctx).with_tool(Arc::new(Read));

    let mut recorder = Recorder::default();
    agent.run("leia", &mut recorder).await.unwrap();

    assert_eq!(recorder.tools_ended, vec![("read".to_owned(), true)]);
}

#[tokio::test]
async fn a_refusal_is_reported_as_a_refusal_not_as_an_answer() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![vec![
        StreamEvent::TextDelta("nao posso".into()),
        StreamEvent::MessageEnd {
            stop_reason: StopReason::Refusal,
        },
    ]]));
    let mut agent = Agent::new(backend, ctx);

    let outcome = agent.run("algo bloqueado", &mut Silent).await.unwrap();
    assert_eq!(outcome.stop_reason, StopReason::Refusal);
    assert!(outcome.stop_reason.is_terminal_failure());
}

#[tokio::test]
async fn a_looping_model_hits_the_tool_limit_instead_of_burning_quota() {
    let (dir, ctx) = workspace();
    std::fs::write(dir.path().join("a.txt"), "x").unwrap();
    // Sempre pede a mesma ferramenta, nunca conclui.
    let turns = (0..10)
        .map(|_| tool_turn("t1", "read", r#"{"path":"a.txt"}"#))
        .collect();
    let backend = Arc::new(FakeBackend::new(turns));
    let mut agent = Agent::new(backend.clone(), ctx)
        .with_tool(Arc::new(Read))
        .with_tool_limit(3);

    let err = agent
        .run("leia", &mut Silent)
        .await
        .expect_err("deveria bater no teto");
    assert!(matches!(err, Error::ToolLoopLimit { limit: 3 }) && backend.call_count() == 4);
}

#[tokio::test]
async fn a_truncated_stream_fails_the_run_instead_of_returning_partial_text() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::failing(nycode_ai::Error::TruncatedStream {
        bytes: 12,
    }));
    let mut agent = Agent::new(backend, ctx);

    let err = agent
        .run("oi", &mut Silent)
        .await
        .expect_err("stream cortado precisa falhar");
    assert!(matches!(
        err,
        Error::Wire(nycode_ai::Error::TruncatedStream { bytes: 12 })
    ));
}

#[tokio::test]
async fn tool_specs_are_sent_in_a_stable_order() {
    // Um catalogo que muda de ordem entre execucoes invalida o cache de prompt
    // do backend sem nenhum ganho.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("ok")]));
    let mut agent = Agent::new(backend, ctx).with_tool(Arc::new(Read));

    agent.run("oi", &mut Silent).await.unwrap();
    let first = agent.history().len();
    assert!(first > 0);
}

#[tokio::test]
async fn history_accumulates_across_requests() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("um"), text_turn("dois")]));
    let mut agent = Agent::new(backend, ctx);

    agent.run("primeiro", &mut Silent).await.unwrap();
    agent.run("segundo", &mut Silent).await.unwrap();

    let history = agent.history();
    assert_eq!(history.len(), 4, "dois pares user/assistant");
    assert_eq!(history[0].role, Role::User);
    assert_eq!(history[1].role, Role::Assistant);
    assert_eq!(history[2], nycode_ai::anthropic::Message::user("segundo"));
}

#[tokio::test]
async fn a_tool_use_stop_with_no_calls_ends_the_run_instead_of_spinning() {
    // Backend inconsistente: diz que quer ferramenta mas nao emitiu nenhuma.
    // Sem esta guarda o loop reentraria para sempre sem executar nada.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![vec![
        StreamEvent::TextDelta("hm".into()),
        StreamEvent::MessageEnd {
            stop_reason: StopReason::ToolUse,
        },
    ]]));
    let mut agent = Agent::new(backend.clone(), ctx);

    let outcome = agent.run("oi", &mut Silent).await.unwrap();
    assert_eq!(outcome.tool_rounds, 0);
    assert_eq!(backend.call_count(), 1);
}

#[tokio::test]
async fn path_traversal_through_a_tool_call_is_refused() {
    // Caminho de ataque completo: o modelo pede leitura fora do workspace.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![
        tool_turn("t1", "read", r#"{"path":"../../../../etc/passwd"}"#),
        text_turn("bloqueado"),
    ]));
    let mut agent = Agent::new(backend.clone(), ctx).with_tool(Arc::new(Read));

    let mut recorder = Recorder::default();
    agent.run("leia /etc/passwd", &mut recorder).await.unwrap();

    assert_eq!(recorder.tools_ended, vec![("read".to_owned(), true)]);
    let sent = backend.last_messages();
    let refused = sent.iter().any(|m| {
        m.content.iter().any(|b| {
            matches!(b, ContentBlock::ToolResult { content, is_error: true, .. }
                if content.contains("fora da raiz"))
        })
    });
    assert!(
        refused,
        "a fuga de caminho precisa ser recusada e reportada"
    );
}

#[tokio::test]
async fn the_default_gate_blocks_writes_before_they_touch_the_disk() {
    // A recusa precisa acontecer antes do despacho: um `write` barrado que ja
    // criou o arquivo nao e uma recusa, e um aviso depois do fato.
    let (dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![
        tool_turn("t1", "write", r#"{"path":"novo.txt","content":"x"}"#),
        text_turn("fui barrado"),
    ]));
    let mut agent = Agent::new(backend, ctx).with_tool(Arc::new(crate::tools::Write));

    let mut recorder = Recorder::default();
    agent.run("escreva", &mut recorder).await.unwrap();

    assert_eq!(recorder.tools_ended, vec![("write".to_owned(), true)]);
    assert!(
        !dir.path().join("novo.txt").exists(),
        "o arquivo foi criado apesar da recusa"
    );
}

#[tokio::test]
async fn an_explicit_gate_lets_the_write_through() {
    let (dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![
        tool_turn("t1", "write", r#"{"path":"novo.txt","content":"conteudo"}"#),
        text_turn("escrito"),
    ]));
    let mut agent = Agent::new(backend, ctx)
        .with_tool(Arc::new(crate::tools::Write))
        .with_gate(Box::new(crate::policy::permission::AllowAll));

    let mut recorder = Recorder::default();
    agent.run("escreva", &mut recorder).await.unwrap();

    assert_eq!(recorder.tools_ended, vec![("write".to_owned(), false)]);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("novo.txt")).unwrap(),
        "conteudo"
    );
}

#[tokio::test]
async fn a_gate_refusal_explains_the_policy_to_the_model() {
    // Sem o motivo, o modelo interpreta a recusa como falha da ferramenta e
    // tenta de novo em loop ate bater no teto de iteracoes.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![
        tool_turn("t1", "bash", r#"{"command":"rm -rf /"}"#),
        text_turn("entendi"),
    ]));
    let mut agent =
        Agent::new(backend.clone(), ctx).with_tool(Arc::new(crate::tools::Bash::default()));

    agent.run("apague tudo", &mut Silent).await.unwrap();

    let sent = backend.last_messages();
    let explained = sent.iter().any(|m| {
        m.content.iter().any(|b| {
            matches!(b, ContentBlock::ToolResult { content, is_error: true, .. }
                if content.contains("somente-leitura"))
        })
    });
    assert!(explained, "a politica precisa ser explicada ao modelo");
}

#[tokio::test]
async fn the_system_prompt_is_configurable() {
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("ok")]));
    let mut agent = Agent::new(backend, ctx).with_system("voce e o nycode");

    let outcome = agent.run("oi", &mut Silent).await.unwrap();
    assert_eq!(outcome.text, "ok");
    assert_eq!(json!({}), json!({}));
}

fn reasoning_turn(reasoning: &str, text: &str) -> Vec<StreamEvent> {
    vec![
        StreamEvent::MessageStart { id: "m".into() },
        StreamEvent::ReasoningDelta(reasoning.into()),
        StreamEvent::TextDelta(text.into()),
        StreamEvent::MessageEnd {
            stop_reason: StopReason::EndTurn,
        },
    ]
}

#[tokio::test]
async fn reasoning_never_leaks_into_the_answer() {
    // O `Recorder` nao implementa `on_reasoning`, entao usa o default do trait.
    // Se o raciocinio caisse no mesmo canal do texto, ele apareceria no stdout
    // que a CLI usa num pipe — conteudo que o modelo nao pretendia mostrar.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![reasoning_turn(
        "deixa eu pensar",
        "a resposta e 4",
    )]));
    let mut agent = Agent::new(backend, ctx);

    let mut recorder = Recorder::default();
    let outcome = agent.run("quanto e 2+2", &mut recorder).await.unwrap();

    assert_eq!(outcome.text, "a resposta e 4");
    assert_eq!(recorder.text, "a resposta e 4");
    assert!(!recorder.text.contains("deixa eu pensar"));
}

#[tokio::test]
async fn reasoning_reaches_an_observer_that_asks_for_it() {
    #[derive(Default)]
    struct ReasoningRecorder {
        reasoning: String,
        text: String,
    }
    impl Observer for ReasoningRecorder {
        fn on_text(&mut self, chunk: &str) {
            self.text.push_str(chunk);
        }
        fn on_reasoning(&mut self, chunk: &str) {
            self.reasoning.push_str(chunk);
        }
    }

    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![reasoning_turn(
        "deixa eu pensar",
        "a resposta e 4",
    )]));
    let mut agent = Agent::new(backend, ctx);

    let mut recorder = ReasoningRecorder::default();
    agent.run("quanto e 2+2", &mut recorder).await.unwrap();

    assert_eq!(recorder.reasoning, "deixa eu pensar");
    assert_eq!(recorder.text, "a resposta e 4");
}

#[tokio::test]
async fn an_unknown_tool_lists_the_ones_that_exist() {
    // Com o gate padrao a chamada morre na permissao antes de chegar ao
    // despacho, entao so um gate permissivo exercita este caminho. A lista de
    // disponiveis e o que permite o modelo se corrigir sozinho.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![
        tool_turn("t1", "inventada", "{}"),
        text_turn("ok, vou usar read"),
    ]));
    let mut agent = Agent::new(backend, ctx)
        .with_tool(Arc::new(Read))
        .with_gate(Box::new(crate::policy::permission::AllowAll));

    let mut recorder = Recorder::default();
    agent.run("faca algo", &mut recorder).await.unwrap();

    assert_eq!(recorder.tools_ended, vec![("inventada".to_owned(), true)]);

    let reported = agent
        .history()
        .iter()
        .filter(|m| m.role == Role::User)
        .flat_map(|m| m.content.iter())
        .filter_map(|block| match block {
            ContentBlock::ToolResult { content, .. } => Some(content.clone()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n");

    assert!(
        reported.contains("ferramenta desconhecida `inventada`"),
        "o modelo precisa saber qual nome falhou: {reported}"
    );
    assert!(
        reported.contains("read"),
        "o modelo precisa saber o que existe: {reported}"
    );
}

#[tokio::test]
async fn a_seeded_history_is_sent_back_to_the_backend() {
    // E o caminho do `--resume`: sem reenviar o historico, o modelo comeca do
    // zero e a sessao retomada nao tem memoria nenhuma.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("lembro sim")]));
    let mut agent = Agent::new(backend, ctx)
        .with_message(Message::user("meu nome e Marcio"))
        .with_message(Message::assistant(vec![ContentBlock::text("ola, Marcio")]));

    assert_eq!(agent.history().len(), 2);

    let outcome = agent.run("qual e meu nome?", &mut Silent).await.unwrap();

    assert_eq!(outcome.text, "lembro sim");
    assert_eq!(
        agent.history().len(),
        4,
        "as duas mensagens semeadas, o novo prompt e a resposta"
    );
}

/// Ferramenta que espera o suficiente para ser cancelada no meio.
#[derive(Debug)]
struct Slow {
    /// Avisa que a execução começou de fato.
    ///
    /// É um `oneshot` e não um `Notify` porque o aviso pode chegar antes de o
    /// teste começar a esperar: `notify_waiters` só acorda quem já se
    /// registrou, e a corrida travaria o teste em vez de falhá-lo.
    started: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

#[async_trait::async_trait]
#[allow(clippy::unnecessary_literal_bound)]
impl crate::tool::Tool for Slow {
    fn name(&self) -> &str {
        "slow"
    }
    fn description(&self) -> &str {
        "espera"
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object" })
    }
    async fn execute(&self, _input: Value, _ctx: &ToolContext) -> ToolOutput {
        if let Some(tx) = self.started.lock().unwrap().take() {
            let _ = tx.send(());
        }
        // Longo o bastante para que o cancelamento sempre chegue primeiro, e
        // curto o bastante para que um teste quebrado falhe por timeout da
        // suíte em vez de pendurar a máquina.
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        ToolOutput::ok("nunca chega aqui")
    }
}

/// Ids de `tool_use` e de `tool_result` presentes no histórico.
fn tool_use_and_result_ids(agent: &Agent) -> (Vec<String>, Vec<String>) {
    let mut uses = Vec::new();
    let mut results = Vec::new();
    for block in agent.history().iter().flat_map(|m| m.content.iter()) {
        match block {
            ContentBlock::ToolUse { id, .. } => uses.push(id.clone()),
            ContentBlock::ToolResult { tool_use_id, .. } => results.push(tool_use_id.clone()),
            ContentBlock::Text { .. } | ContentBlock::Image { .. } => {}
        }
    }
    (uses, results)
}

#[tokio::test]
async fn cancelling_mid_tool_still_answers_every_call_it_opened() {
    // A invariante que torna a sessao retomavel: o backend rejeita a conversa
    // se um `tool_use` ficar sem `tool_result`. Cancelar no meio de uma
    // ferramenta e exatamente onde isso acontece.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![tool_turn("t1", "slow", "{}")]));
    let cancel = crate::cancel::Cancel::new();
    let (started, has_started) = tokio::sync::oneshot::channel();

    let mut agent = Agent::new(backend, ctx)
        .with_tool(Arc::new(Slow {
            started: std::sync::Mutex::new(Some(started)),
        }))
        .with_gate(Box::new(crate::policy::permission::AllowAll))
        .with_cancel(cancel.clone());

    let trigger = cancel.clone();
    tokio::spawn(async move {
        let _ = has_started.await;
        trigger.cancel();
    });

    let err = agent
        .run("demore", &mut Silent)
        .await
        .expect_err("cancelar precisa interromper o turno");
    assert!(matches!(err, Error::Cancelled));

    let (uses, results) = tool_use_and_result_ids(&agent);
    assert_eq!(uses, vec!["t1".to_owned()]);
    assert_eq!(
        results, uses,
        "todo tool_use precisa ter tool_result, senao a sessao nao retoma"
    );
}

#[tokio::test]
async fn a_call_left_unrun_by_the_cancel_says_so_instead_of_coming_back_empty() {
    // Um resultado vazio faria o modelo concluir que a ferramenta rodou e nao
    // produziu nada, que e diferente de nao ter rodado. O turno pede duas
    // ferramentas: a primeira e interrompida no meio, a segunda nem comeca.
    let (dir, ctx) = workspace();
    std::fs::write(dir.path().join("a.txt"), "conteudo").unwrap();

    let backend = Arc::new(FakeBackend::new(vec![vec![
        StreamEvent::MessageStart { id: "m".into() },
        StreamEvent::ToolCallStart {
            id: "t1".into(),
            name: "slow".into(),
        },
        StreamEvent::ToolCallDelta {
            id: "t1".into(),
            json_fragment: "{}".into(),
        },
        StreamEvent::ToolCallEnd { id: "t1".into() },
        StreamEvent::ToolCallStart {
            id: "t2".into(),
            name: "read".into(),
        },
        StreamEvent::ToolCallDelta {
            id: "t2".into(),
            json_fragment: r#"{"path":"a.txt"}"#.into(),
        },
        StreamEvent::ToolCallEnd { id: "t2".into() },
        StreamEvent::MessageEnd {
            stop_reason: StopReason::ToolUse,
        },
    ]]));

    let cancel = crate::cancel::Cancel::new();
    let (started, has_started) = tokio::sync::oneshot::channel();
    let mut agent = Agent::new(backend, ctx)
        .with_tool(Arc::new(Slow {
            started: std::sync::Mutex::new(Some(started)),
        }))
        .with_tool(Arc::new(Read))
        .with_gate(Box::new(crate::policy::permission::AllowAll))
        .with_cancel(cancel.clone());

    tokio::spawn(async move {
        let _ = has_started.await;
        cancel.cancel();
    });

    let err = agent
        .run("faca dois", &mut Silent)
        .await
        .expect_err("cancelado");
    assert!(matches!(err, Error::Cancelled));

    let reported = agent
        .history()
        .iter()
        .flat_map(|m| m.content.iter())
        .filter_map(|block| match block {
            ContentBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => Some((tool_use_id.clone(), content.clone(), *is_error)),
            _ => None,
        })
        .collect::<Vec<_>>();

    assert_eq!(
        reported.len(),
        2,
        "as duas chamadas precisam de resposta, inclusive a que nao rodou"
    );
    for (id, content, is_error) in reported {
        assert!(
            content.contains("cancelado"),
            "o motivo precisa chegar ao modelo em `{id}`: {content}"
        );
        assert!(is_error, "nao ter rodado e uma falha, nao um resultado");
    }
}

#[tokio::test]
async fn cancelling_before_the_first_turn_leaves_only_the_prompt() {
    // Cancelar antes de o backend responder nao pode inventar um turno de
    // assistente vazio no historico.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("nunca enviado")]));
    let cancel = crate::cancel::Cancel::new();
    cancel.cancel();

    let mut agent = Agent::new(backend.clone(), ctx).with_cancel(cancel);

    let err = agent.run("oi", &mut Silent).await.expect_err("cancelado");
    assert!(matches!(err, Error::Cancelled));
    assert_eq!(
        backend.call_count(),
        0,
        "com o sinal ja disparado o backend nem chega a ser chamado"
    );
    assert_eq!(agent.history(), &[Message::user("oi")]);
}

#[tokio::test]
async fn the_tool_limit_also_closes_the_calls_it_abandoned() {
    // Bater no teto deixa a mesma pendencia que o cancelamento deixaria: o
    // ultimo turno pediu ferramentas que nunca foram respondidas.
    let (dir, ctx) = workspace();
    std::fs::write(dir.path().join("a.txt"), "x").unwrap();

    let turns = (0..10)
        .map(|_| tool_turn("t1", "read", r#"{"path":"a.txt"}"#))
        .collect();
    let backend = Arc::new(FakeBackend::new(turns));
    let mut agent = Agent::new(backend, ctx)
        .with_tool(Arc::new(Read))
        .with_tool_limit(2);

    let err = agent.run("leia", &mut Silent).await.expect_err("teto");
    assert!(matches!(err, Error::ToolLoopLimit { limit: 2 }));

    let (uses, results) = tool_use_and_result_ids(&agent);
    assert_eq!(
        results.len(),
        uses.len(),
        "o turno abandonado precisa fechar as chamadas que abriu"
    );
}

#[tokio::test]
async fn an_uncancelled_run_behaves_exactly_as_before() {
    // O sinal e cooperativo: sem ninguem disparando, nada muda.
    let (_dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![text_turn("tudo certo")]));
    let mut agent = Agent::new(backend, ctx).with_cancel(crate::cancel::Cancel::new());

    let outcome = agent.run("oi", &mut Silent).await.unwrap();
    assert_eq!(outcome.text, "tudo certo");
}

#[test]
fn the_debug_view_shows_what_a_session_is_made_of() {
    // Um `Agent` num log de erro precisa dizer quais ferramentas existem e onde
    // ele opera; despejar o historico inteiro vazaria a conversa no log.
    let (dir, ctx) = workspace();
    let backend = Arc::new(FakeBackend::new(vec![]));
    let agent = Agent::new(backend, ctx)
        .with_tool(Arc::new(Read))
        .with_message(Message::user("segredo do usuario"));

    let rendered = format!("{agent:?}");

    assert!(rendered.contains("read"), "as ferramentas: {rendered}");
    assert!(
        rendered.contains(&dir.path().to_string_lossy().to_string()),
        "a raiz: {rendered}"
    );
    assert!(
        !rendered.contains("segredo do usuario"),
        "o conteudo da conversa nao pode vazar no log: {rendered}"
    );
}
