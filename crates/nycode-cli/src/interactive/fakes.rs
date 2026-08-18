//! Dublês do laço interativo.
//!
//! Existem separados dos testes porque mudam por outra razão: estes acompanham
//! os traits [`Surface`] e [`Turns`], enquanto os testes acompanham o
//! comportamento. São eles que permitem exercitar a sessão inteira sem TTY e
//! sem rede — um teste que precisasse dos dois não rodaria no CI, e o
//! comportamento ficaria sem proteção.

use std::sync::{Arc, Mutex};

use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use futures_util::Stream;
use nycode_ai::Usage;
use nycode_ai::anthropic::Message;

use super::{Surface, Turns};

/// Superfície que grava o que teria ido para a tela.
#[derive(Debug)]
pub struct Recording {
    pub frames: Vec<Vec<String>>,
    pub scrollback: String,
    pub width: usize,
}

impl Recording {
    pub fn new() -> Self {
        Self {
            frames: Vec::new(),
            scrollback: String::new(),
            width: 80,
        }
    }

    pub fn last_frame(&self) -> &[String] {
        self.frames.last().map_or(&[], Vec::as_slice)
    }
}

impl Surface for Recording {
    fn draw(&mut self, frame: &[String]) -> std::io::Result<()> {
        self.frames.push(frame.to_vec());
        Ok(())
    }
    fn emit(&mut self, text: &str) -> std::io::Result<()> {
        self.scrollback.push_str(text);
        Ok(())
    }
    fn width(&self) -> usize {
        self.width
    }
    fn resize(&mut self, width: usize) {
        self.width = width;
    }
}

/// Agente de mentira: registra os pedidos e devolve o que foi programado.
#[derive(Debug, Default)]
pub struct Scripted {
    pub prompts: Arc<Mutex<Vec<String>>>,
    pub usage: Usage,
    pub fail_with: Option<String>,
    pub history: Vec<Message>,
    pub pending: Vec<Message>,
    pub planning: bool,
    pub model: String,
    pub last_system: Arc<Mutex<Option<String>>>,
    pub retargets: Arc<Mutex<Vec<(String, String)>>>,
}

#[async_trait::async_trait]
impl Turns for Scripted {
    async fn run(&mut self, prompt: &str) -> anyhow::Result<Usage> {
        self.prompts.lock().unwrap().push(prompt.to_owned());
        self.pending.push(Message::user(prompt));
        if let Some(reason) = &self.fail_with {
            return Err(anyhow::anyhow!(reason.clone()));
        }
        Ok(self.usage)
    }
    fn drain(&mut self) -> Vec<Message> {
        std::mem::take(&mut self.pending)
    }
    fn history(&self) -> Vec<Message> {
        self.history.clone()
    }
    fn replace_history(&mut self, messages: Vec<Message>) {
        self.history = messages;
    }
    fn set_planning(&mut self, planning: bool) {
        self.planning = planning;
    }
    fn switch_model(&mut self, model: &str) -> anyhow::Result<()> {
        self.model = model.to_owned();
        Ok(())
    }
    fn set_system(&mut self, system: String) {
        *self.last_system.lock().unwrap() = Some(system);
    }
    fn retarget_backend(&mut self, session_id: &str, model: &str) -> anyhow::Result<()> {
        self.retargets
            .lock()
            .unwrap()
            .push((session_id.to_owned(), model.to_owned()));
        Ok(())
    }
    async fn compact(&mut self) -> usize {
        let removed = self.history.len().saturating_sub(1);
        self.history.truncate(1);
        removed
    }
}

/// Agente de mentira que atende o cancelamento como o de verdade.
///
/// Reproduz o que [`crate::screen::Agentic`] faz: com o sinal disparado o turno
/// nem chega ao backend, e o cancelamento vira sucesso vazio em vez de erro.
/// Sem este dublê, um teste do laço não distingue sinal intacto de sinal preso,
/// porque [`Scripted`] roda sempre.
#[derive(Debug)]
pub struct CancelAware {
    pub prompts: Arc<Mutex<Vec<String>>>,
    cancel: nycode_agent::Cancel,
    pending: Vec<Message>,
}

impl CancelAware {
    pub fn new(cancel: nycode_agent::Cancel) -> Self {
        Self {
            prompts: Arc::new(Mutex::new(Vec::new())),
            cancel,
            pending: Vec::new(),
        }
    }
}

#[async_trait::async_trait]
impl Turns for CancelAware {
    async fn run(&mut self, prompt: &str) -> anyhow::Result<Usage> {
        // O histórico recebe o pedido antes de o turno começar, como em
        // `Agent::run_with` — é por isso que um sinal preso grava no disco uma
        // mensagem que nunca foi respondida.
        self.pending.push(Message::user(prompt));
        if self.cancel.is_cancelled() {
            return Ok(Usage::default());
        }
        self.prompts.lock().unwrap().push(prompt.to_owned());
        Ok(Usage::default())
    }
    fn drain(&mut self) -> Vec<Message> {
        std::mem::take(&mut self.pending)
    }
    fn history(&self) -> Vec<Message> {
        Vec::new()
    }
    fn replace_history(&mut self, _messages: Vec<Message>) {}
    fn set_planning(&mut self, _planning: bool) {}
    fn switch_model(&mut self, _model: &str) -> anyhow::Result<()> {
        Ok(())
    }
    fn set_system(&mut self, _system: String) {}
    fn retarget_backend(&mut self, _session_id: &str, _model: &str) -> anyhow::Result<()> {
        Ok(())
    }
    async fn compact(&mut self) -> usize {
        0
    }
}

/// Backend que não emite nada, para montar um agente real sem rede.
#[derive(Debug)]
pub struct Mute;

#[async_trait::async_trait]
impl nycode_agent::Backend for Mute {
    async fn stream(
        &self,
        _messages: Vec<Message>,
        _system: Option<String>,
        _tools: Vec<nycode_ai::anthropic::ToolSpec>,
    ) -> nycode_ai::Result<nycode_agent::backend::EventStream> {
        Ok(Box::pin(futures_util::stream::empty()))
    }
}

pub fn key(code: KeyCode) -> Event {
    Event::Key(KeyEvent::new(code, KeyModifiers::NONE))
}

pub fn ctrl(ch: char) -> Event {
    Event::Key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::CONTROL))
}

pub fn typing(text: &str) -> Vec<Event> {
    text.chars().map(|c| key(KeyCode::Char(c))).collect()
}

/// Fluxo de eventos bem-sucedidos, como o terminal entregaria.
pub fn delivered(events: Vec<Event>) -> impl Stream<Item = std::io::Result<Event>> + Unpin {
    futures_util::stream::iter(events.into_iter().map(Ok))
}
