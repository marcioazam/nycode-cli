//! Ordem de resolução de credenciais.

use crate::{Error, Result};

/// Serviço sob o qual as credenciais são gravadas no cofre do sistema.
const KEYRING_SERVICE: &str = "nycode";

/// De onde a credencial veio.
///
/// Exposto porque um usuário depurando "por que está usando a chave errada"
/// precisa saber qual das três fontes venceu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Source {
    /// Passada explicitamente na linha de comando.
    Flag,
    /// Lida de um arquivo apontado na linha de comando.
    File(std::path::PathBuf),
    /// Lida de uma variável de ambiente.
    Environment(&'static str),
    /// Lida do cofre de credenciais do sistema operacional.
    Keyring,
}

/// Credencial resolvida, com a origem de onde ela veio.
///
/// `Debug` é manual e redige o segredo. Derivá-lo transformaria qualquer
/// `{:?}` — num log, numa mensagem de erro, num `dbg!` esquecido — em vazamento
/// da chave do usuário. A higiene atual está correta e é justamente por isso
/// que a trava é aqui: o risco é a próxima linha de log, não uma existente.
#[derive(Clone, PartialEq, Eq)]
pub struct Credential {
    pub secret: String,
    pub source: Source,
}

impl std::fmt::Debug for Credential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // A origem fica: é o que um usuário depurando "por que está usando a
        // chave errada" precisa ver, e é a razão de `source` ser público.
        f.debug_struct("Credential")
            .field("secret", &"<redigido>")
            .field("source", &self.source)
            .finish()
    }
}

/// Resolve a credencial de um provider.
///
/// A ordem é: valor explícito, depois ambiente, depois cofre. Explícito vence
/// porque é o que o usuário acabou de digitar; o cofre é o último porque é o
/// menos visível e o mais fácil de ficar obsoleto.
#[derive(Debug, Clone)]
pub struct Resolver {
    provider: String,
    env_vars: Vec<&'static str>,
    file: Option<std::path::PathBuf>,
}

impl Resolver {
    #[must_use]
    pub fn new(provider: impl Into<String>) -> Self {
        Self {
            provider: provider.into(),
            env_vars: Vec::new(),
            file: None,
        }
    }

    /// Variáveis de ambiente consultadas, em ordem.
    #[must_use]
    pub fn with_env_vars(mut self, vars: &[&'static str]) -> Self {
        self.env_vars = vars.to_vec();
        self
    }

    /// Arquivo de onde ler a credencial, consultado antes do ambiente.
    ///
    /// Existe porque um argumento de linha de comando fica visível no `ps` para
    /// qualquer processo da máquina, e num histórico de shell depois disso. Como
    /// o valor é um caminho, `/dev/stdin` e substituição de processo —
    /// `--api-key-file <(pass show gateway)` — funcionam sem caso especial.
    #[must_use]
    pub fn with_file(mut self, path: Option<std::path::PathBuf>) -> Self {
        self.file = path;
        self
    }

    pub fn resolve(&self, explicit: Option<&str>) -> Result<Credential> {
        // `std::env::var` e generica sobre a chave, entao referencia-la
        // diretamente fixa um lifetime concreto e nao satisfaz o
        // `for<'a> Fn(&'a str)` do parametro. O closure e inferido como
        // higher-ranked.
        self.resolve_with(
            explicit,
            &|key: &str| std::env::var(key),
            &|provider: &str| keyring_lookup(provider),
        )
    }

    /// Resolução com as fontes injetadas, para teste.
    ///
    /// Ler o ambiente do processo real num teste torna a suíte dependente da
    /// ordem de execução, já que `set_var` é global.
    fn resolve_with(
        &self,
        explicit: Option<&str>,
        env: &dyn Fn(&str) -> std::result::Result<String, std::env::VarError>,
        keyring: &dyn Fn(&str) -> Option<String>,
    ) -> Result<Credential> {
        if let Some(secret) = explicit.filter(|s| !s.is_empty()) {
            return Ok(Credential {
                secret: secret.to_owned(),
                source: Source::Flag,
            });
        }

        // Um arquivo ilegível é erro e não ausência: quem apontou `--api-key-file`
        // disse qual credencial usar, e cair para o ambiente escolheria outra em
        // silêncio.
        if let Some(path) = &self.file {
            return Ok(Credential {
                secret: read_credential_file(path)?,
                source: Source::File(path.clone()),
            });
        }

        for var in &self.env_vars {
            if let Ok(secret) = env(var)
                && !secret.is_empty()
            {
                return Ok(Credential {
                    secret,
                    source: Source::Environment(var),
                });
            }
        }

        if let Some(secret) = keyring(&self.provider) {
            return Ok(Credential {
                secret,
                source: Source::Keyring,
            });
        }

        Err(Error::NotFound {
            service: self.provider.clone(),
            hint: self.hint(),
        })
    }

    fn hint(&self) -> String {
        let mut options = vec!["--api-key-file".to_owned()];
        options.extend(self.env_vars.iter().map(|v| format!("${v}")));
        options.push(format!("`nycode auth login {}`", self.provider));
        options.join(", ")
    }
}

/// Lê a credencial de um arquivo, recusando um que a máquina inteira possa ler.
///
/// A recusa é a mesma do `ssh` com uma chave privada frouxa, e pela mesma razão:
/// mover a credencial do `argv` para um arquivo só ajuda se o arquivo não for
/// legível por qualquer conta da máquina. O teste de modo vale só para arquivo
/// comum — um `/dev/stdin` ou um pipe de substituição de processo tem modo
/// próprio e vida curta, e recusá-lo negaria justamente o uso mais seguro.
fn read_credential_file(path: &std::path::Path) -> Result<String> {
    let fail = |reason: String| Error::CredentialFile {
        path: path.display().to_string(),
        reason,
    };

    let metadata = std::fs::metadata(path).map_err(|err| fail(err.to_string()))?;
    if metadata.is_file() {
        refuse_if_others_can_read(&metadata).map_err(fail)?;
    }

    let contents = std::fs::read_to_string(path).map_err(|err| fail(err.to_string()))?;
    // O `\n` final é do editor, não da credencial; mandá-lo no cabeçalho produz
    // um 401 que não se explica.
    let secret = contents.trim().to_owned();
    if secret.is_empty() {
        return Err(fail("esta vazio".to_owned()));
    }
    Ok(secret)
}

#[cfg(unix)]
fn refuse_if_others_can_read(metadata: &std::fs::Metadata) -> std::result::Result<(), String> {
    use std::os::unix::fs::MetadataExt;

    let mode = metadata.mode() & 0o777;
    let group_and_other = mode & 0o077;
    if group_and_other == 0 {
        return Ok(());
    }
    Err(format!(
        "modo {mode:04o} deixa outras contas da maquina lerem a credencial; \
         rode `chmod 600` nele"
    ))
}

#[cfg(not(unix))]
fn refuse_if_others_can_read(_metadata: &std::fs::Metadata) -> std::result::Result<(), String> {
    // Sem o modelo de modo do Unix não há o que checar aqui; a ACL do Windows
    // não se reduz a três bits, e adivinhá-la seria pior que não checar.
    Ok(())
}

/// Consulta o cofre do sistema.
///
/// Uma falha aqui não é erro: o cofre pode simplesmente não existir na máquina,
/// e nesse caso a ausência de credencial é o resultado correto.
fn keyring_lookup(provider: &str) -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, provider).ok()?;
    entry.get_password().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env_from(
        pairs: &[(&str, &str)],
    ) -> impl Fn(&str) -> std::result::Result<String, std::env::VarError> + use<> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        move |key| map.get(key).cloned().ok_or(std::env::VarError::NotPresent)
    }

    fn no_keyring(_: &str) -> Option<String> {
        None
    }

    fn resolver() -> Resolver {
        Resolver::new("gateway").with_env_vars(&["NYCODE_API_KEY", "NYLLA_API_KEY"])
    }

    #[test]
    fn an_explicit_value_wins_over_everything() {
        let env = env_from(&[("NYCODE_API_KEY", "do-ambiente")]);
        let cred = resolver()
            .resolve_with(Some("explicita"), &env, &|_| Some("do-cofre".to_owned()))
            .unwrap();
        assert_eq!(cred.secret, "explicita");
        assert_eq!(cred.source, Source::Flag);
    }

    #[test]
    fn environment_wins_over_the_keyring() {
        let env = env_from(&[("NYCODE_API_KEY", "do-ambiente")]);
        let cred = resolver()
            .resolve_with(None, &env, &|_| Some("do-cofre".to_owned()))
            .unwrap();
        assert_eq!(cred.secret, "do-ambiente");
        assert_eq!(cred.source, Source::Environment("NYCODE_API_KEY"));
    }

    #[test]
    fn env_vars_are_consulted_in_declared_order() {
        let env = env_from(&[("NYLLA_API_KEY", "segunda"), ("NYCODE_API_KEY", "primeira")]);
        let cred = resolver().resolve_with(None, &env, &no_keyring).unwrap();
        assert_eq!(cred.secret, "primeira", "a ordem declarada foi ignorada");
    }

    #[test]
    fn falls_back_to_the_second_env_var() {
        let env = env_from(&[("NYLLA_API_KEY", "segunda")]);
        let cred = resolver().resolve_with(None, &env, &no_keyring).unwrap();
        assert_eq!(cred.source, Source::Environment("NYLLA_API_KEY"));
    }

    /// Escreve uma credencial num arquivo com o modo pedido.
    fn credential_file(dir: &tempfile::TempDir, contents: &str, mode: u32) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let path = dir.path().join("chave");
        std::fs::write(&path, contents).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode)).unwrap();
        path
    }

    #[test]
    fn a_credential_file_keeps_the_secret_out_of_the_process_arguments() {
        // Um `--api-key` fica visivel no `ps` para qualquer conta da maquina.
        let dir = tempfile::tempdir().unwrap();
        let path = credential_file(&dir, "sk-do-arquivo", 0o600);

        let cred = resolver()
            .with_file(Some(path.clone()))
            .resolve_with(None, &env_from(&[]), &no_keyring)
            .unwrap();

        assert_eq!(cred.secret, "sk-do-arquivo");
        assert_eq!(cred.source, Source::File(path));
    }

    #[test]
    fn the_newline_the_editor_added_is_not_part_of_the_credential() {
        // Manda-lo no cabecalho produz um 401 que nao se explica.
        let dir = tempfile::tempdir().unwrap();
        let path = credential_file(&dir, "sk-do-arquivo\n", 0o600);

        let cred = resolver()
            .with_file(Some(path))
            .resolve_with(None, &env_from(&[]), &no_keyring)
            .unwrap();

        assert_eq!(cred.secret, "sk-do-arquivo");
    }

    #[test]
    fn a_credential_file_the_whole_machine_can_read_is_refused() {
        // Tirar a credencial do `argv` so ajuda se o arquivo tambem nao for
        // legivel por qualquer conta. E a mesma recusa do `ssh`, pela mesma razao.
        let dir = tempfile::tempdir().unwrap();
        let path = credential_file(&dir, "sk-exposta", 0o644);

        let err = resolver()
            .with_file(Some(path))
            .resolve_with(None, &env_from(&[]), &no_keyring)
            .expect_err("um arquivo 0644 deveria ser recusado");

        let rendered = format!("{err}");
        assert!(rendered.contains("chmod 600"), "{rendered}");
        assert!(
            !rendered.contains("sk-exposta"),
            "vazou o segredo: {rendered}"
        );
    }

    #[test]
    fn a_credential_file_that_cannot_be_read_is_an_error_and_not_a_fallback() {
        // Quem apontou `--api-key-file` disse qual credencial usar. Cair para o
        // ambiente escolheria outra em silencio, e a sessao falaria com o
        // gateway errado sem dizer nada.
        let dir = tempfile::tempdir().unwrap();
        let ausente = dir.path().join("nao-existe");

        let err = resolver()
            .with_file(Some(ausente))
            .resolve_with(
                None,
                &env_from(&[("NYCODE_API_KEY", "do-ambiente")]),
                &|_| Some("do-cofre".to_owned()),
            )
            .expect_err("um arquivo ausente e erro, nao ausencia");

        assert!(matches!(err, Error::CredentialFile { .. }), "{err:?}");
    }

    #[test]
    fn an_empty_credential_file_is_refused_instead_of_producing_a_confusing_401() {
        let dir = tempfile::tempdir().unwrap();
        let path = credential_file(&dir, "   \n\n", 0o600);

        let err = resolver()
            .with_file(Some(path))
            .resolve_with(None, &env_from(&[]), &no_keyring)
            .expect_err("um arquivo vazio deveria ser recusado");

        assert!(format!("{err}").contains("esta vazio"), "{err}");
    }

    #[test]
    fn an_explicit_argument_still_wins_over_a_file() {
        // As duas fontes se excluem na linha de comando; a ordem aqui e o que
        // torna o comportamento definido se alguem construir o resolver na mao.
        let dir = tempfile::tempdir().unwrap();
        let path = credential_file(&dir, "do-arquivo", 0o600);

        let cred = resolver()
            .with_file(Some(path))
            .resolve_with(Some("explicita"), &env_from(&[]), &no_keyring)
            .unwrap();

        assert_eq!(cred.secret, "explicita");
    }

    #[test]
    fn a_credential_file_is_consulted_before_the_environment() {
        let dir = tempfile::tempdir().unwrap();
        let path = credential_file(&dir, "do-arquivo", 0o600);

        let cred = resolver()
            .with_file(Some(path))
            .resolve_with(
                None,
                &env_from(&[("NYCODE_API_KEY", "do-ambiente")]),
                &|_| Some("do-cofre".to_owned()),
            )
            .unwrap();

        assert_eq!(cred.secret, "do-arquivo");
    }

    #[test]
    fn the_hint_points_at_the_flag_that_does_not_leak_into_ps() {
        let err = resolver()
            .resolve_with(None, &env_from(&[]), &no_keyring)
            .expect_err("sem nenhuma fonte");
        let rendered = format!("{err}");
        assert!(rendered.contains("--api-key-file"), "{rendered}");
    }

    #[test]
    fn the_keyring_is_the_last_resort() {
        let env = env_from(&[]);
        let cred = resolver()
            .resolve_with(None, &env, &|_| Some("do-cofre".to_owned()))
            .unwrap();
        assert_eq!(cred.secret, "do-cofre");
        assert_eq!(cred.source, Source::Keyring);
    }

    #[test]
    fn an_empty_value_is_treated_as_absent() {
        // Uma flag vazia ou `NYCODE_API_KEY=` exportada por um script sao
        // ausencia, nao credencial vazia. Aceita-las produziria um 401 confuso
        // em vez de uma mensagem util.
        let env = env_from(&[("NYCODE_API_KEY", "")]);
        let cred = resolver()
            .resolve_with(Some(""), &env, &|_| Some("do-cofre".to_owned()))
            .unwrap();
        assert_eq!(cred.source, Source::Keyring);
    }

    #[test]
    fn a_debug_view_of_a_credential_never_contains_the_secret() {
        // O `{:?}` derivado transformava qualquer log, mensagem de erro ou
        // `dbg!` esquecido em vazamento da chave.
        let cred = Credential {
            secret: "sk-segredo-do-usuario".to_owned(),
            source: Source::Keyring,
        };
        let rendered = format!("{cred:?}");

        assert!(!rendered.contains("sk-segredo-do-usuario"), "{rendered}");
        // A origem fica: e o que responde "por que esta usando a chave errada".
        assert!(rendered.contains("Keyring"), "{rendered}");
    }

    #[test]
    fn the_error_names_every_way_to_supply_the_credential() {
        let env = env_from(&[]);
        let err = resolver()
            .resolve_with(None, &env, &no_keyring)
            .unwrap_err();
        let message = err.to_string();
        assert!(message.contains("--api-key"));
        assert!(message.contains("$NYCODE_API_KEY"));
        assert!(message.contains("nycode auth login gateway"));
    }
}
