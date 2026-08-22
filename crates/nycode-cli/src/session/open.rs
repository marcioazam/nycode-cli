//! Qual arquivo de sessão esta invocação abre.

use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

use anyhow::Context as _;
use nycode_agent::Store;
use nycode_ai::anthropic::Message;

use crate::Cli;

pub fn resolve(store: &Store, cli: &Cli) -> anyhow::Result<(String, Vec<Message>)> {
    let (id, history) = open(store, cli)?;
    if let Some(name) = cli.name.as_deref() {
        let name = name.trim();
        anyhow::ensure!(!name.is_empty(), "nome de sessao vazio");
        let path = name_path(store, &id);
        write_name(&path, name).with_context(|| format!("gravar nome da sessao `{id}`"))?;
        anyhow::ensure!(
            name_of(store, &id).as_deref() == Some(name),
            "nome de sessao `{id}` nao persistiu"
        );
    }
    Ok((id, history))
}

#[must_use]
pub(crate) fn name_of(store: &Store, id: &str) -> Option<String> {
    let path = name_path(store, id);
    let text = read_name(&path).ok()?;
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

fn name_path(store: &Store, id: &str) -> PathBuf {
    store.dir().join(format!("{id}.name"))
}

fn write_name(path: &Path, value: &str) -> io::Result<()> {
    use std::io::Write as _;

    #[cfg(unix)]
    {
        use rustix::fs::{Mode, OFlags};

        let dir = File::open(path.parent().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "nome sem diretorio pai")
        })?)?;
        let name = path
            .file_name()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "nome sem arquivo"))?;
        let descriptor = rustix::fs::openat(
            &dir,
            name,
            OFlags::WRONLY
                .union(OFlags::CREATE)
                .union(OFlags::TRUNC)
                .union(OFlags::NOFOLLOW)
                .union(OFlags::CLOEXEC),
            Mode::from_raw_mode(0o600),
        )
        .map_err(io::Error::from)?;
        let mut file = File::from(descriptor);
        file.write_all(value.as_bytes())?;
        file.sync_all()?;
    }

    #[cfg(not(unix))]
    std::fs::write(path, value)?;

    Ok(())
}

fn read_name(path: &Path) -> io::Result<String> {
    use std::io::Read as _;

    #[cfg(unix)]
    let mut file = {
        use rustix::fs::OFlags;

        let dir = File::open(path.parent().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "nome sem diretorio pai")
        })?)?;
        let name = path
            .file_name()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "nome sem arquivo"))?;
        let descriptor = rustix::fs::openat(
            &dir,
            name,
            OFlags::RDONLY
                .union(OFlags::NOFOLLOW)
                .union(OFlags::CLOEXEC),
            rustix::fs::Mode::empty(),
        )
        .map_err(io::Error::from)?;
        File::from(descriptor)
    };
    #[cfg(not(unix))]
    let mut file = File::open(path)?;

    let mut text = String::new();
    file.read_to_string(&mut text)?;
    Ok(text)
}

fn open(store: &Store, cli: &Cli) -> anyhow::Result<(String, Vec<Message>)> {
    if let Some(path) = &cli.import {
        return copy_into(store, path, cli.session_id.as_deref(), CopyKind::File);
    }
    if let Some(src) = &cli.fork {
        let (path, kind) = fork_src(store, src)?;
        return copy_into(store, &path, cli.session_id.as_deref(), kind);
    }
    if let Some(id) = &cli.session_id {
        validate_id(id)?;
        return if store.path_for(id)?.is_file() {
            Ok((id.clone(), store.load(id)?))
        } else {
            Ok((id.clone(), Vec::new()))
        };
    }
    if let Some(id) = &cli.resume {
        validate_id(id)?;
        return Ok((id.clone(), store.load(id)?));
    }
    if cli.continue_session
        && let Some(info) = store.latest()?
    {
        return Ok((info.id.clone(), store.load(&info.id)?));
    }
    Ok((Store::new_id(), Vec::new()))
}

/// Origem do `--fork`: id no store, senão arquivo no cwd.
///
/// Arquivo solto sem registros não pode virar `latest()`.
fn fork_src(store: &Store, src: &str) -> anyhow::Result<(PathBuf, CopyKind)> {
    let path = Path::new(src);
    if validate_id(src).is_ok() {
        let session_path = store.path_for(src)?;
        if let Ok(metadata) = std::fs::symlink_metadata(&session_path) {
            if metadata.file_type().is_symlink() {
                anyhow::bail!("arquivo `{}` nao encontrado", session_path.display());
            }
            if metadata.file_type().is_file() {
                return Ok((session_path, CopyKind::Session));
            }
        }
    }
    if path.is_file() {
        return Ok((path.to_path_buf(), CopyKind::File));
    }
    validate_id(src)?;
    let session_path = store.path_for(src)?;
    anyhow::bail!("arquivo `{}` nao encontrado", session_path.display())
}

#[derive(Clone, Copy)]
enum CopyKind {
    Session,
    File,
}

fn copy_into(
    store: &Store,
    src: &Path,
    dest: Option<&str>,
    kind: CopyKind,
) -> anyhow::Result<(String, Vec<Message>)> {
    anyhow::ensure!(src.is_file(), "arquivo `{}` nao encontrado", src.display());
    let id = match dest {
        Some(id) => {
            validate_id(id)?;
            id.to_owned()
        }
        None => Store::new_id(),
    };
    let dest_path = store.path_for(&id)?;
    let mut dest_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&dest_path)
        .map_err(|err| {
            if err.kind() == io::ErrorKind::AlreadyExists {
                anyhow::anyhow!("sessao `{id}` ja existe")
            } else {
                anyhow::Error::from(err).context(format!("criar sessao `{id}`"))
            }
        })?;
    let copied = (|| -> anyhow::Result<Vec<Message>> {
        let mut from = File::open(src).with_context(|| format!("abrir `{}`", src.display()))?;
        io::copy(&mut from, &mut dest_file)
            .with_context(|| format!("copiar `{}`", src.display()))?;
        dest_file
            .sync_all()
            .with_context(|| format!("gravar sessao `{id}`"))?;
        drop(dest_file);
        Ok(store.load(&id)?)
    })();
    match copied {
        Ok(history) if matches!(kind, CopyKind::File) && history.is_empty() => {
            std::fs::remove_file(&dest_path)
                .with_context(|| format!("remover copia vazia `{id}`"))?;
            anyhow::bail!("arquivo nao contem registros de sessao");
        }
        Ok(history) => Ok((id, history)),
        Err(err) => {
            if let Err(cleanse) = std::fs::remove_file(&dest_path) {
                return Err(err.context(format!(
                    "nao foi possivel remover a copia `{id}`: {cleanse}"
                )));
            }
            Err(err)
        }
    }
}

fn validate_id(id: &str) -> anyhow::Result<()> {
    anyhow::ensure!(
        !id.is_empty()
            && id.len() <= MAX_SESSION_ID_LEN
            && id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
        "identificador de sessao `{id}` recusado"
    );
    Ok(())
}

const MAX_SESSION_ID_LEN: usize = 128;

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use clap::Parser as _;
    use nycode_agent::Store;
    use nycode_ai::anthropic::Message;

    use super::resolve;
    use crate::Cli;

    struct CwdFile(std::path::PathBuf);
    impl Drop for CwdFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().join("s")).unwrap();
        (dir, store)
    }

    fn parse(extra: &[&str]) -> Cli {
        let mut argv = vec!["nycode", "-p", "oi"];
        argv.extend_from_slice(extra);
        Cli::try_parse_from(argv).unwrap()
    }

    fn err_of(store: &Store, extra: &[&str]) -> String {
        resolve(store, &parse(extra)).unwrap_err().to_string()
    }

    #[test]
    fn a_chosen_id_creates_the_session_when_it_is_missing() {
        let (_dir, store) = store();
        let (id, history) = resolve(&store, &parse(&["--session-id", "minha"])).unwrap();
        assert_eq!(id, "minha");
        assert!(history.is_empty());
        store.append("minha", &Message::user("oi")).unwrap();
        assert_eq!(
            resolve(&store, &parse(&["--session-id", "minha"]))
                .unwrap()
                .1
                .len(),
            1
        );
        let named = resolve(&store, &parse(&["--session-id", "s1", "--name", "auth"])).unwrap();
        assert_eq!(super::name_of(&store, &named.0).as_deref(), Some("auth"));
    }

    #[cfg(unix)]
    #[test]
    fn naming_a_symlinked_session_is_refused() {
        use std::os::unix::fs::symlink;

        let (dir, store) = store();
        let outside = dir.path().join("fora.txt");
        std::fs::write(&outside, "original\n").unwrap();
        symlink(&outside, store.dir().join("s1.name")).unwrap();

        let err = err_of(&store, &["--session-id", "s1", "--name", "novo"]);
        assert!(err.contains("gravar nome da sessao"), "{err}");
        assert_eq!(std::fs::read_to_string(outside).unwrap(), "original\n");
    }

    #[test]
    fn fork_copies_history_into_a_new_id() {
        let (_dir, store) = store();
        store.append("origem", &Message::user("base")).unwrap();
        let (id, history) = resolve(&store, &parse(&["--fork", "origem"])).unwrap();
        assert_ne!(id, "origem");
        assert_eq!(history, vec![Message::user("base")]);
        let err = err_of(&store, &["--fork", "origem", "--session-id", "origem"]);
        assert!(err.contains("ja existe"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn forking_a_symlinked_session_is_refused() {
        use std::os::unix::fs::symlink;

        let (_dir, store) = store();
        store.append("fora", &Message::user("nao copiar")).unwrap();
        symlink(
            store.path_for("fora").unwrap(),
            store.path_for("vitima").unwrap(),
        )
        .unwrap();

        let err = err_of(&store, &["--fork", "vitima"]);
        assert!(err.contains("nao encontrado"), "{err}");
    }

    #[test]
    fn import_copies_a_jsonl_file_into_the_store() {
        let (dir, store) = store();
        store.append("origem", &Message::user("base")).unwrap();
        let exported = dir.path().join("exported.jsonl");
        std::fs::copy(store.path_for("origem").unwrap(), &exported).unwrap();
        let (_id, history) =
            resolve(&store, &parse(&["--import", exported.to_str().unwrap()])).unwrap();
        assert_eq!(history, vec![Message::user("base")]);
    }

    #[test]
    fn forking_a_cwd_file_without_records_is_not_picked_by_continue() {
        let (dir, store) = store();
        store.append("origem", &Message::user("keep")).unwrap();
        let junk = dir.path().join("NOTICE");
        std::fs::write(&junk, "copyright\n").unwrap();
        let err = err_of(&store, &["--fork", junk.to_str().unwrap()]);
        assert!(err.contains("nao contem registros de sessao"), "{err}");
        let err = err_of(&store, &["--import", junk.to_str().unwrap()]);
        assert!(err.contains("nao contem registros de sessao"), "{err}");
        let latest = store.latest().unwrap().unwrap();
        assert_eq!(latest.id, "origem");
    }

    #[test]
    fn fork_of_a_cwd_file_named_like_an_id_copies_the_file_not_the_store() {
        let (_dir, store) = store();
        store.append("origem", &Message::user("base")).unwrap();
        let src = format!(
            "forksrc{}{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let path = std::env::current_dir().unwrap().join(&src);
        std::fs::copy(store.path_for("origem").unwrap(), &path).unwrap();
        let _clean = CwdFile(path);
        let (_id, history) = resolve(&store, &parse(&["--fork", &src])).unwrap();
        assert_eq!(history, vec![Message::user("base")]);
    }

    #[test]
    fn a_path_like_id_is_refused_instead_of_leaving_the_store() {
        let (_dir, store) = store();
        for flag in ["--session-id", "--resume", "--fork"] {
            let err = err_of(&store, &[flag, "../x"]);
            assert!(err.contains("recusado"), "{flag}: {err}");
        }
    }
}
