//! O que o usuário decide sobre o comportamento do agente.
//!
//! Os números que governam compactação, prazo de comando e teto de turnos eram
//! constantes no binário. Isso serve enquanto o padrão serve, e deixa de servir
//! na primeira sessão em que não serve: um repositório com arquivos grandes
//! precisa de mais janela reservada, uma suíte lenta precisa de mais prazo, e
//! quem descobre isso não tem o que fazer além de recompilar.
//!
//! O arquivo é do **usuário**, em `~/.config/nycode/settings.json`, e não do
//! workspace. A razão é a mesma que mantém o registro de confiança fora da
//! raiz: um `.nycode/settings.json` do repositório seria auto-certificante — a
//! ferramenta `write`, sob permissão ampla, esticaria o próprio prazo e o
//! próprio teto de turnos, que são justamente os limites que existem para
//! contê-la.
//!
//! Ausente ou ilegível são os padrões, nunca erro: a falta do arquivo é o
//! estado inicial de toda máquina, e um arquivo corrompido não pode virar um
//! limite que ninguém escolheu.

use std::path::{Path, PathBuf};
use std::time::Duration;

/// Nome do arquivo, dentro da raiz de configuração do usuário.
pub const FILE_NAME: &str = "settings.json";

/// O diálogo de fábrica, quando nem a invocação nem o arquivo escolhem.
pub const DEFAULT_DIALECT: &str = "anthropic-messages";

/// O que o usuário ajustou.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    /// Quantos turnos recentes a compactação preserva intactos.
    pub keep_recent: usize,
    /// Teto de idas e voltas de ferramenta num único pedido.
    pub tool_limit: usize,
    /// Prazo de um comando de shell.
    pub command_timeout: Duration,
    /// Para onde a sessão fala (FR-9).
    pub provider: Provider,
}

/// O endpoint que a sessão usa, quando não é o do gateway.
///
/// É o FR-9: um provider alternativo declarado por arquivo, incluindo endpoint
/// OpenAI-compatível arbitrário. Existia só por flag e variável de ambiente, o
/// que serve para uma execução e não para uma máquina — quem aponta o `nycode`
/// para outro gateway o aponta sempre, e repetir três flags a cada invocação é
/// a forma de errar uma delas.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Provider {
    pub base_url: Option<String>,
    pub dialect: Option<String>,
    pub model: Option<String>,
    pub max_tokens: Option<u32>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            keep_recent: nycode_agent::session::compaction::DEFAULT_KEEP_RECENT,
            tool_limit: nycode_agent::agent::DEFAULT_TOOL_LIMIT,
            command_timeout: nycode_agent::tools::DEFAULT_COMMAND_TIMEOUT,
            provider: Provider::default(),
        }
    }
}

/// Forma do arquivo em disco.
///
/// Todo campo é opcional e ausente significa "o padrão": um arquivo que ajusta
/// uma coisa não deveria precisar repetir as outras, e exigir isso faria cada
/// mudança de padrão do binário parar de alcançar quem já tinha configurado.
#[derive(Debug, Default, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct FileFormat {
    #[serde(default)]
    keep_recent: Option<usize>,
    #[serde(default)]
    tool_limit: Option<usize>,
    #[serde(default)]
    command_timeout_secs: Option<u64>,
    #[serde(default)]
    provider: Option<ProviderFile>,
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ProviderFile {
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    dialect: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    max_tokens: Option<u32>,
}

impl Settings {
    /// Lê os ajustes do disco.
    #[must_use]
    pub fn load(path: &Path) -> Self {
        let Ok(raw) = std::fs::read_to_string(path) else {
            return Self::default();
        };
        match serde_json::from_str::<FileFormat>(&raw) {
            Ok(file) => Self::default().merged(&file),
            Err(err) => {
                // Um campo que não existe é erro de digitação, e aceitá-lo em
                // silêncio deixaria o usuário achando que ajustou algo.
                tracing::warn!(
                    path = %path.display(),
                    %err,
                    "configuracao ilegivel; os padroes seguem valendo"
                );
                Self::default()
            }
        }
    }

    /// Os ajustes desta máquina.
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

    /// Aplica o que o arquivo declarou, recusando o que não faz sentido.
    ///
    /// Zero em qualquer um dos três seria uma sessão que não faz nada: sem
    /// turno de ferramenta, sem prazo, ou compactando o histórico inteiro a
    /// cada estouro. Recusar é melhor que obedecer a um valor que trava a
    /// ferramenta e deixa o usuário procurando o defeito noutro lugar.
    fn merged(mut self, file: &FileFormat) -> Self {
        if let Some(value) = file.keep_recent.filter(|v| *v > 0) {
            self.keep_recent = value;
        }
        if let Some(value) = file.tool_limit.filter(|v| *v > 0) {
            self.tool_limit = value;
        }
        if let Some(secs) = file.command_timeout_secs.filter(|v| *v > 0) {
            self.command_timeout = Duration::from_secs(secs);
        }
        if let Some(provider) = file.provider.as_ref() {
            // Um endpoint vazio não é "o padrão", é um endereço que falha na
            // conexão depois de a sessão já ter montado. Vale para os três
            // campos de texto.
            self.provider = Provider {
                base_url: trimmed(provider.base_url.as_deref()),
                dialect: trimmed(provider.dialect.as_deref()),
                model: trimmed(provider.model.as_deref()),
                max_tokens: provider.max_tokens.filter(|v| *v > 0),
            };
        }
        self
    }
}

/// O provider que a sessão vai usar, já decidido.
///
/// Diferente de [`Provider`], aqui não sobra opção: é o que a invocação resolveu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub base_url: String,
    pub dialect: String,
    pub model: String,
    pub max_tokens: u32,
}

/// Decide o provider entre a invocação, o arquivo e o padrão embutido.
///
/// A ordem é flag ou variável de ambiente, depois arquivo, depois o padrão. O
/// arquivo perde da flag porque a flag é a exceção declarada na hora — quem
/// configurou outro gateway na máquina ainda precisa conseguir apontar para o
/// de fábrica numa execução sem editar o arquivo e lembrar de desfazer.
///
/// A escolha é por campo e não pelo bloco inteiro: um arquivo que só troca o
/// `base_url` continua no diálogo e no modelo padrão, e `--model` sozinho não
/// arrasta o endpoint de volta para o gateway.
#[must_use]
pub fn resolve(cli: &crate::invocation::Cli, file: &Provider) -> Resolved {
    Resolved {
        base_url: pick(
            cli.base_url.as_deref(),
            file.base_url.as_deref(),
            nycode_ai::Config::DEFAULT_BASE_URL,
        ),
        dialect: pick(
            cli.dialect.as_deref(),
            file.dialect.as_deref(),
            DEFAULT_DIALECT,
        ),
        model: pick(
            cli.model.as_deref(),
            file.model.as_deref(),
            nycode_ai::Config::DEFAULT_MODEL,
        ),
        max_tokens: cli
            .max_tokens
            .or(file.max_tokens)
            .unwrap_or(nycode_ai::Config::DEFAULT_MAX_TOKENS),
    }
}

fn pick(flag: Option<&str>, file: Option<&str>, fallback: &str) -> String {
    flag.or(file).unwrap_or(fallback).to_owned()
}

fn trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
}

/// Onde o arquivo vive.
#[must_use]
pub fn store_path(config_home: Option<&Path>, home: Option<&Path>) -> Option<PathBuf> {
    nycode_agent::policy::config_dir(config_home, home).map(|dir| dir.join(FILE_NAME))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    fn written(body: &str) -> (tempfile::TempDir, Settings) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        std::fs::write(&path, body).unwrap();
        let settings = Settings::load(&path);
        (dir, settings)
    }

    /// Uma invocação sem nenhuma flag de provider.
    fn bare() -> crate::invocation::Cli {
        <crate::invocation::Cli as clap::Parser>::parse_from(["nycode"])
    }

    #[test]
    fn a_provider_declared_in_the_file_is_used_when_no_flag_asks_otherwise() {
        // O FR-9 e este teste: sem ele, "configuravel por arquivo" e so texto.
        let (_dir, settings) = written(
            r#"{"provider":{"base_url":"https://interno/v1","dialect":"openai-completions","model":"local-m","max_tokens":2048}}"#,
        );
        let decided = resolve(&bare(), &settings.provider);
        assert_eq!(decided.base_url, "https://interno/v1");
        assert_eq!(decided.dialect, "openai-completions");
        assert_eq!(decided.model, "local-m");
        assert_eq!(decided.max_tokens, 2048);
    }

    #[test]
    fn a_flag_beats_the_file_so_one_run_can_escape_the_machine_wide_choice() {
        let (_dir, settings) = written(r#"{"provider":{"base_url":"https://interno/v1"}}"#);
        let mut cli = bare();
        cli.base_url = Some("https://de-hoje/v1".into());
        assert_eq!(
            resolve(&cli, &settings.provider).base_url,
            "https://de-hoje/v1"
        );
    }

    #[test]
    fn a_file_that_sets_only_the_endpoint_keeps_the_default_dialect_and_model() {
        // A escolha e por campo: trocar de gateway nao e trocar de modelo.
        let (_dir, settings) = written(r#"{"provider":{"base_url":"https://interno/v1"}}"#);
        let decided = resolve(&bare(), &settings.provider);
        assert_eq!(decided.base_url, "https://interno/v1");
        assert_eq!(decided.dialect, DEFAULT_DIALECT);
        assert_eq!(decided.model, nycode_ai::Config::DEFAULT_MODEL);
        assert_eq!(decided.max_tokens, nycode_ai::Config::DEFAULT_MAX_TOKENS);
    }

    #[test]
    fn an_absent_provider_block_is_the_built_in_gateway() {
        let (_dir, settings) = written(r#"{"tool_limit":9}"#);
        let decided = resolve(&bare(), &settings.provider);
        assert_eq!(decided.base_url, nycode_ai::Config::DEFAULT_BASE_URL);
        assert_eq!(decided.dialect, DEFAULT_DIALECT);
    }

    #[test]
    fn a_blank_endpoint_is_refused_instead_of_failing_at_connection_time() {
        // Um endereco vazio nao e "o padrao": e uma sessao que monta e so falha
        // na primeira ida ao modelo, longe da causa.
        let (_dir, settings) = written(r#"{"provider":{"base_url":"   ","model":""}}"#);
        assert_eq!(settings.provider.base_url, None);
        assert_eq!(settings.provider.model, None);
        let decided = resolve(&bare(), &settings.provider);
        assert_eq!(decided.base_url, nycode_ai::Config::DEFAULT_BASE_URL);
    }

    #[test]
    fn a_zero_token_ceiling_from_the_file_is_refused() {
        let (_dir, settings) = written(r#"{"provider":{"max_tokens":0}}"#);
        assert_eq!(settings.provider.max_tokens, None);
        assert_eq!(
            resolve(&bare(), &settings.provider).max_tokens,
            nycode_ai::Config::DEFAULT_MAX_TOKENS
        );
    }

    #[test]
    fn an_unknown_provider_field_is_refused_rather_than_silently_ignored() {
        // Um campo com erro de digitacao aceito em silencio deixa o usuario
        // achando que apontou o binario para outro lugar.
        let (_dir, settings) = written(r#"{"provider":{"baseurl":"https://interno/v1"}}"#);
        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn a_missing_file_is_the_defaults_and_not_a_failure() {
        // A falta do arquivo e o estado inicial de toda maquina.
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            Settings::load(&dir.path().join("nao-existe.json")),
            Settings::default()
        );
    }

    #[test]
    fn a_corrupt_file_is_the_defaults_and_not_a_limit_nobody_chose() {
        let (_dir, settings) = written("{isto nao e json");
        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn what_the_user_declared_replaces_only_what_it_names() {
        // Exigir o arquivo inteiro faria cada mudanca de padrao do binario
        // parar de alcancar quem ja tinha configurado uma coisa so.
        let (_dir, settings) = written(r#"{"keep_recent": 12}"#);

        assert_eq!(settings.keep_recent, 12);
        assert_eq!(settings.tool_limit, Settings::default().tool_limit);
        assert_eq!(
            settings.command_timeout,
            Settings::default().command_timeout
        );
    }

    #[test]
    fn every_field_can_be_set() {
        let (_dir, settings) =
            written(r#"{"keep_recent": 3, "tool_limit": 80, "command_timeout_secs": 300}"#);

        assert_eq!(settings.keep_recent, 3);
        assert_eq!(settings.tool_limit, 80);
        assert_eq!(settings.command_timeout, Duration::from_mins(5));
    }

    #[test]
    fn a_zero_is_refused_instead_of_obeyed() {
        // Zero em qualquer um seria uma sessao que nao faz nada, e o usuario
        // procuraria o defeito noutro lugar.
        let (_dir, settings) =
            written(r#"{"keep_recent": 0, "tool_limit": 0, "command_timeout_secs": 0}"#);
        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn a_field_that_does_not_exist_is_reported_instead_of_ignored() {
        // Aceitar em silencio deixaria o usuario achando que ajustou algo.
        let (_dir, settings) = written(r#"{"keep_recentt": 12}"#);
        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn the_file_lives_outside_the_workspace() {
        // Dentro dele seria auto-certificante: a ferramenta `write` esticaria o
        // proprio prazo e o proprio teto de turnos.
        let path = store_path(None, Some(Path::new("/home/alguem"))).unwrap();
        assert_eq!(path, Path::new("/home/alguem/.config/nycode/settings.json"));
    }

    #[test]
    fn without_anywhere_to_look_the_defaults_hold() {
        assert!(store_path(None, None).is_none());
    }
}
