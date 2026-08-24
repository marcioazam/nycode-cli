use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

pub(super) struct SessionLock {
    _file: std::fs::File,
}

impl SessionLock {
    pub(super) fn acquire(directory: &std::fs::File, id: &str) -> Result<Self> {
        validate_id(id)?;
        let lock_name = format!("{id}.lock");
        let file = open_no_follow(directory, OsStr::new(&lock_name), OpenMode::Lock)
            .map_err(|err| Error::Workspace(format!("abrir lock de sessao: {err}")))?;
        #[cfg(unix)]
        rustix::fs::flock(&file, rustix::fs::FlockOperation::LockExclusive)
            .map_err(|err| Error::Workspace(format!("bloquear sessao: {err}")))?;
        Ok(Self { _file: file })
    }
}

pub(super) fn open_session_for_append(
    directory: &std::fs::File,
    id: &str,
) -> Result<std::fs::File> {
    validate_id(id)?;
    let name = format!("{id}.jsonl");
    open_no_follow(directory, OsStr::new(&name), OpenMode::Append)
        .map_err(|err| Error::Workspace(format!("abrir sessao sem symlink: {err}")))
}

pub(super) fn open_directory_without_symlinks(path: &Path) -> Result<std::fs::File> {
    create_directory_without_symlinks(path)?;
    #[cfg(target_os = "linux")]
    {
        use rustix::fs::{Mode, OFlags, ResolveFlags};
        let descriptor = rustix::fs::openat2(
            rustix::fs::CWD,
            path,
            OFlags::RDONLY
                .union(OFlags::DIRECTORY)
                .union(OFlags::CLOEXEC),
            Mode::empty(),
            ResolveFlags::NO_SYMLINKS,
        )
        .map_err(|err| Error::Workspace(format!("abrir diretorio de sessoes: {err}")))?;
        Ok(std::fs::File::from(descriptor))
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        use rustix::fs::{Mode, OFlags};
        let descriptor = rustix::fs::open(
            path,
            OFlags::RDONLY
                .union(OFlags::DIRECTORY)
                .union(OFlags::NOFOLLOW)
                .union(OFlags::CLOEXEC),
            Mode::empty(),
        )
        .map_err(|err| Error::Workspace(format!("abrir diretorio de sessoes: {err}")))?;
        Ok(std::fs::File::from(descriptor))
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Err(Error::Workspace(
            "diretorio de sessoes sem symlink nao e suportado nesta plataforma".to_owned(),
        ))
    }
}

pub(super) fn open_session_for_read(directory: &std::fs::File, id: &str) -> Result<std::fs::File> {
    validate_id(id)?;
    let name = format!("{id}.jsonl");
    open_no_follow(directory, OsStr::new(&name), OpenMode::Read)
        .map_err(|err| Error::Workspace(format!("abrir sessao sem symlink: {err}")))
}

pub(super) fn remove_session(directory: &std::fs::File, id: &str) -> Result<()> {
    let name = format!("{id}.jsonl");
    #[cfg(unix)]
    rustix::fs::unlinkat(directory, OsStr::new(&name), rustix::fs::AtFlags::empty())
        .map_err(|err| Error::Workspace(format!("remover sessao: {err}")))?;
    #[cfg(not(unix))]
    {
        let _ = (directory, name);
        return Err(Error::Workspace(
            "remocao segura de sessao nao e suportada nesta plataforma".to_owned(),
        ));
    }
    Ok(())
}

pub(super) fn create_directory_without_symlinks(path: &Path) -> Result<()> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(Error::Workspace(format!(
                    "diretorio de sessoes contem symlink: {}",
                    current.display()
                )));
            }
            Ok(metadata) if !metadata.is_dir() => {
                return Err(Error::Workspace(format!(
                    "componente de sessoes nao e diretorio: {}",
                    current.display()
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                std::fs::create_dir(&current).map_err(|create_error| {
                    Error::Workspace(format!(
                        "criar sessoes em {}: {create_error}",
                        current.display()
                    ))
                })?;
            }
            Err(error) => {
                return Err(Error::Workspace(format!(
                    "verificar sessoes em {}: {error}",
                    current.display()
                )));
            }
        }
    }
    Ok(())
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

#[derive(Clone, Copy)]
pub(super) enum OpenMode {
    Read,
    Write,
    CreateNew,
    Append,
    Lock,
}

pub(super) fn open_no_follow(
    directory: &std::fs::File,
    name: &OsStr,
    mode: OpenMode,
) -> std::io::Result<std::fs::File> {
    #[cfg(unix)]
    {
        use rustix::fs::{Mode, OFlags};

        let flags = match mode {
            OpenMode::Read => OFlags::RDONLY,
            OpenMode::Write => OFlags::WRONLY.union(OFlags::CREATE).union(OFlags::TRUNC),
            OpenMode::CreateNew => OFlags::WRONLY.union(OFlags::CREATE).union(OFlags::EXCL),
            OpenMode::Append => OFlags::WRONLY.union(OFlags::CREATE).union(OFlags::APPEND),
            OpenMode::Lock => OFlags::RDWR.union(OFlags::CREATE),
        }
        .union(OFlags::NOFOLLOW)
        .union(OFlags::CLOEXEC);
        let descriptor = rustix::fs::openat(directory, name, flags, Mode::from_raw_mode(0o600))
            .map_err(std::io::Error::from)?;
        Ok(std::fs::File::from(descriptor))
    }

    #[cfg(not(unix))]
    {
        let _ = (directory, name, mode);
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "abertura de sessao sem symlink nao e suportada nesta plataforma",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_session_paths_are_rejected_before_opening() {
        let dir = tempfile::tempdir().unwrap();
        let directory = std::fs::File::open(dir.path()).unwrap();
        assert!(open_no_follow(&directory, OsStr::new(""), OpenMode::Append).is_err());
    }

    #[test]
    fn a_file_cannot_become_a_session_directory() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("not-a-directory");
        std::fs::write(&file, "conteudo").unwrap();

        assert!(create_directory_without_symlinks(&file.join("sessoes")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_lock_is_refused() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().unwrap();
        let directory = std::fs::File::open(dir.path()).unwrap();
        let lock = dir.path().join("s1.lock");
        let target = dir.path().join("outside.lock");
        std::fs::write(&target, "").unwrap();
        symlink(&target, &lock).unwrap();

        assert!(SessionLock::acquire(&directory, "s1").is_err());
    }

    #[test]
    fn an_invalid_directory_path_is_reported() {
        assert!(create_directory_without_symlinks(Path::new("invalid\0path")).is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_read_only_filesystem_does_not_accept_a_new_session_directory() {
        let path = Path::new("/proc/nycode-agent-session-test");
        assert!(create_directory_without_symlinks(path).is_err());
    }
}
