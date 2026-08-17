//! A superfície de argumentos do binário.
//!
//! Separada do arranque porque muda por outra razão: uma flag nova é uma
//! decisão de interface com o usuário, e o que `main` faz com ela é uma decisão
//! de sequência.

use crate::output;
use clap::Parser;

/// As flags da linha de comando.
///
/// O `struct_excessive_bools` não se aplica a uma struct de `clap`: cada campo
/// é uma flag que o usuário digita, e agrupá-las num tipo só para reduzir a
/// contagem tornaria o derive pior e a ajuda ilegível. A regra existe para
/// estado de domínio, que é outra coisa.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Parser)]
#[command(
    name = "nycode",
    version,
    about = "Agente de codificacao em terminal, apontado para um nylla-gateway",
    disable_help_subcommand = true
)]
pub struct Cli {
    /// Executa um unico prompt e escreve a resposta em stdout.
    #[arg(short = 'p', long = "print", value_name = "PROMPT")]
    pub prompt: Option<String>,

    /// URL base do gateway, incluindo o prefixo de versao.
    ///
    /// Sem padrao do `clap` de proposito: `None` aqui significa "nem flag nem
    /// variavel de ambiente", e e o que deixa o arquivo de configuracao entrar
    /// antes do padrao embutido (FR-9). Com um `default_value`, `clap` sempre
    /// preencheria e nao haveria como distinguir o que o usuario pediu do que
    /// veio de fabrica.
    #[arg(long, env = "NYCODE_BASE_URL")]
    pub base_url: Option<String>,

    /// Chave de API do gateway. Prefira `--api-key-file`.
    ///
    /// Um argumento fica visivel no `ps` para qualquer processo da maquina, e no
    /// historico do shell depois disso.
    #[arg(long, hide_env_values = true, conflicts_with = "api_key_file")]
    pub api_key: Option<String>,

    /// Arquivo de onde ler a chave de API do gateway.
    ///
    /// Aceita `/dev/stdin` e substituicao de processo — `--api-key-file <(pass
    /// show gateway)` — porque o valor e so um caminho. Um arquivo comum que
    /// outras contas da maquina possam ler e recusado.
    #[arg(long, value_name = "CAMINHO")]
    pub api_key_file: Option<std::path::PathBuf>,

    /// Formato de wire: anthropic-messages, openai-completions ou openai-responses.
    #[arg(long, env = "NYCODE_DIALECT")]
    pub dialect: Option<String>,

    /// Modelo a usar.
    #[arg(long, env = "NYCODE_MODEL")]
    pub model: Option<String>,

    /// Teto de tokens de saida por turno.
    #[arg(long)]
    pub max_tokens: Option<u32>,

    /// Quanto o modelo raciocina: off, minimal, low, medium, high, xhigh, max.
    ///
    /// Cada dialeto traduz para o que o provedor dele pede (ADR-0025). Um nivel
    /// que o dialeto nao alcanca e rebaixado ao mais proximo, e o rebaixamento
    /// aparece em stderr — descartar em silencio e o que o NFR-4 proibe.
    #[arg(long, env = "NYCODE_THINKING", value_name = "NIVEL")]
    pub thinking: Option<String>,

    /// Diretorio de trabalho do agente.
    #[arg(long, value_name = "DIR")]
    pub cwd: Option<std::path::PathBuf>,

    /// Suprime o progresso de ferramentas em stderr.
    #[arg(short, long)]
    pub quiet: bool,

    /// Imagem a anexar ao pedido. Pode repetir.
    ///
    /// O arquivo é lido e embutido; o backend nunca busca nada por conta
    /// própria, o que mantém quem alcança a rede sob controle do operador.
    #[arg(short = 'i', long = "image", value_name = "ARQUIVO")]
    pub images: Vec<std::path::PathBuf>,

    /// Formato da resposta em modo headless.
    ///
    /// `json` publica um evento por linha em stdout — sequência de ferramentas,
    /// contabilidade de tokens e motivo de parada — para quem integra o
    /// binário em vez de ler a saída.
    #[arg(long, value_enum, default_value_t = output::Format::Text)]
    pub output_format: output::Format,

    /// Retoma a sessao mais recente deste workspace.
    ///
    /// O campo nao pode se chamar `continue`, que e palavra reservada, entao o
    /// nome longo e declarado explicitamente: derivar do campo produziria
    /// `--continue-session`, que nao e a interface documentada.
    #[arg(short = 'c', long = "continue")]
    pub continue_session: bool,

    /// Retoma uma sessao pelo identificador.
    #[arg(long, value_name = "ID")]
    pub resume: Option<String>,

    /// Permite que o agente escreva, edite e execute comandos.
    ///
    /// Sem esta flag a sessao e somente-leitura. Em modo headless nao ha a quem
    /// perguntar, entao a permissao precisa ser dada de antemao.
    #[arg(long)]
    pub allow_writes: bool,

    /// Concede tudo, inclusive shell e ferramenta de servidor de terceiro.
    ///
    /// `--allow-writes` concede escrita de arquivo e so ela. Esta e a decisao
    /// separada porque um shell alcanca tudo que as outras alcancam e mais.
    #[arg(long)]
    pub allow_all: bool,

    /// Restringe o catalogo enviado ao modelo. Nomes separados por virgula.
    #[arg(long, value_name = "NOMES", value_delimiter = ',', num_args = 1)]
    pub tools: Vec<String>,

    /// Nao oferece ferramenta nenhuma ao modelo.
    #[arg(long, conflicts_with = "tools")]
    pub no_tools: bool,

    /// Substitui o prompt de sistema embutido. Instrucoes e skills continuam.
    #[arg(long, value_name = "TEXTO")]
    pub system: Option<String>,

    /// Acrescenta ao prompt de sistema, depois da base e antes das instrucoes.
    #[arg(long, value_name = "TEXTO")]
    pub append_system: Option<String>,

    /// Monta a sessao, mantem-na ociosa por MS milissegundos e sai.
    ///
    /// O NFR-1 e o NFR-2 orcam a sessao montada, e nenhuma outra superficie
    /// para nesse ponto: o modo headless segue para o turno e o interativo toma
    /// posse do terminal. Sem esta rota o gate so alcanca `--version`, que o
    /// `clap` resolve antes do runtime, da credencial e do disco.
    ///
    /// A ociosidade e parametro porque as duas medicoes querem coisas opostas:
    /// a latencia quer sair assim que a sessao fica pronta, e o pico de memoria
    /// quer esperar o runtime e as conexoes MCP assentarem.
    #[arg(long, value_name = "MS", num_args = 0..=1, default_missing_value = "0")]
    pub probe_startup: Option<u64>,
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn cli_definition_is_valid() {
        Cli::command().debug_assert();
    }

    #[test]
    fn the_probe_flag_defaults_to_no_idle_and_still_accepts_one() {
        // `--probe-startup` sozinho e a medicao de latencia, a mais frequente.
        // Exigir valor dela transformaria o caso comum no mais verboso.
        let bare = Cli::try_parse_from(["nycode", "--probe-startup"]).unwrap();
        assert_eq!(bare.probe_startup, Some(0));

        let held = Cli::try_parse_from(["nycode", "--probe-startup", "250"]).unwrap();
        assert_eq!(held.probe_startup, Some(250));

        let absent = Cli::try_parse_from(["nycode"]).unwrap();
        assert_eq!(absent.probe_startup, None);
    }

    #[test]
    fn defaults_point_at_the_gateway_without_any_flags() {
        // O ponto do nycode e abrir sessao sem configurar endpoint nem catalogo.
        // Desde o FR-9 o padrao nao mora no `clap`: a ausencia aqui e o que
        // deixa o arquivo de configuracao ser consultado antes dele, e quem
        // decide e `session::provider::settings::resolve`.
        let cli = Cli::try_parse_from(["nycode", "-p", "oi"]).unwrap();
        assert_eq!(cli.base_url, None);
        assert_eq!(cli.model, None);
        let decided = crate::session::provider::settings::resolve(
            &cli,
            &crate::session::provider::settings::Provider::default(),
        );
        assert_eq!(decided.base_url, nycode_ai::Config::DEFAULT_BASE_URL);
        assert_eq!(decided.model, nycode_ai::Config::DEFAULT_MODEL);
        assert_eq!(cli.prompt.as_deref(), Some("oi"));
        assert!(!cli.quiet);
    }

    #[test]
    fn flags_override_the_defaults() {
        let cli = Cli::try_parse_from([
            "nycode",
            "--base-url",
            "https://gw.example.com/v1",
            "--model",
            "nylla-grok-4.5",
            "--max-tokens",
            "512",
            "--quiet",
            "-p",
            "faca",
        ])
        .unwrap();
        assert_eq!(cli.base_url.as_deref(), Some("https://gw.example.com/v1"));
        assert_eq!(cli.model.as_deref(), Some("nylla-grok-4.5"));
        assert_eq!(cli.max_tokens, Some(512));
        assert!(cli.quiet);
    }

    #[test]
    fn the_credential_cannot_be_given_both_as_an_argument_and_as_a_file() {
        // Aceitar as duas obrigaria a inventar uma precedencia que o usuario nao
        // tem como adivinhar, e o caso provavel e ele achar que trocou de fonte.
        let err = Cli::try_parse_from([
            "nycode",
            "--api-key",
            "no-argv",
            "--api-key-file",
            "/tmp/chave",
        ])
        .expect_err("as duas fontes se excluem");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    #[test]
    fn the_credential_file_is_taken_as_a_path_so_dev_stdin_works() {
        // Tratar o valor como caminho e o que faz `/dev/stdin` e a substituicao
        // de processo funcionarem sem caso especial no codigo.
        let cli = Cli::try_parse_from(["nycode", "--api-key-file", "/dev/stdin"]).unwrap();
        assert_eq!(
            cli.api_key_file.as_deref(),
            Some(std::path::Path::new("/dev/stdin"))
        );
        assert!(cli.api_key.is_none());
    }

    #[test]
    fn tools_flags_restrict_the_catalog_and_exclude_each_other() {
        let listed = Cli::try_parse_from(["nycode", "--tools", "read,grep,find"]).unwrap();
        assert_eq!(listed.tools, vec!["read", "grep", "find"]);
        assert!(!listed.no_tools);
        let none = Cli::try_parse_from(["nycode", "--no-tools"]).unwrap();
        assert!(none.no_tools);
        assert!(none.tools.is_empty());
        let err = Cli::try_parse_from(["nycode", "--tools", "read", "--no-tools"])
            .expect_err("as duas flags se excluem");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    #[test]
    fn system_flags_replace_or_append_the_base_prompt() {
        let replaced = Cli::try_parse_from(["nycode", "--system", "base"]).unwrap();
        assert_eq!(replaced.system.as_deref(), Some("base"));
        assert!(replaced.append_system.is_none());
        let appended = Cli::try_parse_from(["nycode", "--append-system", "extra"]).unwrap();
        assert_eq!(appended.append_system.as_deref(), Some("extra"));
    }
}
