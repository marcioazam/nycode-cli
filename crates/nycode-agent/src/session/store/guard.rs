use std::io;
use std::path::Path;

use crate::error::{Error, Result};

pub(super) struct SessionLock {
    _file: std::fs::File,
}

impl SessionLock {
    pub(super) fn acquire(path: &Path) -> Result<Self> {
        let lock_path = path.with_extension("lock");
        let file = open_lock(&lock_path)
            .map_err(|err| Error::Workspace(format!("abrir lock de sessao: {err}")))?;
        #[cfg(unix)]
        rustix::fs::flock(&file, rustix::fs::FlockOperation::LockExclusive)
            .map_err(|err| Error::Workspace(format!("bloquear sessao: {err}")))?;
        Ok(Self { _file: file })
    }
}

pub(super) fn open_session_for_append(path: &Path) -> Result<std::fs::File> {
    open_file(path, &FileMode::Append)
        .map_err(|err| Error::Workspace(format!("abrir sessao sem symlink: {err}")))
}

pub(super) fn open_session_for_rewrite(path: &Path) -> Result<std::fs::File> {
    open_file(path, &FileMode::Rewrite)
        .map_err(|err| Error::Workspace(format!("reescrever sessao sem symlink: {err}")))
}

pub(super) fn read_session(path: &Path) -> io::Result<String> {
    let mut file = open_file(path, &FileMode::Read)?;
    let mut contents = String::new();
    std::io::Read::read_to_string(&mut file, &mut contents)?;
    Ok(contents)
}

pub(super) fn open_directory(path: &Path) -> io::Result<std::fs::File> {
    #[cfg(unix)]
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
        .map_err(io::Error::from)?;
        Ok(std::fs::File::from(descriptor))
    }
    #[cfg(not(unix))]
    {
        std::fs::File::open(path)
    }
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

enum FileMode {
    Read,
    Append,
    Rewrite,
}

fn open_file(path: &Path, mode: &FileMode) -> io::Result<std::fs::File> {
    #[cfg(unix)]
    {
        use rustix::fs::{Mode, OFlags};

        let parent = path.parent().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "sessao sem diretorio pai")
        })?;
        let directory = open_directory(parent)?;
        let name = path
            .file_name()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "sessao sem nome"))?;
        let flags = match mode {
            FileMode::Read => OFlags::RDONLY,
            FileMode::Append => OFlags::WRONLY.union(OFlags::CREATE).union(OFlags::APPEND),
            FileMode::Rewrite => OFlags::WRONLY.union(OFlags::TRUNC),
        }
        .union(OFlags::NOFOLLOW)
        .union(OFlags::CLOEXEC);
        let descriptor = rustix::fs::openat(&directory, name, flags, Mode::from_raw_mode(0o600))
            .map_err(io::Error::from)?;
        Ok(std::fs::File::from(descriptor))
    }

    #[cfg(not(unix))]
    {
        let mut options = std::fs::OpenOptions::new();
        match mode {
            FileMode::Read => {
                options.read(true);
            }
            FileMode::Append => {
                options.write(true).create(true).append(true);
            }
            FileMode::Rewrite => {
                options.write(true).truncate(true);
            }
        }
        options.open(path)
    }
}

fn open_lock(path: &Path) -> io::Result<std::fs::File> {
    #[cfg(unix)]
    {
        use rustix::fs::{Mode, OFlags};

        let parent = path
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "lock sem diretorio pai"))?;
        let directory = open_directory(parent)?;
        let name = path
            .file_name()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "lock sem nome"))?;
        let descriptor = rustix::fs::openat(
            &directory,
            name,
            OFlags::RDWR
                .union(OFlags::CREATE)
                .union(OFlags::NOFOLLOW)
                .union(OFlags::CLOEXEC),
            Mode::from_raw_mode(0o600),
        )
        .map_err(io::Error::from)?;
        Ok(std::fs::File::from(descriptor))
    }

    #[cfg(not(unix))]
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(path)
}
