//! Aprovação sob demanda de uma chamada de ferramenta.
//!
//! O gate ao lado decide sozinho quando a resposta é óbvia: ler sempre pode,
//! escrever nunca pode numa sessão somente-leitura. Isto cobre o caso do meio —
//! a sessão que quer perguntar em vez de decidir de antemão.
//!
//! Em modo headless não há a quem perguntar, e o padrão é negar. Aprovar por
//! omissão daria a um pipeline de CI a permissão que ninguém concedeu.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use sha2::{Digest as _, Sha256};

use crate::tool::ToolCall;

/// Quem responde quando o gate pergunta.
#[async_trait]
pub trait Approver: Send + Sync + std::fmt::Debug {
    /// Se esta chamada pode rodar.
    async fn approve(&self, call: &ToolCall) -> bool;
}

/// Nega tudo que chegar. É o padrão.
///
/// Vale para o modo headless, onde perguntar não é possível: a permissão
/// precisa ser dada de antemão, por flag, ou não é dada.
#[derive(Debug, Default, Clone, Copy)]
pub struct Never;

#[async_trait]
impl Approver for Never {
    async fn approve(&self, _call: &ToolCall) -> bool {
        false
    }
}

/// Aprova tudo. Existe para quem já decidiu antes de abrir a sessão.
#[derive(Debug, Default, Clone, Copy)]
pub struct Always;

#[async_trait]
impl Approver for Always {
    async fn approve(&self, _call: &ToolCall) -> bool {
        true
    }
}

/// Um pedido de aprovação esperando resposta.
#[derive(Debug)]
pub struct Request {
    pub call: ToolCall,
    answer: tokio::sync::oneshot::Sender<bool>,
}

impl Request {
    /// Responde ao pedido.
    ///
    /// Uma resposta perdida — porque a interface caiu, por exemplo — deixa o
    /// lado que pergunta com a resposta negativa, que é a segura.
    pub fn answer(self, approved: bool) {
        let _ = self.answer.send(approved);
    }
}

/// Aprovador que delega a decisão a quem estiver atendendo o canal.
///
/// Existe porque quem sabe perguntar é o laço de interface, e ele não pode ser
/// chamado de dentro do loop de agente: os dois correm ao mesmo tempo, e o laço
/// já está esperando eventos. O canal é o que os une sem inverter a posse.
#[derive(Debug)]
pub struct Asking {
    requests: tokio::sync::mpsc::Sender<Request>,
}

impl Asking {
    /// Cria o aprovador e a ponta que recebe os pedidos.
    #[must_use]
    pub fn channel() -> (Self, tokio::sync::mpsc::Receiver<Request>) {
        let (requests, inbox) = tokio::sync::mpsc::channel(1);
        (Self { requests }, inbox)
    }
}

#[async_trait]
impl Approver for Asking {
    async fn approve(&self, call: &ToolCall) -> bool {
        let (answer, response) = tokio::sync::oneshot::channel();
        let request = Request {
            call: call.clone(),
            answer,
        };

        // Ninguém atendendo é o mesmo que ninguém tendo aprovado. Bloquear
        // aqui penduraria o turno esperando uma resposta que não vem.
        if self.requests.send(request).await.is_err() {
            return false;
        }
        response.await.unwrap_or(false)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub struct ApprovalKey {
    actor: String,
    tool: String,
    target: String,
    params: String,
}

impl ApprovalKey {
    #[must_use]
    pub fn of(actor: &str, call: &ToolCall) -> Option<Self> {
        let target = canonical_target(call)?;
        Some(Self {
            actor: actor.to_owned(),
            tool: call.name.clone(),
            target,
            params: digest_params(&call.input),
        })
    }
}

fn nonempty_str(input: &serde_json::Value, key: &str) -> Option<String> {
    let value = input.get(key)?.as_str()?.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_owned())
    }
}

fn path_target(call: &ToolCall) -> Option<String> {
    nonempty_str(&call.input, "path").or_else(|| nonempty_str(&call.input, "file"))
}

fn shell_target(call: &ToolCall) -> Option<String> {
    if let Some(command) = nonempty_str(&call.input, "command") {
        return Some(command);
    }
    if let Some(description) = nonempty_str(&call.input, "description") {
        return Some(description);
    }
    let argv = call.input.get("argv")?.as_array()?;
    if argv.is_empty() {
        return None;
    }
    Some(
        argv.iter()
            .filter_map(serde_json::Value::as_str)
            .collect::<Vec<_>>()
            .join("\0"),
    )
}

fn canonical_target(call: &ToolCall) -> Option<String> {
    if let Some(path) = path_target(call) {
        return Some(path);
    }
    if matches!(call.name.as_str(), "write" | "edit" | "read") {
        return None;
    }
    if let Some(shell) = shell_target(call) {
        return Some(shell);
    }
    match call.name.as_str() {
        "bash" | "task" => None,
        _ => Some(call.name.clone()),
    }
}

fn digest_params(input: &serde_json::Value) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.to_string().as_bytes());
    hex::encode(hasher.finalize())
}

#[derive(Debug)]
pub struct Bound {
    actor: String,
    inner: Arc<dyn Approver>,
    granted: Mutex<HashSet<ApprovalKey>>,
}

impl Bound {
    #[must_use]
    pub fn new(actor: impl Into<String>, inner: Arc<dyn Approver>) -> Self {
        Self {
            actor: actor.into(),
            inner,
            granted: Mutex::new(HashSet::new()),
        }
    }

    fn already(&self, key: &ApprovalKey) -> bool {
        self.granted
            .lock()
            .map(|granted| granted.contains(key))
            .unwrap_or(false)
    }

    fn remember(&self, key: ApprovalKey) {
        if let Ok(mut granted) = self.granted.lock() {
            granted.insert(key);
        }
    }
}

#[async_trait]
impl Approver for Bound {
    async fn approve(&self, call: &ToolCall) -> bool {
        let Some(key) = ApprovalKey::of(&self.actor, call) else {
            return false;
        };
        if self.already(&key) {
            return true;
        }
        if !self.inner.approve(call).await {
            return false;
        }
        self.remember(key);
        true
    }
}

#[cfg(test)]
#[path = "approval_test.rs"]
mod tests;
