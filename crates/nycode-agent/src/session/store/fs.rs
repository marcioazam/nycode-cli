use std::io::{Read as _, Write as _};

use crate::error::{Error, Result};

use super::Store;
use super::guard::{OpenMode, open_no_follow, open_session_for_read, remove_session, validate_id};
impl Store {
    pub fn open_session(&self, id: &str) -> Result<std::fs::File> {
        validate_id(id)?;
        open_session_for_read(&self.directory, id)
    }
    pub fn session_exists(&self, id: &str) -> Result<bool> {
        validate_id(id)?;
        let name = format!("{id}.jsonl");
        match open_no_follow(&self.directory, std::ffi::OsStr::new(&name), OpenMode::Read) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(Error::Workspace(format!(
                "verificar sessao `{id}`: {error}"
            ))),
        }
    }
    pub fn create_session_file(&self, id: &str) -> Result<std::fs::File> {
        validate_id(id)?;
        let name = format!("{id}.jsonl");
        open_no_follow(
            &self.directory,
            std::ffi::OsStr::new(&name),
            OpenMode::CreateNew,
        )
        .map_err(|err| {
            if err.kind() == std::io::ErrorKind::AlreadyExists {
                Error::Workspace(format!("sessao `{id}` ja existe"))
            } else {
                Error::Workspace(format!("criar sessao {id}: {err}"))
            }
        })
    }
    pub fn remove_session(&self, id: &str) -> Result<()> {
        validate_id(id)?;
        remove_session(&self.directory, id)
    }
    pub fn write_name(&self, id: &str, name: &str) -> Result<()> {
        validate_id(id)?;
        let file_name = format!("{id}.name");
        let mut file = open_no_follow(
            &self.directory,
            std::ffi::OsStr::new(&file_name),
            OpenMode::Write,
        )
        .map_err(|err| Error::Workspace(format!("gravar nome da sessao `{id}`: {err}")))?;
        file.write_all(name.as_bytes())
            .and_then(|()| file.sync_all())
            .map_err(|err| Error::Workspace(format!("gravar nome da sessao `{id}`: {err}")))
    }
    pub fn name(&self, id: &str) -> Result<Option<String>> {
        validate_id(id)?;
        let file_name = format!("{id}.name");
        let mut file = match open_no_follow(
            &self.directory,
            std::ffi::OsStr::new(&file_name),
            OpenMode::Read,
        ) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(Error::Workspace(format!(
                    "ler nome da sessao `{id}`: {error}"
                )));
            }
        };
        let mut text = String::new();
        file.read_to_string(&mut text)
            .map_err(|err| Error::Workspace(format!("ler nome da sessao `{id}`: {err}")))?;
        Ok((!text.trim().is_empty()).then(|| text.trim().to_owned()))
    }
}
