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
        std::fs::write(store.dir().join(format!("{id}.name")), name)
            .with_context(|| format!("gravar nome da sessao `{id}`"))?;
    }
    Ok((id, history))
}

#[must_use]
pub(crate) fn name_of(store: &Store, id: &str) -> Option<String> {
    let text = std::fs::read_to_string(store.dir().join(format!("{id}.name"))).ok()?;
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
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
        return if store.path_for(id).is_file() {
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
    let as_session = validate_id(src).is_ok() && store.path_for(src).is_file();
    if as_session {
        return Ok((store.path_for(src), CopyKind::Session));
    }
    if path.is_file() {
        return Ok((path.to_path_buf(), CopyKind::File));
    }
    validate_id(src)?;
    anyhow::bail!("arquivo `{}` nao encontrado", store.path_for(src).display())
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
    let dest_path = store.path_for(&id);
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

    #[test]
    fn import_copies_a_jsonl_file_into_the_store() {
        let (dir, store) = store();
        store.append("origem", &Message::user("base")).unwrap();
        let exported = dir.path().join("exported.jsonl");
        std::fs::copy(store.path_for("origem"), &exported).unwrap();
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
        std::fs::copy(store.path_for("origem"), &path).unwrap();
        struct Clean(std::path::PathBuf);
        impl Drop for Clean {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(&self.0);
            }
        }
        let _clean = Clean(path);
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
