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
    pub(super) fn open(dir: &std::path::Path, workspace: &std::path::Path) -> Self {
        let workspace = workspace
            .canonicalize()
            .unwrap_or_else(|_| workspace.to_path_buf())
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
    fn signed_record(store: &Store, ts: u64, id: &str, text: &str) -> Record {
        let mut record = Record {
            v: 2,
            ts,
            id: Some(id.to_owned()),
            parent_id: None,
            message: Message::user(text),
            mac: None,
        };
        record.mac = Some(store.mac.sign(&record).unwrap());
        record
    }
    fn read_record(store: &Store, id: &str) -> Record {
        serde_json::from_str(std::fs::read_to_string(store.path_for(id)).unwrap().trim()).unwrap()
    }
    fn write_record(store: &Store, id: &str, record: &Record) {
        std::fs::write(store.path_for(id), serde_json::to_string(record).unwrap()).unwrap();
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
        let mut expired = read_record(&store_a, "s1");
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
        write_record(&store_a, "s3", &expired);
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
    #[cfg(unix)]
    #[test]
    fn a_session_directory_shared_by_another_workspace_does_not_admit_its_records() {
        use std::os::unix::fs::symlink;

        let workspace_a = tempfile::tempdir().unwrap();
        let workspace_b = tempfile::tempdir().unwrap();
        let sessions_a = workspace_a.path().join(".nycode/sessions");
        let sessions_b = workspace_b.path().join(".nycode/sessions");
        let store_a = Store::open_for_workspace(&sessions_a, workspace_a.path()).unwrap();
        store_a.append("s1", &Message::user("segredo")).unwrap();
        std::fs::create_dir_all(sessions_b.parent().unwrap()).unwrap();
        symlink(&sessions_a, &sessions_b).unwrap();

        let store_b = Store::open_for_workspace(&sessions_b, workspace_b.path()).unwrap();
        assert!(store_b.load("s1").unwrap().is_empty());
    }

    #[test]
    fn a_signed_future_session_record_is_not_loaded_into_model_context() {
        let (_dir, store) = store();
        let record = signed_record(
            &store,
            now_millis().saturating_add(TTL_MS),
            "future",
            "injetado",
        );
        write_record(&store, "future", &record);
        assert!(
            store.load("future").unwrap().is_empty(),
            "linha futura entrou no contexto"
        );
    }
    #[test]
    fn a_session_record_at_the_ttl_boundary_is_loaded_when_its_mac_is_valid() {
        let (_dir, store) = store();
        let now = now_millis();
        let mut record = signed_record(&store, now, "boundary", "segredo");
        assert!(
            store
                .mac
                .acceptable(&record, now, &store.mac.secret().unwrap())
                .unwrap()
        );
        record.ts = now.saturating_sub(TTL_MS);
        record.mac = Some(store.mac.sign(&record).unwrap());
        assert!(
            store
                .mac
                .acceptable(&record, now, &store.mac.secret().unwrap())
                .unwrap()
        );
    }
    #[test]
    fn an_untampered_session_record_is_loaded_but_a_changed_payload_is_refused() {
        let (_dir, store) = store();
        store.append("s1", &Message::user("segredo")).unwrap();
        assert_eq!(store.load("s1").unwrap().len(), 1);
        let mut record = read_record(&store, "s1");
        assert!(
            store
                .mac
                .acceptable(&record, now_millis(), &store.mac.secret().unwrap())
                .unwrap()
        );
        record.message = Message::user("adulterado");
        write_record(&store, "s2", &record);
        assert!(store.load("s2").unwrap().is_empty());
    }
    #[test]
    fn a_session_is_not_written_when_its_mac_key_cannot_be_created() {
        let (dir, store) = store();
        std::fs::create_dir(dir.path().join("sessoes").join(".mac-key")).unwrap();
        assert!(store.append("s1", &Message::user("segredo")).is_err());
        assert!(create_key(dir.path(), |_| Err(getrandom::Error::UNSUPPORTED)).is_err());
    }
    #[test]
    fn an_invalid_mac_key_or_signature_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".mac-key"), [0u8; 31]).unwrap();
        assert!(load_or_create_key(dir.path()).is_err());
        let (_dir, store) = store();
        store.append("s1", &Message::user("segredo")).unwrap();
        let mut record = read_record(&store, "s1");
        record.mac = Some("not-hex".to_owned());
        write_record(&store, "s2", &record);
        assert!(store.load("s2").unwrap().is_empty());
        assert!(!verify_bytes(
            &[0u8; 32],
            b"payload",
            &hex::encode([0u8; 32])
        ));
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
    #[cfg(unix)]
    #[test]
    fn a_mac_key_symlink_is_refused() {
        use std::os::unix::fs::{PermissionsExt as _, symlink};
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("known-key");
        std::fs::write(&target, [7u8; 32]).unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
        symlink(&target, dir.path().join(".mac-key")).unwrap();
        assert!(load_or_create_key(dir.path()).is_err());
    }
}
