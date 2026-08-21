//! Ferramenta `task`: delega um trabalho a um agente filho (FR-15).
//!
//! Existe pela janela de contexto. Uma busca que lê trinta arquivos para achar
//! três linhas gasta a janela inteira do pai com o que ele não vai precisar de
//! novo; delegada, ela devolve as três linhas e o resto morre com o filho.
//!
//! Diverge da referência de propósito: o `pi` recusa subagentes e recomenda
//! `tmux`. A recusa dele é sobre agentes concorrentes de longa duração; isto é
//! outra coisa — uma chamada síncrona que devolve texto e acaba
//! ([ADR-0007](../../../../docs/architecture/decisions/0007-subagentes-sao-in-process-divergindo-da-referencia.md)).
//!
//! O filho não vê o histórico do pai. Herdá-lo desfaria a razão de existir da
//! ferramenta: o custo seria o mesmo e a janela do pai não sobraria.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};

use crate::agent::{Agent, Silent};
use crate::backend::Backend;
use crate::error::{Error, Result};
use crate::policy::Gate;
use crate::tool::{Tool, ToolContext, ToolOutput};

const CHILD_TOOL_LIMIT: usize = 12;
const ENVELOPE_TTL_MS: u64 = 300_000;
const CHILD_SYSTEM: &str = "Voce e um subagente do nycode, chamado para uma tarefa \
     delimitada. Trabalhe de forma autonoma: nao ha usuario para perguntar. \
     Responda com o resultado, nao com a narracao do que voce fez — quem chamou \
     recebe apenas o seu texto final e precisa que ele seja suficiente.";

pub struct Task {
    backend: Arc<dyn Backend>,
    gate: Arc<dyn Fn() -> Box<dyn Gate> + Send + Sync>,
    mac_key: [u8; 32],
}

impl std::fmt::Debug for Task {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Task").finish_non_exhaustive()
    }
}

impl Task {
    #[must_use = "use a tarefa ou trate o erro de inicializacao"]
    pub async fn new(backend: Arc<dyn Backend>) -> Result<Self> {
        let mac_key = tokio::task::spawn_blocking(new_key)
            .await
            .map_err(|err| Error::Randomness(format!("gerar chave em worker: {err}")))??;
        Ok(Self {
            backend,
            gate: Arc::new(|| Box::new(crate::policy::ReadOnly)),
            mac_key,
        })
    }

    /// Define como o filho é permissionado.
    #[must_use]
    pub fn with_gate(mut self, gate: impl Fn() -> Box<dyn Gate> + Send + Sync + 'static) -> Self {
        self.gate = Arc::new(gate);
        self
    }

    /// Monta o filho.
    ///
    /// Sem a própria `task` no catálogo: a recursão é impedida pela construção,
    /// e não por um contador que dependeria de o modelo respeitá-lo.
    fn child(&self, ctx: &ToolContext) -> Agent {
        let mut agent = Agent::new(Arc::clone(&self.backend), ctx.clone())
            .with_system(CHILD_SYSTEM)
            .with_gate((self.gate)())
            .with_tool_limit(CHILD_TOOL_LIMIT);
        for tool in crate::tools::all() {
            agent = agent.with_tool(tool);
        }
        agent
    }

    fn mac(&self, description: &str, exp: u64) -> String {
        hex::encode(hmac_sha256(
            &self.mac_key,
            &envelope_payload(description, exp),
        ))
    }

    fn envelope_ok(&self, description: &str, envelope: &Value) -> bool {
        let Some(mac) = envelope.get("mac").and_then(Value::as_str) else {
            return false;
        };
        let Some(exp) = envelope.get("exp").and_then(Value::as_u64) else {
            return false;
        };
        let now = now_millis();
        if exp <= now || exp.saturating_sub(now) > ENVELOPE_TTL_MS {
            return false;
        }
        mac == self.mac(description, exp)
    }
}

#[async_trait]
#[allow(clippy::unnecessary_literal_bound)]
impl Tool for Task {
    fn name(&self) -> &str {
        "task"
    }

    fn description(&self) -> &str {
        "Delega uma tarefa delimitada a um subagente com contexto proprio. Use \
         para trabalho exploratorio cujo caminho voce nao precisa guardar — \
         localizar onde algo esta implementado, resumir um diretorio grande. O \
         subagente nao ve esta conversa, entao a descricao precisa bastar por si; \
         ele devolve so o texto final."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "description": {
                    "type": "string",
                    "description": "A tarefa, completa e autocontida"
                }
            },
            "required": ["description"]
        })
    }

    fn prepare(&self, mut input: Value) -> Value {
        if input.get("envelope").is_some() {
            return input;
        }
        let Some(description) = input.get("description").and_then(Value::as_str) else {
            return input;
        };
        let description = description.to_owned();
        let exp = now_millis().saturating_add(ENVELOPE_TTL_MS);
        let mac = self.mac(&description, exp);
        if let Some(obj) = input.as_object_mut() {
            obj.insert("envelope".into(), json!({ "exp": exp, "mac": mac }));
        }
        input
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolOutput {
        let Some(description) = input.get("description").and_then(Value::as_str) else {
            return ToolOutput::error("argumento obrigatorio ausente: `description`");
        };
        if description.trim().is_empty() {
            return ToolOutput::error("`description` vazia nao e uma tarefa");
        }
        let Some(envelope) = input.get("envelope") else {
            return ToolOutput::error("envelope ausente");
        };
        if !self.envelope_ok(description, envelope) {
            return ToolOutput::error("envelope rejeitado");
        }

        let mut child = self.child(ctx);
        match child.run(description, &mut Silent).await {
            // Resposta vazia é um resultado inútil disfarçado de sucesso; o pai
            // precisa saber para tentar outra coisa.
            Ok(outcome) if outcome.text.trim().is_empty() => {
                ToolOutput::error("o subagente terminou sem produzir resposta")
            }
            Ok(outcome) => ToolOutput::ok(outcome.text),
            Err(err) => ToolOutput::error(format!("o subagente falhou: {err}")),
        }
    }
}
fn new_key() -> Result<[u8; 32]> {
    let file = std::fs::File::open("/dev/urandom")
        .map_err(|err| Error::Randomness(format!("/dev/urandom: {err}")))?;
    key_from(file)
}
fn key_from(mut source: impl std::io::Read) -> Result<[u8; 32]> {
    let mut key = [0u8; 32];
    source
        .read_exact(&mut key)
        .map_err(|err| Error::Randomness(format!("fonte de entropia: {err}")))?;
    Ok(key)
}
fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}
fn envelope_payload(description: &str, exp: u64) -> Vec<u8> {
    let mut msg = Vec::new();
    msg.extend_from_slice(&exp.to_le_bytes());
    msg.extend_from_slice(description.as_bytes());
    msg
}
fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    const BLK: usize = 64;
    let mut key_block = [0u8; BLK];
    if key.len() > BLK {
        let digested = Sha256::digest(key);
        key_block[..32].copy_from_slice(&digested);
    } else {
        key_block[..key.len()].copy_from_slice(key);
    }
    let mut ipad = [0x36u8; BLK];
    let mut opad = [0x5cu8; BLK];
    for (i, byte) in key_block.iter().enumerate() {
        ipad[i] ^= byte;
        opad[i] ^= byte;
    }
    let mut inner = Sha256::new();
    inner.update(ipad);
    inner.update(msg);
    let inner_hash = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(opad);
    outer.update(inner_hash);
    outer.finalize().into()
}

#[cfg(test)]
#[path = "task_test.rs"]
mod task_test;
