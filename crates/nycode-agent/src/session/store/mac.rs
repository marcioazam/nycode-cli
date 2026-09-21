use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

use super::{Record, now_millis};

const TTL_MS: u64 = 2_592_000_000;

#[derive(Debug)]
pub(super) struct Context {
    dir: std::path::PathBuf,
    workspace: String,
}

impl Context {
    pub(super) fn open(dir: &std::path::Path) -> crate::error::Result<Self> {
        let workspace = dir
            .parent()
            .and_then(std::path::Path::parent)
            .unwrap_or(dir)
            .canonicalize()
            .map_err(|err| {
                crate::error::Error::Workspace(format!(
                    "canonicalizar workspace para mac em {}: {err}",
                    dir.display()
                ))
            })?
            .display()
            .to_string();
        Ok(Self {
            dir: dir.to_path_buf(),
            workspace,
        })
    }

    fn secret(&self) -> crate::error::Result<Vec<u8>> {
        load_or_create_key(&self.dir)
    }

    pub(super) fn sign(&self, session_id: &str, record: &Record) -> crate::error::Result<String> {
        sign_bytes(
            &self.secret()?,
            &payload(&self.workspace, session_id, record)?,
        )
    }

    pub(super) fn admit(
        &self,
        session_id: &str,
        records: Vec<Record>,
    ) -> crate::error::Result<Vec<Record>> {
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
            if self.acceptable(session_id, &record, now, &secret)? {
                admitted.push(record);
            }
        }
        Ok(admitted)
    }

    fn acceptable(
        &self,
        session_id: &str,
        record: &Record,
        now: u64,
        secret: &[u8],
    ) -> crate::error::Result<bool> {
        let Some(mac) = record.mac.as_deref() else {
            return Ok(false);
        };
        if record.ts > now || now.saturating_sub(record.ts) > TTL_MS {
            return Ok(false);
        }
        let mut unsigned = record.clone();
        unsigned.mac = None;
        let message = payload(&self.workspace, session_id, &unsigned)?;
        Ok(verify_bytes(secret, &message, mac))
    }
}

fn load_or_create_key(dir: &std::path::Path) -> crate::error::Result<Vec<u8>> {
    let path = dir.join(".mac-key");
    match read_key(&path) {
        Ok((key, metadata)) => validate_key(&path, key, &metadata),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            match create_key(dir, getrandom::fill) {
                Ok(key) => Ok(key),
                Err(create_err) => match read_key(&path) {
                    // Outro processo pode ter criado a chave entre as duas leituras.
                    Ok((key, metadata)) => validate_key(&path, key, &metadata),
                    Err(_) => Err(create_err),
                },
            }
        }
        Err(err) => Err(crate::error::Error::Workspace(format!(
            "ler chave mac em {}: {err}",
            path.display()
        ))),
    }
}

fn read_key(path: &std::path::Path) -> std::io::Result<(Vec<u8>, std::fs::Metadata)> {
    use std::io::Read as _;

    #[cfg(unix)]
    let mut key_file = {
        use rustix::fs::{Mode, OFlags};

        let dir = super::guard::open_directory(path.parent().ok_or_else(|| {
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
        if metadata.permissions().mode() & 0o077 != 0 {
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

fn payload(workspace: &str, session_id: &str, record: &Record) -> crate::error::Result<Vec<u8>> {
    let mut message = Vec::new();
    message.extend_from_slice(workspace.as_bytes());
    message.push(0);
    message.extend_from_slice(session_id.as_bytes());
    message.push(0);
    message.extend_from_slice(&record.v.to_le_bytes());
    message.extend_from_slice(&record.ts.to_le_bytes());
    message.extend_from_slice(record.id.as_deref().unwrap_or("").as_bytes());
    message.push(0);
    message.extend_from_slice(record.parent_id.as_deref().unwrap_or("").as_bytes());
    message.push(0);
    message.extend(
        serde_json::to_vec(&record.message).map_err(|err| {
            crate::error::Error::Workspace(format!("serializar payload mac: {err}"))
        })?,
    );
    Ok(message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nycode_ai::anthropic::Message;

    fn record() -> Record {
        Record {
            v: 2,
            ts: now_millis(),
            id: Some("r1".to_owned()),
            parent_id: None,
            message: Message::user("mensagem"),
            mac: None,
        }
    }

    #[test]
    fn a_context_without_a_canonical_workspace_is_rejected() {
        assert!(Context::open(std::path::Path::new("sessions")).is_err());
    }

    #[test]
    fn a_record_without_a_mac_is_not_acceptable_when_checked_directly() {
        let dir = tempfile::tempdir().unwrap();
        let context = Context::open(&dir.path().join("sessions")).unwrap();

        assert!(
            !context
                .acceptable("s1", &record(), now_millis(), &[0u8; 32])
                .unwrap()
        );
    }

    #[test]
    fn a_context_persists_a_32_byte_secret() {
        let dir = tempfile::tempdir().unwrap();
        let sessions = dir.path().join("sessions");
        std::fs::create_dir_all(&sessions).unwrap();
        let first = Context::open(&sessions).unwrap().secret().unwrap();
        let second = Context::open(&sessions).unwrap().secret().unwrap();

        assert_eq!(first.len(), 32);
        assert_eq!(second, first);
    }

    #[test]
    fn a_record_from_the_future_is_not_acceptable() {
        let dir = tempfile::tempdir().unwrap();
        let sessions = dir.path().join("sessions");
        std::fs::create_dir_all(&sessions).unwrap();
        let context = Context::open(&sessions).unwrap();
        let mut record = record();
        record.ts = now_millis().saturating_add(1_000);
        record.mac = Some(context.sign("s1", &record).unwrap());

        assert!(
            !context
                .acceptable("s1", &record, now_millis(), &context.secret().unwrap())
                .unwrap()
        );
    }

    #[test]
    fn the_ttl_boundary_is_accepted_but_an_older_record_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let sessions = dir.path().join("sessions");
        std::fs::create_dir_all(&sessions).unwrap();
        let context = Context::open(&sessions).unwrap();
        let now = now_millis();

        for (age, accepted) in [(TTL_MS, true), (TTL_MS + 1, false)] {
            let mut record = record();
            record.ts = now.saturating_sub(age);
            record.mac = Some(context.sign("s1", &record).unwrap());
            assert_eq!(
                context
                    .acceptable("s1", &record, now, &context.secret().unwrap())
                    .unwrap(),
                accepted
            );
        }
    }

    #[test]
    fn a_key_with_the_wrong_length_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path()).unwrap();
        std::fs::write(dir.path().join(".mac-key"), [0u8; 31]).unwrap();

        assert!(load_or_create_key(dir.path()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_key_with_insecure_permissions_is_rejected() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".mac-key");
        std::fs::write(&path, [0u8; 32]).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();

        assert!(load_or_create_key(dir.path()).is_err());
    }

    #[test]
    fn a_key_path_that_is_a_directory_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".mac-key")).unwrap();

        assert!(load_or_create_key(dir.path()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_non_missing_key_error_is_not_treated_as_an_absent_key() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("real-key");
        std::fs::write(&target, [0u8; 32]).unwrap();
        symlink(target, dir.path().join(".mac-key")).unwrap();

        let error = load_or_create_key(dir.path()).unwrap_err().to_string();
        assert!(error.contains("ler chave mac"), "{error}");
    }

    #[test]
    fn creating_a_key_over_an_existing_path_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".mac-key"), [0u8; 32]).unwrap();

        assert!(create_key(dir.path(), |_| Ok(())).is_err());
    }

    #[test]
    fn malformed_key_paths_are_reported_as_io_errors() {
        assert!(read_key(std::path::Path::new("")).is_err());
        assert!(read_key(std::path::Path::new("/")).is_err());
    }

    #[test]
    fn malformed_hex_is_not_a_valid_mac() {
        assert!(!verify_bytes(&[0u8; 32], b"payload", "not-hex"));
    }
}
