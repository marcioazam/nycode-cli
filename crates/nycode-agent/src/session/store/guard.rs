use std::path::Path;

use crate::error::{Error, Result};

pub(super) struct SessionLock {
    _file: std::fs::File,
}

impl SessionLock {
    pub(super) fn acquire(path: &Path) -> Result<Self> {
        let lock_path = path.with_extension("lock");
        let file = open_unix(
            &lock_path,
            #[cfg(unix)]
            rustix::fs::OFlags::RDWR
                .union(rustix::fs::OFlags::CREATE)
                .union(rustix::fs::OFlags::NOFOLLOW)
                .union(rustix::fs::OFlags::CLOEXEC),
            #[cfg(unix)]
            rustix::fs::Mode::from_raw_mode(0o600),
        )
        .map_err(|err| Error::Workspace(format!("abrir lock de sessao: {err}")))?;
        #[cfg(unix)]
        rustix::fs::flock(&file, rustix::fs::FlockOperation::LockExclusive)
            .map_err(|err| Error::Workspace(format!("bloquear sessao: {err}")))?;
        Ok(Self { _file: file })
    }
}

#[cfg(unix)]
fn open_unix(
    path: &Path,
    flags: rustix::fs::OFlags,
    mode: rustix::fs::Mode,
) -> std::io::Result<std::fs::File> {
    let dir = std::fs::File::open(path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "sessao sem diretorio pai")
    })?)?;
    let name = path.file_name().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "sessao sem nome de arquivo",
        )
    })?;
    let descriptor = rustix::fs::openat(&dir, name, flags, mode).map_err(std::io::Error::from)?;
    Ok(std::fs::File::from(descriptor))
}

#[cfg(not(unix))]
fn open_unix(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(path)
}

pub(super) fn open_session_for_append(path: &Path) -> Result<std::fs::File> {
    #[cfg(unix)]
    let file = open_unix(
        path,
        rustix::fs::OFlags::WRONLY
            .union(rustix::fs::OFlags::CREATE)
            .union(rustix::fs::OFlags::APPEND)
            .union(rustix::fs::OFlags::NOFOLLOW)
            .union(rustix::fs::OFlags::CLOEXEC),
        rustix::fs::Mode::from_raw_mode(0o600),
    );
    #[cfg(not(unix))]
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path);
    file.map_err(|err| Error::Workspace(format!("abrir sessao sem symlink: {err}")))
}

pub(super) fn read_session(path: &Path) -> Result<String> {
    use std::io::Read as _;

    #[cfg(unix)]
    let mut file = open_unix(
        path,
        rustix::fs::OFlags::RDONLY
            .union(rustix::fs::OFlags::NOFOLLOW)
            .union(rustix::fs::OFlags::CLOEXEC),
        rustix::fs::Mode::empty(),
    )
    .map_err(|err| Error::Workspace(format!("ler sessao sem symlink: {err}")))?;
    #[cfg(not(unix))]
    let mut file =
        std::fs::File::open(path).map_err(|err| Error::Workspace(format!("ler sessao: {err}")))?;

    let mut contents = String::new();
    file.read_to_string(&mut contents)
        .map_err(|err| Error::Workspace(format!("ler conteudo da sessao: {err}")))?;
    Ok(contents)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_path_without_a_parent_is_rejected() {
        assert!(read_session(Path::new("")).is_err());
    }

    #[test]
    fn a_session_path_without_a_file_name_is_rejected() {
        assert!(read_session(Path::new("/")).is_err());
    }

    #[test]
    fn session_ids_with_punctuation_are_rejected() {
        assert!(validate_id("bad!").is_err());
    }
}
