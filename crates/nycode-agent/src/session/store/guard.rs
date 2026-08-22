use std::path::Path;

use crate::error::{Error, Result};

pub(super) struct SessionLock {
    _file: std::fs::File,
}

impl SessionLock {
    pub(super) fn acquire(path: &Path) -> Result<Self> {
        let lock_path = path.with_extension("lock");
        let file = open_named(&lock_path, OpenMode::WriteCreate)
            .map_err(|err| Error::Workspace(format!("abrir lock de sessao: {err}")))?;
        #[cfg(unix)]
        rustix::fs::flock(&file, rustix::fs::FlockOperation::LockExclusive)
            .map_err(|err| Error::Workspace(format!("bloquear sessao: {err}")))?;
        Ok(Self { _file: file })
    }
}

pub(super) fn open_session_for_append(path: &Path) -> Result<std::fs::File> {
    open_named(path, OpenMode::WriteCreateAppend)
}

pub(super) fn open_session_for_read(path: &Path) -> Result<std::fs::File> {
    open_named(path, OpenMode::Read)
}

#[derive(Clone, Copy)]
enum OpenMode {
    Read,
    WriteCreate,
    WriteCreateAppend,
}

#[cfg(unix)]
fn open_named(path: &Path, mode: OpenMode) -> Result<std::fs::File> {
    use rustix::fs::{Mode, OFlags};

    let parent = path
        .parent()
        .ok_or_else(|| Error::Workspace("sessao sem diretorio pai".to_owned()))?;
    if !matches!(mode, OpenMode::Read)
        && std::fs::symlink_metadata(parent).is_ok_and(|metadata| metadata.file_type().is_symlink())
    {
        return Err(Error::Workspace(
            "escrita em diretorio de sessoes symlinkado recusada".to_owned(),
        ));
    }
    let dir = std::fs::File::open(parent)
        .map_err(|err| Error::Workspace(format!("abrir diretorio de sessao: {err}")))?;
    let name = path
        .file_name()
        .ok_or_else(|| Error::Workspace("sessao sem nome de arquivo".to_owned()))?;
    let mut flags = OFlags::CLOEXEC.union(OFlags::NOFOLLOW);
    let create = match mode {
        OpenMode::Read => {
            flags = flags.union(OFlags::RDONLY);
            false
        }
        OpenMode::WriteCreate => {
            flags = flags.union(OFlags::RDWR).union(OFlags::CREATE);
            true
        }
        OpenMode::WriteCreateAppend => {
            flags = flags
                .union(OFlags::WRONLY)
                .union(OFlags::CREATE)
                .union(OFlags::APPEND);
            true
        }
    };
    let descriptor = rustix::fs::openat(
        &dir,
        name,
        flags,
        if create {
            Mode::from_raw_mode(0o600)
        } else {
            Mode::empty()
        },
    )
    .map_err(std::io::Error::from)
    .map_err(|err| Error::Workspace(format!("abrir arquivo de sessao sem symlink: {err}")))?;
    Ok(std::fs::File::from(descriptor))
}

#[cfg(not(unix))]
fn open_named(path: &Path, mode: OpenMode) -> Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    match mode {
        OpenMode::Read => {
            options.read(true);
        }
        OpenMode::WriteCreate => {
            options.read(true).write(true).create(true);
        }
        OpenMode::WriteCreateAppend => {
            options.write(true).create(true).append(true);
        }
    }
    options
        .open(path)
        .map_err(|err| Error::Workspace(format!("abrir arquivo de sessao: {err}")))
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
