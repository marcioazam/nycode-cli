//! Qual arquivo de sessão esta invocação abre.

use std::path::Path;

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
        return copy_into(store, path, cli.session_id.as_deref(), true);
    }
    if let Some(src) = &cli.fork {
        let path = Path::new(src);
        let src = if path.is_file() {
            path.to_path_buf()
        } else {
            store.path_for(src)
        };
        return copy_into(store, &src, cli.session_id.as_deref(), false);
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
        return Ok((id.clone(), store.load(id)?));
    }
    if cli.continue_session
        && let Some(info) = store.latest()?
    {
        return Ok((info.id.clone(), store.load(&info.id)?));
    }
    Ok((Store::new_id(), Vec::new()))
}

fn copy_into(
    store: &Store,
    src: &Path,
    dest: Option<&str>,
    require_history: bool,
) -> anyhow::Result<(String, Vec<Message>)> {
    anyhow::ensure!(src.is_file(), "arquivo `{}` nao encontrado", src.display());
    let id = match dest {
        Some(id) => {
            validate_id(id)?;
            anyhow::ensure!(!store.path_for(id).exists(), "sessao `{id}` ja existe");
            id.to_owned()
        }
        None => Store::new_id(),
    };
    let dest_path = store.path_for(&id);
    std::fs::copy(src, &dest_path).with_context(|| format!("copiar `{}`", src.display()))?;
    let history = store.load(&id)?;
    if require_history && history.is_empty() {
        let _ = std::fs::remove_file(&dest_path);
        anyhow::bail!("arquivo nao contem registros de sessao");
    }
    Ok((id, history))
}

fn validate_id(id: &str) -> anyhow::Result<()> {
    anyhow::ensure!(
        !id.is_empty()
            && id.len() <= 128
            && id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
        "identificador de sessao `{id}` recusado"
    );
    Ok(())
}
