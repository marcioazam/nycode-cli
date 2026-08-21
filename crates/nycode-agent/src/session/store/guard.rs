use std::path::Path;

use crate::error::{Error, Result};

pub(super) struct SessionLock {
    _file: std::fs::File,
}

impl SessionLock {
    pub(super) fn acquire(path: &Path) -> Result<Self> {
        let lock_path = path.with_extension("lock");
        let file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&lock_path)
            .map_err(|err| Error::Workspace(format!("abrir lock de sessao: {err}")))?;
        #[cfg(unix)]
        rustix::fs::flock(&file, rustix::fs::FlockOperation::LockExclusive)
            .map_err(|err| Error::Workspace(format!("bloquear sessao: {err}")))?;
        Ok(Self { _file: file })
    }
}

pub(super) fn open_session_for_append(path: &Path) -> Result<std::fs::File> {
    #[cfg(unix)]
    {
        use rustix::fs::{Mode, OFlags};

        let dir = std::fs::File::open(
            path.parent()
                .ok_or_else(|| Error::Workspace("sessao sem diretorio pai".to_owned()))?,
        )
        .map_err(|err| Error::Workspace(format!("abrir diretorio de sessao: {err}")))?;
        let name = path
            .file_name()
            .ok_or_else(|| Error::Workspace("sessao sem nome de arquivo".to_owned()))?;
        let descriptor = rustix::fs::openat(
            &dir,
            name,
            OFlags::WRONLY
                .union(OFlags::CREATE)
                .union(OFlags::APPEND)
                .union(OFlags::NOFOLLOW)
                .union(OFlags::CLOEXEC),
            Mode::from_raw_mode(0o600),
        )
        .map_err(|err| Error::Workspace(format!("abrir sessao sem symlink: {err}")))?;
        Ok(std::fs::File::from(descriptor))
    }

    #[cfg(not(unix))]
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|err| Error::Workspace(format!("abrir sessao: {err}")))
}

pub(super) fn validate_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(Error::Workspace(format!(
            "identificador de sessao `{id}` recusado"
        )));
    }
    Ok(())
}
