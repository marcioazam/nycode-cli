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
        let message = payload(
            &self.workspace,
            &Record {
                mac: None,
                ..record.clone()
            },
        )?;
        Ok(verify_bytes(secret, &message, mac))
    }
}

fn load_or_create_key(dir: &std::path::Path) -> crate::error::Result<Vec<u8>> {
    let path = dir.join(".mac-key");
    match std::fs::read(&path) {
        Ok(key) => validate_key(&path, key),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => create_key(dir, getrandom::fill),
        Err(err) => Err(crate::error::Error::Workspace(format!(
            "ler chave mac em {}: {err}",
            path.display()
        ))),
    }
}

fn validate_key(path: &std::path::Path, key: Vec<u8>) -> crate::error::Result<Vec<u8>> {
    if key.len() != 32 {
        return Err(crate::error::Error::Workspace(format!(
            "chave mac invalida em {}",
            path.display()
        )));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;

        let mode = std::fs::metadata(path)
            .map_err(|err| {
                crate::error::Error::Workspace(format!(
                    "inspecionar chave mac em {}: {err}",
                    path.display()
                ))
            })?
            .permissions()
            .mode();
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
    fill: impl FnOnce(&mut [u8]) -> std::result::Result<(), getrandom::Error>,
) -> crate::error::Result<Vec<u8>> {
    let path = dir.join(".mac-key");
    let mut key = [0u8; 32];
    fill(&mut key).map_err(|err| {
        crate::error::Error::Workspace(format!("gerar chave mac em {}: {err}", path.display()))
    })?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;

        options.mode(0o600);
    }
    let mut file = options.open(&path).map_err(|err| {
        crate::error::Error::Workspace(format!("criar chave mac em {}: {err}", path.display()))
    })?;
    use std::io::Write as _;
    file.write_all(&key)
        .and_then(|()| file.sync_all())
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

    #[test]
    fn a_signed_future_session_record_is_not_loaded_into_model_context() {
        let (_dir, store) = store();
        let mut record = Record {
            v: 2,
            ts: now_millis().saturating_add(TTL_MS),
            id: Some("future".to_owned()),
            parent_id: None,
            message: Message::user("injetado"),
            mac: None,
        };
        record.mac = Some(store.mac.sign(&record).unwrap());
        std::fs::write(
            store.path_for("future"),
            serde_json::to_string(&record).unwrap(),
        )
        .unwrap();

        assert!(
            store.load("future").unwrap().is_empty(),
            "linha futura entrou no contexto"
        );
    }

    #[test]
    fn a_session_is_not_written_when_its_mac_key_cannot_be_created() {
        let (dir, store) = store();
        std::fs::create_dir(dir.path().join("sessoes").join(".mac-key")).unwrap();

        assert!(store.append("s1", &Message::user("segredo")).is_err());
    }

    #[test]
    fn a_session_load_fails_when_its_mac_key_cannot_be_read() {
        let (dir, store) = store();
        store.append("s1", &Message::user("segredo")).unwrap();
        let key = dir.path().join("sessoes").join(".mac-key");
        std::fs::remove_file(&key).unwrap();
        std::fs::create_dir(&key).unwrap();

        assert!(store.load("s1").is_err());
    }

    #[test]
    fn an_invalid_mac_key_or_signature_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".mac-key"), [0u8; 31]).unwrap();
        assert!(load_or_create_key(dir.path()).is_err());

        let (_dir, store) = store();
        store.append("s1", &Message::user("segredo")).unwrap();
        let mut record: Record = serde_json::from_str(
            std::fs::read_to_string(store.path_for("s1"))
                .unwrap()
                .trim(),
        )
        .unwrap();
        record.mac = Some("not-hex".to_owned());
        std::fs::write(
            store.path_for("s2"),
            serde_json::to_string(&record).unwrap(),
        )
        .unwrap();

        assert!(store.load("s2").unwrap().is_empty());
        assert!(!verify_bytes(
            &[0u8; 32],
            b"payload",
            &hex::encode([0u8; 32])
        ));
    }

    #[test]
    fn a_mac_key_is_not_created_without_os_entropy() {
        let dir = tempfile::tempdir().unwrap();

        assert!(create_key(dir.path(), |_| Err(getrandom::Error::UNSUPPORTED)).is_err());
        assert!(!dir.path().join(".mac-key").exists());
    }

    #[test]
    fn a_mac_key_is_persisted_after_entropy_is_available() {
        let dir = tempfile::tempdir().unwrap();

        let key = create_key(dir.path(), |bytes| {
            bytes.fill(7);
            Ok(())
        })
        .unwrap();

        assert_eq!(key, vec![7; 32]);
        assert_eq!(std::fs::read(dir.path().join(".mac-key")).unwrap(), key);
    }

    #[cfg(unix)]
    #[test]
    fn a_mac_key_readable_by_other_users_is_refused() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".mac-key");
        std::fs::write(&path, [0u8; 32]).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();

        assert!(load_or_create_key(dir.path()).is_err());
    }
}
