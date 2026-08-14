//! O ambiente que um processo filho recebe.
//!
//! O ambiente deste processo carrega as credenciais do usuário, a do gateway
//! inclusive: a resolução a procura em `NYCODE_API_KEY` e `NYLLA_API_KEY` antes
//! de chegar ao cofre do sistema. Todo filho herda esse ambiente por padrão, e
//! três dos que o harness sobe executam código que o harness não escreveu — o
//! hook do repositório, o servidor MCP declarado pelo workspace e o comando de
//! shell que o modelo compõe. Herdar ali faria de qualquer repositório clonado
//! um canal de saída para a chave, sem que nenhuma camada de política tivesse
//! sido contornada.
//!
//! O que um comando precisa além do mínimo é decisão do usuário, e por isso a
//! extensão é lida da configuração dele e nunca do workspace: um `.nycode/` do
//! repositório seria auto-certificante, pela mesma razão que o registro de
//! confiança vive fora da raiz ([ADR-0016](../../../../docs/architecture/decisions/0016-extensao-do-workspace-exige-consentimento.md)).

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// Variáveis que um processo filho recebe mesmo com o ambiente limpo.
///
/// Sem `PATH` um script `#!/usr/bin/env bash` não acha o próprio interpretador.
/// O resto é o mínimo que faz um comando de terminal se comportar como o
/// usuário espera: idioma, tipo de terminal e onde escrever temporário.
pub const PASSTHROUGH: &[&str] = &["PATH", "HOME", "LANG", "LC_ALL", "TERM", "TMPDIR"];

/// Nome do arquivo de configuração, dentro da raiz de configuração do usuário.
pub const FILE_NAME: &str = "environment.json";

/// O que o usuário acrescentou ao mínimo.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Allowlist {
    extra: Vec<String>,
}

/// Forma do arquivo em disco.
#[derive(Debug, serde::Deserialize)]
struct FileFormat {
    #[serde(default)]
    passthrough: Vec<String>,
}

impl Allowlist {
    /// Uma lista com nomes adicionais, descartando os que não são nomes.
    ///
    /// Um nome inválido é recusado em voz alta e não em silêncio: quem escreveu
    /// `GH TOKEN` no arquivo espera que ele passe, e descobrir isso pelo
    /// comando que falhou é descobrir a três camadas de distância da causa.
    #[must_use]
    pub fn with(names: impl IntoIterator<Item = String>) -> Self {
        let extra = names
            .into_iter()
            .filter(|name| {
                let valid = is_variable_name(name);
                if !valid {
                    tracing::warn!(name = %name, "nome de variavel invalido, ignorado");
                }
                valid
            })
            .collect();
        Self { extra }
    }

    /// Lê a lista do disco.
    ///
    /// Ausente ou ilegível é "só o mínimo", e não erro: a falta do arquivo é o
    /// estado inicial de toda máquina, e um arquivo corrompido não pode abrir o
    /// ambiente que ninguém pediu para abrir.
    #[must_use]
    pub fn load(path: &Path) -> Self {
        let Ok(raw) = std::fs::read_to_string(path) else {
            return Self::default();
        };
        match serde_json::from_str::<FileFormat>(&raw) {
            Ok(file) => Self::with(file.passthrough),
            Err(err) => {
                tracing::warn!(
                    path = %path.display(),
                    %err,
                    "configuracao de ambiente ilegivel; so o minimo sera repassado"
                );
                Self::default()
            }
        }
    }

    /// A lista desta máquina.
    #[must_use]
    pub fn discover() -> Self {
        store_path(
            std::env::var_os("XDG_CONFIG_HOME")
                .as_deref()
                .map(Path::new),
            std::env::var_os("HOME").as_deref().map(Path::new),
        )
        .map_or_else(Self::default, |path| Self::load(&path))
    }

    /// Os nomes que este filho recebe, na ordem em que são repassados.
    #[must_use]
    pub fn names(&self) -> Vec<&str> {
        PASSTHROUGH
            .iter()
            .copied()
            .chain(self.extra.iter().map(String::as_str))
            .collect()
    }

    /// O ambiente do filho, resolvido contra a leitura dada.
    ///
    /// A leitura é parâmetro porque `set_var` é `unsafe` na edition 2024: sem
    /// esta costura, provar que a credencial não passa exigiria plantá-la no
    /// processo de teste, que é justamente o que não se pode fazer.
    #[must_use]
    pub fn resolve<F>(&self, read: F) -> Vec<(String, OsString)>
    where
        F: Fn(&str) -> Option<OsString>,
    {
        self.names()
            .into_iter()
            .filter_map(|key| read(key).map(|value| (key.to_owned(), value)))
            .collect()
    }

    /// Limpa o ambiente do comando e repassa o que esta lista permite.
    pub fn apply(&self, command: &mut tokio::process::Command) {
        command.env_clear();
        for (key, value) in self.resolve(|key| std::env::var_os(key)) {
            command.env(key, value);
        }
    }
}

/// Limpa o ambiente do comando, preservando só o mínimo.
///
/// É o que um processo que executa código de terceiro recebe. A extensão do
/// usuário não se aplica aqui: ela existe porque o comando de shell é composto
/// para a tarefa do próprio usuário, e um hook ou um servidor MCP não é —
/// aquele vem do repositório, e este declara no `.mcp.json` o que precisa.
pub fn clear(command: &mut tokio::process::Command) {
    Allowlist::default().apply(command);
}

/// Onde a configuração vive.
#[must_use]
pub fn store_path(config_home: Option<&Path>, home: Option<&Path>) -> Option<PathBuf> {
    config_dir(config_home, home).map(|dir| dir.join(FILE_NAME))
}

/// A raiz da configuração do usuário nesta máquina.
///
/// O que o usuário decide sobre a política do agente vive aqui, e não no
/// workspace: dentro dele seria auto-certificante, porque a ferramenta `write`
/// concederia a si mesma o que o usuário não concedeu (ADR-0016). É por isso
/// que o registro de confiança usa a mesma raiz.
///
/// As duas variáveis são parâmetro e não leitura de ambiente porque `set_var` é
/// `unsafe` na edition 2024, e sem esta costura o caminho ficaria intestável.
#[must_use]
pub fn config_dir(config_home: Option<&Path>, home: Option<&Path>) -> Option<PathBuf> {
    let base = match config_home {
        Some(dir) if !dir.as_os_str().is_empty() => dir.to_path_buf(),
        _ => home.filter(|h| !h.as_os_str().is_empty())?.join(".config"),
    };
    Some(base.join("nycode"))
}

/// Se isto é um nome de variável de ambiente.
///
/// Um nome com `=` ou com byte nulo não é rejeitado pelo `Command`, é aceito e
/// vira algo que o filho não consegue ler — e um nome com `=` no meio permitiria
/// declarar um par que a lista não autorizou.
fn is_variable_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_alphabetic() || first == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    /// Um ambiente inventado, com a credencial dentro.
    fn ambiente(key: &str) -> Option<OsString> {
        match key {
            "PATH" => Some(OsString::from("/usr/bin")),
            "HOME" => Some(OsString::from("/home/alguem")),
            "NYCODE_API_KEY" => Some(OsString::from("sk-segredo")),
            "NYLLA_API_KEY" => Some(OsString::from("sk-outro")),
            "GH_TOKEN" => Some(OsString::from("ghp-segredo")),
            _ => None,
        }
    }

    fn resolvido(list: &Allowlist) -> Vec<String> {
        list.resolve(ambiente)
            .into_iter()
            .map(|(key, _)| key)
            .collect()
    }

    #[test]
    fn the_gateway_credential_never_reaches_a_child_by_default() {
        // O ponto inteiro do modulo. A chave esta no ambiente do pai e nao pode
        // aparecer no do filho sem alguem ter pedido.
        let nomes = resolvido(&Allowlist::default());

        assert!(!nomes.contains(&"NYCODE_API_KEY".to_owned()), "{nomes:?}");
        assert!(!nomes.contains(&"NYLLA_API_KEY".to_owned()), "{nomes:?}");
    }

    #[test]
    fn the_minimum_that_makes_a_command_run_is_forwarded() {
        // Sem `PATH` um script `#!/usr/bin/env bash` nao acha o interpretador,
        // e a protecao viraria uma quebra.
        let resolvidos = Allowlist::default().resolve(ambiente);

        assert_eq!(
            resolvidos,
            vec![
                ("PATH".to_owned(), OsString::from("/usr/bin")),
                ("HOME".to_owned(), OsString::from("/home/alguem")),
            ]
        );
    }

    #[test]
    fn what_the_user_declared_is_forwarded_too() {
        // A extensao existe porque um comando legitimo precisa de `GH_TOKEN` ou
        // `SSH_AUTH_SOCK`, e fechar sem saida faria o usuario exportar a
        // variavel dentro do proprio comando.
        let list = Allowlist::with(["GH_TOKEN".to_owned()]);
        assert!(resolvido(&list).contains(&"GH_TOKEN".to_owned()));
    }

    #[test]
    fn declaring_one_name_does_not_open_the_others() {
        // Uma extensao que virasse "passa tudo" seria a ausencia de lista com
        // outro nome.
        let list = Allowlist::with(["GH_TOKEN".to_owned()]);
        let nomes = resolvido(&list);

        assert!(!nomes.contains(&"NYCODE_API_KEY".to_owned()), "{nomes:?}");
    }

    #[test]
    fn a_name_that_is_not_a_name_is_refused() {
        // `=` no meio declararia um par que a lista nao autorizou.
        let list = Allowlist::with([
            "GH TOKEN".to_owned(),
            "A=B".to_owned(),
            "1COMECA_COM_DIGITO".to_owned(),
            String::new(),
            "VALIDO_1".to_owned(),
        ]);

        assert_eq!(list.names(), {
            let mut esperado = PASSTHROUGH.to_vec();
            esperado.push("VALIDO_1");
            esperado
        });
    }

    #[test]
    fn a_variable_absent_from_the_parent_is_not_invented() {
        // Repassar string vazia mudaria o comportamento de um `if [ -z "$VAR" ]`.
        let list = Allowlist::with(["NAO_EXISTE".to_owned()]);
        assert!(!resolvido(&list).contains(&"NAO_EXISTE".to_owned()));
    }

    #[test]
    fn a_missing_configuration_forwards_only_the_minimum() {
        let dir = tempfile::tempdir().unwrap();
        let list = Allowlist::load(&dir.path().join("nao-existe.json"));
        assert_eq!(list, Allowlist::default());
    }

    #[test]
    fn a_corrupt_configuration_forwards_only_the_minimum() {
        // Falhar aberto aqui abriria o ambiente a partir de um arquivo que
        // qualquer coisa pode ter corrompido.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        std::fs::write(&path, "{isto nao e json").unwrap();

        assert_eq!(Allowlist::load(&path), Allowlist::default());
    }

    #[test]
    fn a_declared_configuration_survives_a_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        std::fs::write(&path, r#"{"passthrough": ["GH_TOKEN", "SSH_AUTH_SOCK"]}"#).unwrap();

        let list = Allowlist::load(&path);
        assert_eq!(
            list,
            Allowlist::with(["GH_TOKEN".to_owned(), "SSH_AUTH_SOCK".to_owned()])
        );
    }

    #[test]
    fn a_configuration_without_the_field_is_the_minimum() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        std::fs::write(&path, "{}").unwrap();

        assert_eq!(Allowlist::load(&path), Allowlist::default());
    }

    #[test]
    fn the_configuration_lives_outside_the_workspace() {
        // Dentro dele seria auto-certificante: a ferramenta `write` abriria o
        // proprio ambiente.
        let path = store_path(None, Some(Path::new("/home/alguem"))).unwrap();
        assert_eq!(
            path,
            Path::new("/home/alguem/.config/nycode/environment.json")
        );
    }

    #[test]
    fn discovering_without_a_home_is_the_minimum_rather_than_a_failure() {
        assert!(store_path(None, None).is_none());
        assert!(config_dir(None, None).is_none());
        assert!(config_dir(Some(Path::new("")), Some(Path::new(""))).is_none());
    }

    #[test]
    fn the_xdg_variable_wins_over_the_home_default() {
        // As duas raizes de configuracao — esta e a do registro de confianca —
        // precisam concordar, senao uma decisao do usuario fica num lugar e a
        // outra noutro.
        assert_eq!(
            config_dir(Some(Path::new("/cfg")), Some(Path::new("/home/alguem"))),
            Some(PathBuf::from("/cfg/nycode"))
        );
        assert_eq!(
            config_dir(None, Some(Path::new("/home/alguem"))),
            Some(PathBuf::from("/home/alguem/.config/nycode"))
        );
    }
}
