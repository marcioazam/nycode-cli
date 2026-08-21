use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

use super::{Record, now_millis};

pub const TTL_MS: u64 = 2_592_000_000;

#[derive(Debug)]
pub(super) struct Context {
    dir: std::path::PathBuf,
    workspace: String,
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
        }
    }

    fn secret(&self) -> crate::error::Result<Vec<u8>> {
        load_or_create_key(&self.dir)
    }

    pub(super) fn sign(&self, record: &Record) -> crate::error::Result<String> {
        sign_bytes(&self.secret()?, &payload(&self.workspace, record)?)
    }

    pub(super) fn admit(&self, records: Vec<Record>) -> crate::error::Result<Vec<Record>> {
        let now = now_millis();
        let secret = self.secret()?;
        let mut admitted = Vec::with_capacity(records.len());
        for record in records {
            if record.mac.is_none() {
                return Err(crate::error::Error::Workspace(format!(
                    "registro de sessao v{} sem mac",
                    record.v
                )));
            }
            if self.acceptable(&record, now, &secret)? {
                admitted.push(record);
            }
        }
        Ok(admitted)
    }

    fn acceptable(&self, record: &Record, now: u64, secret: &[u8]) -> crate::error::Result<bool> {
        let Some(mac) = record.mac.as_deref() else {
            return Ok(false);
        };
        if record.ts > now || now.saturating_sub(record.ts) > TTL_MS {
            return Ok(false);
        }
        let mut unsigned = record.clone();
        unsigned.mac = None;
        let message = payload(&self.workspace, &unsigned)?;
        Ok(verify_bytes(secret, &message, mac))
    }
}

fn load_or_create_key(dir: &std::path::Path) -> crate::error::Result<Vec<u8>> {
    let path = dir.join(".mac-key");
    match read_key(&path) {
        Ok((key, metadata)) => validate_key(&path, key, &metadata),
        Err(err) => match err.kind() {
            std::io::ErrorKind::NotFound => create_key(dir, getrandom::fill),
            _ => Err(crate::error::Error::Workspace(format!(
                "ler chave mac em {}: {err}",
                path.display()
            ))),
        },
    }
}
fn read_key(path: &std::path::Path) -> std::io::Result<(Vec<u8>, std::fs::Metadata)> {
    use std::io::Read as _;
    #[cfg(unix)]
    let mut key_file = {
        use rustix::fs::{Mode, OFlags};
        let dir = std::fs::File::open(path.parent().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "chave mac sem diretorio")
        })?)?;
        let name = path.file_name().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "chave mac sem nome")
        })?;
        let descriptor = rustix::fs::openat(
            &dir,
            name,
            OFlags::RDONLY
                .union(OFlags::NOFOLLOW)
                .union(OFlags::CLOEXEC),
            Mode::empty(),
        )
        .map_err(std::io::Error::from)?;
        std::fs::File::from(descriptor)
    };
    #[cfg(not(unix))]
    let mut key_file = std::fs::File::open(path)?;

    let metadata = key_file.metadata()?;
    if !metadata.file_type().is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "chave mac nao e arquivo regular",
        ));
    }
    let mut key = Vec::new();
    key_file.read_to_end(&mut key)?;
    Ok((key, metadata))
}

fn validate_key(
    path: &std::path::Path,
    key: Vec<u8>,
    metadata: &std::fs::Metadata,
) -> crate::error::Result<Vec<u8>> {
    if key.len() != 32 {
        return Err(crate::error::Error::Workspace(format!(
            "chave mac invalida em {}",
            path.display()
        )));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let mode = metadata.permissions().mode();
        if mode & 0o077 != 0 {
            return Err(crate::error::Error::Workspace(format!(
                "chave mac em {} tem permissoes inseguras",
                path.display()
            )));
        }
    }
    Ok(key)
}
fn create_key(
    dir: &std::path::Path,
    entropy: impl FnOnce(&mut [u8]) -> std::result::Result<(), getrandom::Error>,
) -> crate::error::Result<Vec<u8>> {
    use std::io::Write as _;
    let path = dir.join(".mac-key");
    let mut key = [0u8; 32];
    entropy(&mut key).map_err(|err| {
        crate::error::Error::Workspace(format!("gerar chave mac em {}: {err}", path.display()))
    })?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    let mut key_file = options.open(&path).map_err(|err| {
        crate::error::Error::Workspace(format!("criar chave mac em {}: {err}", path.display()))
    })?;
    key_file
        .write_all(&key)
        .and_then(|()| key_file.sync_all())
        .map_err(|err| {
            crate::error::Error::Workspace(format!("gravar chave mac em {}: {err}", path.display()))
        })?;
    Ok(key.to_vec())
}
fn sign_bytes(key: &[u8], message: &[u8]) -> crate::error::Result<String> {
    let mut signer = Hmac::<Sha256>::new_from_slice(key)
        .map_err(|err| crate::error::Error::Workspace(format!("iniciar mac: {err}")))?;
    signer.update(message);
    Ok(hex::encode(signer.finalize().into_bytes()))
}
fn verify_bytes(key: &[u8], message: &[u8], mac: &str) -> bool {
    let Ok(signature) = hex::decode(mac) else {
        return false;
    };
    let Ok(mut verifier) = Hmac::<Sha256>::new_from_slice(key) else {
        return false;
    };
    verifier.update(message);
    verifier.verify_slice(&signature).is_ok()
}

fn payload(workspace: &str, record: &Record) -> crate::error::Result<Vec<u8>> {
    let mut msg = Vec::new();
    msg.extend_from_slice(workspace.as_bytes());
    msg.push(0);
    msg.extend_from_slice(&record.v.to_le_bytes());
    msg.extend_from_slice(&record.ts.to_le_bytes());
    msg.extend_from_slice(record.id.as_deref().unwrap_or("").as_bytes());
    msg.push(0);
    msg.extend_from_slice(record.parent_id.as_deref().unwrap_or("").as_bytes());
    msg.push(0);
    msg.extend(
        serde_json::to_vec(&record.message).map_err(|err| {
            crate::error::Error::Workspace(format!("serializar payload mac: {err}"))
        })?,
    );
    Ok(msg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::store::Store;
    use nycode_ai::anthropic::Message;

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().join("sessoes")).unwrap();
        (dir, store)
    }

    #[test]
    fn an_unsigned_session_record_is_rejected_before_model_context() {
        let (_dir_a, store_a) = store();
        store_a.append("s1", &Message::user("segredo")).unwrap();
        let signed = std::fs::read_to_string(store_a.path_for("s1")).unwrap();
        let unsigned = r#"{"v":2,"ts":1,"id":"x","message":{"role":"user","content":[{"type":"text","text":"injetado"}]}}"#;
        std::fs::write(store_a.path_for("s2"), unsigned).unwrap();
        assert!(
            store_a.load("s2").is_err(),
            "linha sem mac falhou em silencio"
        );
        let mut expired: Record = serde_json::from_str(signed.trim()).unwrap();
        expired.ts = 1;
        expired.mac = Some(
            store_a
                .mac
                .sign(&Record {
                    mac: None,
                    ..expired.clone()
                })
                .unwrap(),
        );
        std::fs::write(
            store_a.path_for("s3"),
            serde_json::to_string(&expired).unwrap(),
        )
        .unwrap();
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
