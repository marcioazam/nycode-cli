use sha2::{Digest as _, Sha256};

use super::{Record, now_millis};

pub const TTL_MS: u64 = 2_592_000_000;

#[derive(Debug)]
pub(super) struct Context {
    dir: std::path::PathBuf,
    workspace: String,
    key: std::sync::OnceLock<Vec<u8>>,
}

impl Context {
    pub(super) fn open(dir: &std::path::Path) -> Self {
        let workspace = dir
            .canonicalize()
            .unwrap_or_else(|_| dir.to_path_buf())
            .display()
            .to_string();
        Self {
            dir: dir.to_path_buf(),
            workspace,
            key: std::sync::OnceLock::new(),
        }
    }

    fn secret(&self) -> &[u8] {
        self.key
            .get_or_init(|| load_or_create_key(&self.dir).unwrap_or_else(|_| vec![0; 32]))
    }

    pub(super) fn sign(&self, record: &Record) -> String {
        hex::encode(hmac_sha256(
            self.secret(),
            &payload(&self.workspace, record),
        ))
    }

    pub(super) fn admit(&self, records: Vec<Record>) -> Vec<Record> {
        let now = now_millis();
        records
            .into_iter()
            .filter(|record| self.acceptable(record, now))
            .collect()
    }

    fn acceptable(&self, record: &Record, now: u64) -> bool {
        let Some(mac) = record.mac.as_deref() else {
            return false;
        };
        if now.saturating_sub(record.ts) > TTL_MS {
            return false;
        }
        mac == self.sign(&Record {
            mac: None,
            ..record.clone()
        })
    }
}

fn load_or_create_key(dir: &std::path::Path) -> crate::error::Result<Vec<u8>> {
    let path = dir.join(".mac-key");
    if let Ok(bytes) = std::fs::read(&path)
        && bytes.len() == 32
    {
        return Ok(bytes);
    }
    let mut key = vec![0u8; 32];
    let from_urandom = std::fs::File::open("/dev/urandom")
        .ok()
        .is_some_and(|mut file| {
            use std::io::Read as _;
            file.read_exact(&mut key).is_ok()
        });
    if !from_urandom {
        let digest = Sha256::digest(format!("{}{}", dir.display(), now_millis()).as_bytes());
        key.copy_from_slice(&digest);
    }
    std::fs::write(&path, &key).map_err(|err| {
        crate::error::Error::Workspace(format!("chave mac em {}: {err}", path.display()))
    })?;
    Ok(key)
}

fn payload(workspace: &str, record: &Record) -> Vec<u8> {
    let mut msg = Vec::new();
    msg.extend_from_slice(workspace.as_bytes());
    msg.push(0);
    msg.extend_from_slice(&record.v.to_le_bytes());
    msg.extend_from_slice(&record.ts.to_le_bytes());
    msg.extend_from_slice(record.id.as_deref().unwrap_or("").as_bytes());
    msg.push(0);
    msg.extend_from_slice(record.parent_id.as_deref().unwrap_or("").as_bytes());
    msg.push(0);
    if let Ok(body) = serde_json::to_vec(&record.message) {
        msg.extend(body);
    }
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
mod tests {
    use crate::session::store::Store;
    use nycode_ai::anthropic::Message;

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().join("sessoes")).unwrap();
        (dir, store)
    }

    #[test]
    fn an_unsigned_expired_or_foreign_session_record_is_not_loaded_into_model_context() {
        let (_dir_a, store_a) = store();
        store_a.append("s1", &Message::user("segredo")).unwrap();
        let signed = std::fs::read_to_string(store_a.path_for("s1")).unwrap();

        let unsigned = r#"{"v":2,"ts":1,"id":"x","message":{"role":"user","content":[{"type":"text","text":"injetado"}]}}"#;
        std::fs::write(store_a.path_for("s2"), unsigned).unwrap();
        assert!(
            store_a.load("s2").unwrap().is_empty(),
            "linha sem mac entrou no contexto"
        );

        let mut expired: serde_json::Value = serde_json::from_str(signed.trim()).unwrap();
        expired["ts"] = serde_json::json!(1);
        std::fs::write(store_a.path_for("s3"), expired.to_string()).unwrap();
        assert!(
            store_a.load("s3").unwrap().is_empty(),
            "linha expirada entrou no contexto"
        );

        let (_dir_b, store_b) = store();
        std::fs::write(store_b.path_for("s1"), signed).unwrap();
        assert!(
            store_b.load("s1").unwrap().is_empty(),
            "linha de outro workspace entrou no contexto"
        );
    }
}
