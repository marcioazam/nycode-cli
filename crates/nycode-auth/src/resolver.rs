//! Ordem de resolução de credenciais.

use crate::{Error, Result};

/// Serviço sob o qual as credenciais são gravadas no cofre do sistema.
const KEYRING_SERVICE: &str = "nycode";

/// De onde a credencial veio.
///
/// Exposto porque um usuário depurando "por que está usando a chave errada"
/// precisa saber qual das três fontes venceu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// Passada explicitamente na linha de comando.
    Flag,
    /// Lida de uma variável de ambiente.
    Environment(&'static str),
    /// Lida do cofre de credenciais do sistema operacional.
    Keyring,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Credential {
    pub secret: String,
    pub source: Source,
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
}

impl Resolver {
    #[must_use]
    pub fn new(provider: impl Into<String>) -> Self {
        Self {
            provider: provider.into(),
            env_vars: Vec::new(),
        }
    }

    /// Variáveis de ambiente consultadas, em ordem.
    #[must_use]
    pub fn with_env_vars(mut self, vars: &[&'static str]) -> Self {
        self.env_vars = vars.to_vec();
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
        let mut options = vec!["--api-key".to_owned()];
        options.extend(self.env_vars.iter().map(|v| format!("${v}")));
        options.push(format!("`nycode auth login {}`", self.provider));
        options.join(", ")
    }
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
