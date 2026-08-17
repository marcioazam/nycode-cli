//! O loop de agente.

use std::collections::HashMap;
use std::sync::Arc;

use futures_util::StreamExt;
use nycode_ai::anthropic::{ContentBlock, Message};
use nycode_ai::{StopReason, StreamEvent, Usage};
use serde_json::Value;

use crate::backend::Backend;
use crate::cancel::Cancel;
use crate::error::{Error, Result};
use crate::policy::approval::Approver;
use crate::policy::permission::{Gate, ReadOnly};
use crate::session::compaction::DEFAULT_KEEP_RECENT;
use crate::tool::{Tool, ToolContext, ToolOutput};
use crate::turn::Turn;

/// Teto de idas e voltas de ferramenta num único pedido do usuário.
///
/// Um modelo em loop — lendo o mesmo arquivo repetidamente, por exemplo —
/// consome a cota inteira sem produzir nada. O teto transforma isso num erro
/// visível em vez de uma fatura.
pub const DEFAULT_TOOL_LIMIT: usize = 50;

/// Resultado que uma ferramenta não executada por cancelamento devolve ao modelo.
///
/// Precisa existir como texto porque o par `tool_use`/`tool_result` é
/// obrigatório: a alternativa seria gravar uma sessão que o backend recusa a
/// retomar.
const CANCELLED_BY_USER: &str = "cancelado pelo usuario antes de executar";

/// Recebe o que acontece durante o turno.
///
/// Existe para que a CLI imprima incrementalmente e os testes capturem sem
/// depender de terminal.
pub trait Observer: Send {
    fn on_text(&mut self, _chunk: &str) {}
    fn on_reasoning(&mut self, _chunk: &str) {}
    fn on_tool_start(&mut self, _name: &str, _input: &Value) {}
    fn on_tool_end(&mut self, _name: &str, _output: &ToolOutput) {}
    /// Algo aconteceu com a sessão que o usuário precisa saber.
    ///
    /// Compactar o histórico muda o que o modelo lembra. Fazer isso em silêncio
    /// deixaria o usuário sem explicação para o agente ter esquecido algo.
    fn on_notice(&mut self, _text: &str) {}
}

/// Observer que descarta tudo.
#[derive(Debug, Default, Clone, Copy)]
pub struct Silent;
impl Observer for Silent {}

/// Resultado de um pedido completo do usuário.
#[derive(Debug, Clone, PartialEq)]
pub struct Outcome {
    pub text: String,
    pub stop_reason: StopReason,
    pub tool_rounds: usize,
    /// Soma do usage de todos os turnos do pedido.
    ///
    /// Um pedido com ferramentas custa vários turnos, e reportar só o último
    /// esconderia a maior parte da conta justamente nos pedidos mais caros.
    pub usage: Usage,
}

/// Como um turno terminou de ser lido do stream.
///
/// O texto parcial entra no histórico marcado para não reenvio: o usuário viu;
/// o provedor recusa o incompleto.
#[derive(Debug)]
enum TurnEnd {
    Complete(Turn),
    Cancelled(Turn),
}

/// Como uma rodada de ferramentas terminou.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RoundEnd {
    Complete,
    Cancelled,
}

pub struct Agent {
    backend: Arc<dyn Backend>,
    tools: HashMap<String, Arc<dyn Tool>>,
    ctx: ToolContext,
    gate: Box<dyn Gate>,
    messages: Vec<Message>,
    system: Option<String>,
    tool_limit: usize,
    /// Quantos turnos recentes a compactacao preserva intactos.
    keep_recent: usize,
    /// Janela de contexto que o catálogo declara para o modelo atual.
    ///
    /// `None` enquanto o catálogo não a declara, e é assim que fica: sem número
    /// declarado não há com o que comparar o usage, e chutar um faria o harness
    /// acusar truncamento onde não houve.
    context_window: Option<u64>,
    cancel: Cancel,
    approver: Arc<dyn Approver>,
    /// Mensagens que o usuário digitou enquanto o turno corria.
    steering: Option<tokio::sync::mpsc::Receiver<String>>,
    hooks: crate::policy::Hooks,
    /// O que este pedido acrescentou à conversa, na ordem em que aconteceu.
    ///
    /// Separado de `messages` porque os dois respondem a perguntas diferentes:
    /// `messages` é o contexto que vai ao modelo e a compactação o reescreve
    /// para caber na janela; isto é o registro do que aconteceu, que vai para o
    /// arquivo de sessão e não pode encolher junto. Rastrear a diferença por
    /// índice sobre `messages` não sobrevive a uma compactação no meio do
    /// pedido — o índice passa a apontar para outra mensagem, ou para além do
    /// fim.
    journal: Vec<Message>,
}

impl std::fmt::Debug for Agent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Agent")
            .field("tools", &self.tools.keys().collect::<Vec<_>>())
            .field("root", &self.ctx.root())
            .field("messages", &self.messages.len())
            .finish_non_exhaustive()
    }
}

mod dispatch;
mod shrink;
pub mod transform;

impl Agent {
    pub fn new(backend: Arc<dyn Backend>, ctx: ToolContext) -> Self {
        Self {
            backend,
            tools: HashMap::new(),
            ctx,
            // Somente-leitura ate que o operador diga o contrario. Ver
            // `permission::ReadOnly`.
            gate: Box::new(ReadOnly),
            messages: Vec::new(),
            system: None,
            tool_limit: DEFAULT_TOOL_LIMIT,
            keep_recent: DEFAULT_KEEP_RECENT,
            context_window: None,
            cancel: Cancel::new(),
            // Sem ninguém a quem perguntar, a resposta é não: aprovar por
            // omissão daria a um pipeline a permissão que ninguém concedeu.
            approver: Arc::new(crate::policy::Never),
            steering: None,
            hooks: crate::policy::Hooks::default(),
            journal: Vec::new(),
        }
    }

    /// Acrescenta uma mensagem à conversa durante um pedido.
    ///
    /// Todo caminho que fala com o modelo passa por aqui: é o que impede o
    /// contexto e o registro durável de divergirem em silêncio.
    fn record(&mut self, message: Message) {
        self.journal.push(message.clone());
        self.messages.push(message);
    }

    fn record_sent(
        &mut self,
        text: &str,
        calls: &[crate::tool::ToolCall],
        reason: &StopReason,
        cancelled: bool,
    ) {
        if let Some(message) =
            transform::assistant_turn(text, calls, transform::discard_on_send(reason, cancelled))
        {
            self.record(message);
        }
    }

    /// O que este pedido acrescentou, para quem precisa persistir.
    ///
    /// Não inclui o histórico com que a sessão foi aberta, nem o marcador que a
    /// compactação insere — esse é um artefato da janela de contexto e não algo
    /// que a conversa tenha produzido.
    #[must_use]
    pub fn produced(&self) -> &[Message] {
        &self.journal
    }

    /// Substitui quem responde quando o gate pergunta.
    #[must_use]
    pub fn with_approver(mut self, approver: Arc<dyn Approver>) -> Self {
        self.approver = approver;
        self
    }

    /// Substitui o sinal de cancelamento por um compartilhado com o chamador.
    #[must_use]
    pub fn with_cancel(mut self, cancel: Cancel) -> Self {
        self.cancel = cancel;
        self
    }

    #[must_use]
    pub fn with_tool(mut self, tool: Arc<dyn Tool>) -> Self {
        self.tools.insert(tool.name().to_owned(), tool);
        self
    }

    /// Substitui o gate de permissao.
    #[must_use]
    pub fn with_gate(mut self, gate: Box<dyn Gate>) -> Self {
        self.gate = gate;
        self
    }

    /// Semeia o histórico com uma mensagem, para retomar uma sessão.
    #[must_use]
    pub fn with_message(mut self, message: Message) -> Self {
        self.messages.push(message);
        self
    }

    #[must_use]
    pub fn with_system(mut self, system: impl Into<String>) -> Self {
        self.system = Some(system.into());
        self
    }

    #[must_use]
    pub const fn with_tool_limit(mut self, limit: usize) -> Self {
        self.tool_limit = limit;
        self
    }

    #[must_use]
    pub fn history(&self) -> &[Message] {
        &self.messages
    }

    /// Roda um pedido do usuário até o modelo parar de pedir ferramentas.
    ///
    /// Cancelar devolve [`Error::Cancelled`] com o histórico já fechado: o
    /// chamador pode gravá-lo e retomar a sessão depois. O que não pode
    /// acontecer é sair com um `tool_use` sem `tool_result`, porque o backend
    /// recusa a conversa na retomada.
    pub async fn run(&mut self, prompt: &str, observer: &mut impl Observer) -> Result<Outcome> {
        self.run_with(prompt, Vec::new(), observer).await
    }

    /// O mesmo, com blocos extras no pedido — imagens, por exemplo (FR-20).
    ///
    /// Os anexos vêm antes do texto porque é assim que os dialetos esperam: o
    /// texto costuma se referir à imagem, e o modelo lê na ordem em que chega.
    pub async fn run_with(
        &mut self,
        prompt: &str,
        attachments: Vec<ContentBlock>,
        observer: &mut impl Observer,
    ) -> Result<Outcome> {
        let mut content = attachments;
        content.push(ContentBlock::text(prompt));
        // O registro é deste pedido: o que o anterior acrescentou já foi
        // persistido por quem o pediu.
        self.journal.clear();
        self.record(Message::user_blocks(content));

        let mut rounds = 0;
        let mut usage = Usage::default();
        let mut compactions = 0;
        loop {
            // Direcionamento entra aqui e em nenhum outro lugar: entre rodadas
            // o histórico está fechado, com todo `tool_use` já pareado. Injetar
            // no meio de uma rodada quebraria o par e o backend recusaria a
            // conversa inteira.
            for message in self.take_steering() {
                observer.on_notice(&format!("acrescentado ao turno: {message}"));
                self.record(Message::user(message));
            }

            let (turn, interrupted) = match self.stream_one_turn(observer).await {
                Ok(TurnEnd::Complete(turn)) => (turn, false),
                Ok(TurnEnd::Cancelled(turn)) => (turn, true),
                Err(err) if shrink::should_compact(&err, compactions) => {
                    let Some(removed) = self.compact_history().await else {
                        // Já está no mínimo: insistir repetiria o mesmo pedido
                        // e o mesmo erro, num laço.
                        return Err(err);
                    };
                    compactions += 1;
                    observer.on_notice(&format!(
                        "contexto estourou; {removed} mensagens antigas foram compactadas"
                    ));
                    continue;
                }
                Err(err) => return Err(err),
            };
            usage += turn.usage();
            // Um turno que terminou sem dizer por quê não é um turno concluído.
            // `event.rs` se recusa a inventar `EndTurn` na projeção do wire, e
            // inventá-lo aqui desfaria a garantia uma camada acima: `EndTurn`
            // vira código de saída zero, e o pedido sai indistinguível de um
            // que o gateway deu por encerrado.
            let stop_reason = turn
                .stop_reason()
                .cloned()
                .unwrap_or_else(|| StopReason::Unrecognized("ausente".to_owned()));
            let calls = turn.tool_calls();

            // Um argumento que chegou pela metade foi reparado, e isso se diz:
            // sem o aviso, um stream truncado vira uma chamada de aparência
            // normal e o usuário atribui ao modelo uma decisão do transporte.
            for name in turn.repaired_calls() {
                observer.on_notice(&format!(
                    "os argumentos de `{name}` chegaram truncados; o que veio inteiro foi aproveitado e o resto, descartado"
                ));
            }

            // O provider também reporta estouro de janela sem erro nenhum
            // (FR-5): status 200, stream bem formado, e a janela estourada
            // escondida no `stop_reason` ou no usage. Ler isso aqui é o que
            // impede a falha de sair daqui com cara de resposta.
            let overflowed = shrink::silent_overflow(
                &stop_reason,
                turn.text().is_empty() && calls.is_empty(),
                turn.usage().input_tokens,
                self.context_window,
            );

            // Turno vazio não se registra: gravá-lo poluiria o histórico com um
            // assistente que não disse nada, e é justamente o histórico que
            // precisa encolher para o próximo caber.
            if overflowed == Some(shrink::SilentOverflow::ProducedNothing)
                && shrink::may_compact(compactions)
                && let Some(removed) = self.compact_history().await
            {
                compactions += 1;
                observer.on_notice(&format!(
                    "o turno parou no limite sem produzir nada; {removed} mensagens antigas foram compactadas"
                ));
                continue;
            }

            self.record_sent(turn.text(), &calls, &stop_reason, interrupted);

            if let Some(shrink::SilentOverflow::InputAboveWindow { input, window }) = overflowed {
                // A resposta veio e vale; o que não pode é o próximo turno ser
                // truncado do mesmo jeito, com o modelo esquecendo o começo da
                // conversa e nada dizendo por quê.
                observer.on_notice(&format!(
                    "a entrada deste turno ({input} tokens) passou da janela declarada ({window}); o provider truncou o inicio da conversa"
                ));
                if shrink::may_compact(compactions)
                    && let Some(removed) = self.compact_history().await
                {
                    compactions += 1;
                    observer.on_notice(&format!(
                        "{removed} mensagens antigas foram compactadas para o proximo turno caber"
                    ));
                }
            }

            if interrupted {
                self.close_pending_calls(&calls);
                return Err(Error::Cancelled);
            }

            if !turn.wants_tools() || calls.is_empty() {
                return Ok(Outcome {
                    text: turn.text().to_owned(),
                    stop_reason,
                    tool_rounds: rounds,
                    usage,
                });
            }

            rounds += 1;
            if rounds > self.tool_limit {
                // O teto estourado deixa `tool_use` sem par, pela mesma razão
                // que o cancelamento deixaria. Fechar aqui mantém a sessão
                // retomável mesmo depois de um turno abortado.
                self.close_pending_calls(&calls);
                return Err(Error::ToolLoopLimit {
                    limit: self.tool_limit,
                });
            }

            if self.run_tool_round(&calls, observer).await == RoundEnd::Cancelled {
                return Err(Error::Cancelled);
            }
        }
    }

    /// Recebe o que o usuário digitou enquanto o turno corria.
    ///
    /// O canal é a única forma de o usuário falar com um turno em andamento sem
    /// interrompê-lo: sem ele, corrigir o rumo exige cancelar e recomeçar,
    /// jogando fora o que as ferramentas já fizeram.
    #[must_use]
    pub fn with_steering(mut self, inbox: tokio::sync::mpsc::Receiver<String>) -> Self {
        self.steering = Some(inbox);
        self
    }

    /// Recolhe tudo que chegou pelo canal, sem esperar.
    fn take_steering(&mut self) -> Vec<String> {
        let Some(inbox) = self.steering.as_mut() else {
            return Vec::new();
        };
        let mut collected = Vec::new();
        while let Ok(message) = inbox.try_recv() {
            if !message.trim().is_empty() {
                collected.push(message);
            }
        }
        collected
    }

    /// Substitui o histórico, ao retomar de outro ponto da árvore.
    pub fn set_history(&mut self, messages: Vec<Message>) {
        self.messages = messages;
    }

    /// Troca o backend no meio da sessão.
    ///
    /// É o que a troca de modelo precisa. O histórico fica: continuar a mesma
    /// conversa com outro modelo é o ponto — recomeçar seria só abrir outra
    /// sessão, que já dava para fazer.
    pub fn set_backend(&mut self, backend: Arc<dyn Backend>) {
        self.backend = backend;
    }

    /// Troca o gate no meio da sessão.
    ///
    /// É o que o plan mode precisa: entrar e sair sem derrubar a conversa.
    /// Refazer a sessão para mudar de modo perderia o contexto que é
    /// justamente o insumo do plano.
    pub fn set_gate(&mut self, gate: Box<dyn Gate>) {
        self.gate = gate;
    }

    /// Troca o prompt de sistema no meio da sessão.
    pub fn set_system(&mut self, system: Option<String>) {
        self.system = system;
    }

    /// O prompt de sistema em uso.
    #[must_use]
    pub fn system(&self) -> Option<&str> {
        self.system.as_deref()
    }

    async fn stream_one_turn(&self, observer: &mut impl Observer) -> Result<TurnEnd> {
        let mut stream = tokio::select! {
            biased;
            () = self.cancel.cancelled() => return Ok(TurnEnd::Cancelled(Turn::new())),
            // O histórico vai ajustado, e não cru: um `tool_use` sem
            // `tool_result` faz o provedor recusar o pedido inteiro, e retomar
            // um ponto da árvore (FR-14) ou trocar de modelo (FR-19) produz
            // exatamente esse par quebrado.
            stream = self.backend.stream(
                transform::for_provider(&self.messages),
                self.system.clone(),
                self.specs(),
            ) => stream?,
        };

        let mut turn = Turn::new();
        loop {
            let next = tokio::select! {
                biased;
                // Cancelar o stream é largá-lo: o transporte não guarda estado
                // global a limpar. Ver a nota em `transport::client`.
                () = self.cancel.cancelled() => return Ok(TurnEnd::Cancelled(turn)),
                next = stream.next() => next,
            };
            let Some(event) = next else { break };

            let event = event?;
            match &event {
                StreamEvent::TextDelta(chunk) => observer.on_text(chunk),
                StreamEvent::ReasoningDelta(chunk) => observer.on_reasoning(chunk),
                _ => {}
            }
            turn.absorb(event);
        }
        Ok(TurnEnd::Complete(turn))
    }
}
