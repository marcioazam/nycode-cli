//! Persistência de sessão em JSONL append-only.
//!
//! Append-only por decisão: reescrever o arquivo a cada turno abre uma janela em
//! que um crash deixa a sessão truncada ou vazia. Acrescentar uma linha por vez
//! significa que o pior caso é perder o último turno, não a conversa inteira.

use std::io::Write as _;
use std::path::{Path, PathBuf};

use nycode_ai::anthropic::Message;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

use guard::{SessionLock, create_directory_without_symlinks, open_session_for_append, validate_id};

mod guard;
mod mac;
mod tree;

/// Versão do formato de registro.
///
/// Gravada em toda linha para que um leitor futuro reconheça um arquivo antigo
/// em vez de interpretá-lo errado. A v2 acrescentou `id` e `parent_id`, que é o
/// que torna a sessão uma árvore
/// ([ADR-0006](../../../../docs/architecture/decisions/0006-a-sessao-e-uma-arvore-no-mesmo-arquivo.md)).
const FORMAT_VERSION: u32 = 2;

/// Uma linha do arquivo de sessão.
///
/// `id` e `parent_id` continuam opcionais no parser para reconhecer o formato
/// v1, mas a admissão criptográfica recusa linha sem MAC com erro explícito.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Record {
    pub v: u32,
    /// Milissegundos desde a época.
    pub ts: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Registro do qual este descende. `None` é raiz.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub message: Message,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mac: Option<String>,
}

/// Uma sessão no disco.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionInfo {
    pub id: String,
    pub path: PathBuf,
    pub modified: std::time::SystemTime,
}

/// Diretório de sessões de um workspace.
#[derive(Debug, Clone)]
pub struct Store {
    dir: PathBuf,
    /// Último registro gravado, por sessão.
    ///
    /// Sem isto, descobrir o pai custa reler e reparsear o arquivo inteiro a
    /// cada mensagem, e uma sessão de N mensagens custa O(N²) em leitura e em
    /// parse. Compartilhado entre clones de propósito: dois `Store` do mesmo
    /// diretório precisam concordar sobre onde está a ponta.
    tips: std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, Tip>>>,
    /// Quantas vezes o arquivo foi lido por inteiro.
    ///
    /// Existe só no teste, porque é a única forma de assertar sobre o custo em
    /// vez de sobre o resultado: o conteúdo devolvido é o mesmo antes e depois
    /// de o cursor existir.
    #[cfg(test)]
    reads: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    mac: std::sync::Arc<mac::Context>,
}

#[derive(Debug, Clone)]
struct Tip {
    id: String,
    file_len: u64,
}

impl Store {
    /// Abre o diretório de sessões, criando-o se necessário.
    pub fn open(dir: impl Into<PathBuf>) -> Result<Self> {
        let dir = dir.into();
        create_directory_without_symlinks(&dir)?;
        let mac = std::sync::Arc::new(mac::Context::open(&dir));
        Ok(Self {
            dir,
            tips: std::sync::Arc::default(),
            #[cfg(test)]
            reads: std::sync::Arc::default(),
            mac,
        })
    }

    /// A ponta conhecida sem tocar o disco.
    fn remembered_tip(&self, id: &str) -> Option<String> {
        let path = self.path_for(id).ok()?;
        let file_len = std::fs::metadata(path).ok()?.len();
        let tip = self.tips.lock().ok()?.get(id)?.clone();
        (tip.file_len == file_len).then_some(tip.id)
    }

    /// Anota a ponta nova.
    ///
    /// Um cadeado envenenado não é motivo para falhar a gravação: o efeito de
    /// perder a anotação é reler o arquivo, que é o comportamento antigo.
    fn remember_tip(&self, id: &str, record_id: &str) {
        let Ok(path) = self.path_for(id) else {
            return;
        };
        let Ok(file_len) = std::fs::metadata(path).map(|metadata| metadata.len()) else {
            return;
        };
        if let Ok(mut tips) = self.tips.lock() {
            tips.insert(
                id.to_owned(),
                Tip {
                    id: record_id.to_owned(),
                    file_len,
                },
            );
        }
    }

    #[cfg(test)]
    fn reads(&self) -> usize {
        self.reads.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn path_for(&self, id: &str) -> Result<PathBuf> {
        validate_id(id)?;
        Ok(self.dir.join(format!("{id}.jsonl")))
    }

    /// Acrescenta uma mensagem ao fim do caminho ativo.
    pub fn append(&self, id: &str, message: &Message) -> Result<()> {
        let path = self.path_for(id)?;
        let _lock = SessionLock::acquire(&path)?;
        let parent = self.tip(id)?;
        self.append_child_locked(id, parent.as_deref(), message)?;
        Ok(())
    }

    /// Acrescenta uma mensagem como filha de um registro escolhido.
    ///
    /// Apontar para um nó que já tem filho é o que cria um ramo. Nada é
    /// reescrito: o arquivo continua append-only, e a ramificação existe porque
    /// dois registros passam a compartilhar o mesmo pai.
    pub fn append_child(
        &self,
        id: &str,
        parent_id: Option<&str>,
        message: &Message,
    ) -> Result<String> {
        let path = self.path_for(id)?;
        let _lock = SessionLock::acquire(&path)?;
        self.append_child_locked(id, parent_id, message)
    }

    fn append_child_locked(
        &self,
        id: &str,
        parent_id: Option<&str>,
        message: &Message,
    ) -> Result<String> {
        let record_id = new_id();
        let mut record = Record {
            v: FORMAT_VERSION,
            ts: now_millis(),
            id: Some(record_id.clone()),
            parent_id: parent_id.map(ToOwned::to_owned),
            message: message.clone(),
            mac: None,
        };
        record.mac = Some(self.mac.sign(&record)?);
        let line = serde_json::to_string(&record)
            .map_err(|err| Error::Workspace(format!("serializar registro: {err}")))?;

        let mut file = open_session_for_append(&self.path_for(id)?)
            .map_err(|err| Error::Workspace(format!("abrir sessao {id}: {err}")))?;

        writeln!(file, "{line}")
            .map_err(|err| Error::Workspace(format!("gravar sessao {id}: {err}")))?;

        file.sync_all()
            .map_err(|err| Error::Workspace(format!("sincronizar sessao {id}: {err}")))?;

        // A ponta é o último registro gravado, inclusive quando este append
        // ramificou a partir do meio da árvore.
        self.remember_tip(id, &record_id);
        Ok(record_id)
    }

    /// O último registro do caminho ativo, se houver.
    ///
    /// Consulta o cursor antes do disco. Quem grava é este mesmo `Store`, então
    /// depois da primeira gravação ele já sabe onde está a ponta e não precisa
    /// reler o arquivo para redescobri-la.
    pub fn tip(&self, id: &str) -> Result<Option<String>> {
        if let Some(known) = self.remembered_tip(id) {
            return Ok(Some(known));
        }

        let path = self.path_for(id)?;
        match std::fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(Error::Workspace(format!(
                    "sessao `{id}` nao e um arquivo regular"
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(Error::Workspace(format!("verificar sessao {id}: {error}")));
            }
        }

        let Some(tip) = self
            .records(id)?
            .last()
            .and_then(|record| record.id.clone())
        else {
            return Ok(None);
        };
        self.remember_tip(id, &tip);
        Ok(Some(tip))
    }

    /// Todos os registros legíveis do arquivo, na ordem em que foram gravados.
    pub fn records(&self, id: &str) -> Result<Vec<Record>> {
        #[cfg(test)]
        self.reads
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        let path = self.path_for(id)?;
        let Ok(contents) = std::fs::read_to_string(&path) else {
            return Err(Error::Workspace(format!("sessao `{id}` nao encontrada")));
        };

        let mut records = Vec::new();
        for (number, line) in contents.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Record>(line) {
                // O parser reconhece v1 sem `id`; a admissão abaixo ainda exige
                // MAC antes de qualquer registro chegar ao contexto do modelo.
                Ok(record) if record.v <= FORMAT_VERSION => records.push(record),
                Ok(record) => {
                    tracing::warn!(
                        line = number + 1,
                        version = record.v,
                        "registro de versao futura, ignorado"
                    );
                }
                Err(err) => {
                    tracing::warn!(line = number + 1, %err, "linha de sessao corrompida, ignorada");
                }
            }
        }
        self.mac.admit(records)
    }

    /// O caminho da raiz até um registro, seguindo os pais.
    ///
    /// É o que uma ramificação precisa: retomar um nó do meio significa mandar
    /// ao modelo só o que levou até ele, e não os ramos irmãos.
    pub fn path_to(&self, id: &str, record_id: &str) -> Result<Vec<Message>> {
        Ok(tree::chain_to(&self.records(id)?, record_id))
    }

    /// Lê as mensagens de uma sessão. Linha corrompida custa um turno, não a conversa.
    pub fn load(&self, id: &str) -> Result<Vec<Message>> {
        let records = self.records(id)?;

        // O caminho ativo é o que leva ao último registro gravado. Devolver o
        // arquivo inteiro mandaria ramos abandonados ao modelo como se fossem
        // parte da conversa.
        // Anotar a ponta aqui é o que faz o primeiro append depois do resume
        // não reler o arquivo.
        if let Some(tip) = records.last().and_then(|r| r.id.as_deref()) {
            self.remember_tip(id, tip);
        }
        Ok(tree::conversation(&records))
    }

    /// Sessões existentes, da mais recente para a mais antiga.
    pub fn list(&self) -> Result<Vec<SessionInfo>> {
        let entries = std::fs::read_dir(&self.dir)
            .map_err(|err| Error::Workspace(format!("listar sessoes: {err}")))?;

        let mut sessions: Vec<SessionInfo> = entries
            .filter_map(std::result::Result::ok)
            .filter_map(|entry| {
                let path = entry.path();
                if path.extension()? != "jsonl" {
                    return None;
                }
                Some(SessionInfo {
                    id: path.file_stem()?.to_string_lossy().into_owned(),
                    modified: entry.metadata().ok()?.modified().ok()?,
                    path,
                })
            })
            .collect();

        sessions.sort_by(|a, b| b.modified.cmp(&a.modified).then(b.id.cmp(&a.id)));
        Ok(sessions)
    }

    /// A sessão mais recente, se houver.
    pub fn latest(&self) -> Result<Option<SessionInfo>> {
        Ok(self.list()?.into_iter().next())
    }

    /// Gera um identificador novo, ordenável por tempo.
    #[must_use]
    pub fn new_id() -> String {
        format!("{:013}", now_millis())
    }

    #[must_use]
    pub fn dir(&self) -> &Path {
        &self.dir
    }
}

/// Identificador de registro, único dentro de um arquivo.
///
/// O relógio sozinho colide quando dois registros caem no mesmo milissegundo,
/// o que acontece num turno com ferramenta. O contador desempata sem exigir uma
/// dependência de UUID para algo que nunca sai deste arquivo.
fn new_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{:x}-{seq:x}", now_millis())
}

pub(super) fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

#[cfg(test)]
mod tree_tests;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod inline_tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().join("sessoes")).unwrap();
        (dir, store)
    }

    #[test]
    fn a_record_from_an_unknown_format_version_is_skipped() {
        let (_dir, store) = store();
        std::fs::write(
            store.path_for("s1").unwrap(),
            r#"{"v":999,"ts":0,"message":{"role":"user","content":[{"type":"text","text":"futuro"}]}}"#,
        )
        .unwrap();
        assert!(
            store.load("s1").unwrap().is_empty(),
            "versao desconhecida foi interpretada"
        );
    }

    #[test]
    fn every_line_carries_the_format_version() {
        let (_dir, store) = store();
        store.append("s1", &Message::user("x")).unwrap();

        let line = std::fs::read_to_string(store.path_for("s1").unwrap()).unwrap();
        let record: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(record["v"], FORMAT_VERSION);
        assert!(record["ts"].as_u64().unwrap() > 0);
    }

    #[test]
    fn loading_an_unknown_session_is_an_error_not_an_empty_conversation() {
        // Devolver vazio faria o usuario achar que retomou uma sessao e comecar
        // do zero sem perceber.
        let (_dir, store) = store();
        assert!(store.load("nao-existe").is_err());
    }

    #[test]
    fn listing_orders_the_most_recent_first() {
        let (_dir, store) = store();
        store.append("antiga", &Message::user("a")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        store.append("recente", &Message::user("b")).unwrap();

        let ids: Vec<_> = store.list().unwrap().into_iter().map(|s| s.id).collect();
        assert_eq!(ids.first().map(String::as_str), Some("recente"));
        assert_eq!(store.latest().unwrap().unwrap().id, "recente");
    }

    #[test]
    fn listing_breaks_a_mtime_tie_with_the_newer_id() {
        // `--continue` escolhe `latest()`. No runner do CI os dois appends
        // caem no mesmo segundo e a ordem de `readdir` vence — a sessão
        // antiga volta como se fosse a recente.
        let (_dir, store) = store();
        store
            .append("0000000002", &Message::user("recente"))
            .unwrap();
        store
            .append("0000000001", &Message::user("antiga"))
            .unwrap();
        let tied =
            std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
        for id in ["0000000001", "0000000002"] {
            std::fs::File::open(store.dir().join(format!("{id}.jsonl")))
                .unwrap()
                .set_modified(tied)
                .unwrap();
        }
        assert_eq!(store.latest().unwrap().unwrap().id, "0000000002");
    }

    #[test]
    fn an_empty_store_has_no_latest_session() {
        let (_dir, store) = store();
        assert!(store.latest().unwrap().is_none());
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn non_session_files_are_ignored_when_listing() {
        let (_dir, store) = store();
        std::fs::write(store.dir().join("anotacoes.txt"), "nada a ver").unwrap();
        store.append("s1", &Message::user("x")).unwrap();

        let ids: Vec<_> = store.list().unwrap().into_iter().map(|s| s.id).collect();
        assert_eq!(ids, vec!["s1"]);
    }

    #[test]
    fn generated_ids_sort_chronologically() {
        let first = Store::new_id();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let second = Store::new_id();
        assert!(
            second > first,
            "ids precisam ordenar por tempo: {first} vs {second}"
        );
    }
}
