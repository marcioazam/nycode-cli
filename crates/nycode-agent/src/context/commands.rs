//! Slash commands como templates de markdown (FR-13).
//!
//! O formato é o que Claude Code e outros já usam: um arquivo `nome.md` vira
//! `/nome`. Um pedido repetido — revisar um diff, escrever um commit, rodar a
//! bateria de verificação — deixa de ser algo que o usuário redigita e vira
//! algo que o repositório versiona.
//!
//! O template é expandido no cliente e o resultado vira um prompt comum. O
//! modelo não sabe que existiu um comando, o que mantém o vocabulário de wire
//! intacto: um slash command é conveniência de entrada, não um conceito novo.

use std::path::{Path, PathBuf};

/// Marcador substituído por tudo que veio depois do nome.
const ALL_ARGUMENTS: &str = "$ARGUMENTS";

/// Diretórios varridos, em ordem de precedência crescente.
const COMMAND_DIRS: &[&str] = &[".claude/commands", ".nycode/commands"];

/// Um comando descoberto no disco.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Command {
    /// Nome sem a barra.
    pub name: String,
    /// Uma linha sobre o que ele faz, para a listagem.
    pub description: String,
    /// Corpo com os marcadores por expandir.
    pub template: String,
    pub path: PathBuf,
}

impl Command {
    /// Expande o template com os argumentos recebidos.
    ///
    /// `$ARGUMENTS` recebe tudo; `$1`, `$2` recebem posicionais. Um posicional
    /// que não veio expande para vazio em vez de deixar o literal `$2` no
    /// prompt, que o modelo leria como texto.
    #[must_use]
    pub fn expand(&self, arguments: &str) -> String {
        let mut out = self.template.replace(ALL_ARGUMENTS, arguments.trim());

        let positional: Vec<&str> = arguments.split_whitespace().collect();
        // De trás para frente: substituir `$1` antes de `$10` truncaria o
        // segundo. Com dez posicionais isto já importa.
        for index in (1..=9).rev() {
            let marker = format!("${index}");
            let value = positional.get(index - 1).copied().unwrap_or("");
            out = out.replace(&marker, value);
        }
        out.trim().to_owned()
    }
}

/// Descobre comandos a partir da raiz do workspace.
#[must_use]
pub fn discover(root: &Path) -> Vec<Command> {
    let mut found: Vec<Command> = Vec::new();

    for relative in COMMAND_DIRS {
        let Ok(entries) = std::fs::read_dir(root.join(relative)) else {
            continue;
        };
        for entry in entries.filter_map(std::result::Result::ok) {
            let path = entry.path();
            if path.extension().and_then(std::ffi::OsStr::to_str) != Some("md") {
                continue;
            }
            let Some(command) = load(root, &path) else {
                continue;
            };
            // Precedência crescente: o escopo do projeto substitui o anterior.
            found.retain(|existing| existing.name != command.name);
            found.push(command);
        }
    }

    found.sort_by(|a, b| a.name.cmp(&b.name));
    found
}

/// Lê um comando de um arquivo markdown.
#[must_use]
pub fn load(root: &Path, path: &Path) -> Option<Command> {
    if !crate::tool::stays_within(root, path) {
        tracing::warn!(
            path = %path.display(),
            "comando aponta para fora do workspace, ignorado"
        );
        return None;
    }
    let name = path.file_stem()?.to_str()?.to_owned();
    if name.is_empty() {
        return None;
    }
    let contents = std::fs::read_to_string(path).ok()?;

    let (description, template) = split(&contents);
    if template.trim().is_empty() {
        // Um template vazio produziria um prompt vazio, que gasta um turno sem
        // pedir nada.
        return None;
    }

    Some(Command {
        name,
        description,
        template: template.trim().to_owned(),
        path: path.to_path_buf(),
    })
}

/// Separa a descrição do frontmatter, quando houver, do corpo.
fn split(contents: &str) -> (String, &str) {
    let Some(rest) = contents
        .strip_prefix("---\n")
        .or_else(|| contents.strip_prefix("---\r\n"))
    else {
        return (first_line(contents), contents);
    };
    let Some(end) = rest.find("\n---") else {
        return (first_line(contents), contents);
    };

    let (frontmatter, body) = (&rest[..end], &rest[end..]);
    let body = body
        .trim_start_matches('\n')
        .trim_start_matches("---")
        .trim_start_matches(['\r', '\n']);

    let description = frontmatter
        .lines()
        .find_map(|line| line.trim().strip_prefix("description:"))
        .map_or_else(
            || first_line(body),
            |value| value.trim().trim_matches(['"', '\'']).to_owned(),
        );

    (description, body)
}

/// Resumo de uma linha, para a listagem.
fn first_line(body: &str) -> String {
    body.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("")
        .trim_start_matches('#')
        .trim()
        .chars()
        .take(80)
        .collect()
}

/// O que uma linha de entrada iniciada por barra significa.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invocation {
    /// Não é um comando; é um pedido comum.
    NotACommand,
    /// Comando conhecido, já expandido.
    Expanded(String),
    /// Comando desconhecido, com a lista do que existe.
    Unknown {
        name: String,
        available: Vec<String>,
    },
}

/// Resolve uma linha de entrada contra os comandos disponíveis.
#[must_use]
pub fn resolve(line: &str, commands: &[Command]) -> Invocation {
    let trimmed = line.trim_start();
    let Some(rest) = trimmed.strip_prefix('/') else {
        return Invocation::NotACommand;
    };
    // Uma barra sozinha, ou um caminho como `/usr/bin`, não é invocação: o
    // usuário quis escrever isso.
    let (name, arguments) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
    if name.is_empty() || name.contains('/') {
        return Invocation::NotACommand;
    }

    match commands.iter().find(|command| command.name == name) {
        Some(command) => Invocation::Expanded(command.expand(arguments)),
        None => Invocation::Unknown {
            name: name.to_owned(),
            available: commands.iter().map(|c| c.name.clone()).collect(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, relative: &str, contents: &str) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    fn command(template: &str) -> Command {
        Command {
            name: "revisar".to_owned(),
            description: "revisa".to_owned(),
            template: template.to_owned(),
            path: PathBuf::from("/x/revisar.md"),
        }
    }

    #[test]
    fn a_markdown_file_becomes_a_command_named_after_it() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            ".nycode/commands/revisar.md",
            "Revise o diff atual e aponte problemas.\n",
        );

        let found = discover(dir.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "revisar");
        assert!(found[0].template.contains("Revise o diff"));
    }

    #[test]
    fn the_description_comes_from_frontmatter_when_it_is_there() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            ".nycode/commands/commit.md",
            "---\ndescription: escreve a mensagem de commit\n---\nOlhe o diff e escreva.\n",
        );

        let found = discover(dir.path());
        assert_eq!(found[0].description, "escreve a mensagem de commit");
        assert_eq!(found[0].template, "Olhe o diff e escreva.");
    }

    #[test]
    fn without_frontmatter_the_first_line_serves_as_the_description() {
        // A listagem precisa dizer alguma coisa; exigir frontmatter faria o
        // caso simples custar mais que vale.
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            ".nycode/commands/testes.md",
            "# Roda a bateria\n\nRode `cargo test`.\n",
        );

        assert_eq!(discover(dir.path())[0].description, "Roda a bateria");
    }

    #[test]
    fn the_project_scope_overrides_the_broader_one() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), ".claude/commands/x.md", "versao antiga");
        write(dir.path(), ".nycode/commands/x.md", "versao do projeto");

        let found = discover(dir.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].template, "versao do projeto");
    }

    #[test]
    #[cfg(unix)]
    fn a_command_template_that_leaves_the_root_is_not_loaded() {
        // Um comando so entra em contexto quando o usuario o invoca, entao a
        // exposicao e menor que a da instrucao — mas o arquivo e lido do mesmo
        // jeito, e a regra precisa valer nos tres.
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("roubado.md"), "Revise o diff.").unwrap();
        std::fs::create_dir_all(dir.path().join(".nycode/commands")).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("roubado.md"),
            dir.path().join(".nycode/commands/x.md"),
        )
        .unwrap();

        assert!(discover(dir.path()).is_empty());
    }

    #[test]
    fn a_file_that_is_not_markdown_is_not_a_command() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), ".nycode/commands/notas.txt", "nao e comando");
        assert!(discover(dir.path()).is_empty());
    }

    #[test]
    fn an_empty_template_is_not_offered() {
        // Expandiria para um prompt vazio, que gasta um turno sem pedir nada.
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), ".nycode/commands/vazio.md", "   \n\n");
        assert!(discover(dir.path()).is_empty());
    }

    #[test]
    fn a_workspace_without_commands_declares_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(discover(dir.path()).is_empty());
    }

    #[test]
    fn the_listing_is_in_a_stable_order() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), ".nycode/commands/zeta.md", "z");
        write(dir.path(), ".nycode/commands/alfa.md", "a");

        let names: Vec<_> = discover(dir.path()).into_iter().map(|c| c.name).collect();
        assert_eq!(names, vec!["alfa", "zeta"]);
    }

    #[test]
    fn all_arguments_land_where_the_template_asks() {
        let expanded = command("Revise: $ARGUMENTS").expand("  o modulo de auth  ");
        assert_eq!(expanded, "Revise: o modulo de auth");
    }

    #[test]
    fn positional_arguments_are_addressable() {
        let expanded = command("De $1 para $2").expand("aqui ali");
        assert_eq!(expanded, "De aqui para ali");
    }

    #[test]
    fn a_positional_that_did_not_come_expands_to_nothing() {
        // Deixar o literal `$2` no prompt faria o modelo le-lo como texto.
        let expanded = command("um: $1 dois: $2").expand("so-um");
        assert_eq!(expanded, "um: so-um dois:");
    }

    #[test]
    fn the_tenth_positional_is_not_truncated_by_the_first() {
        // Substituir `$1` antes de `$10` deixaria `<valor de 1>0` no prompt.
        let expanded = command("$10").expand("a b c d e f g h i j");
        assert_eq!(expanded, "a0", "so ha nove posicionais; o resto e literal");
    }

    #[test]
    fn a_template_without_markers_ignores_the_arguments() {
        let expanded = command("Rode a bateria de verificacao").expand("ignorado");
        assert_eq!(expanded, "Rode a bateria de verificacao");
    }

    #[test]
    fn a_line_with_a_known_command_is_expanded() {
        let commands = vec![command("Revise: $ARGUMENTS")];
        assert_eq!(
            resolve("/revisar o diff", &commands),
            Invocation::Expanded("Revise: o diff".to_owned())
        );
    }

    #[test]
    fn an_unknown_command_lists_the_ones_that_exist() {
        // Tratar como prompt comum mandaria `/revisr` ao modelo e gastaria um
        // turno para descobrir o erro de digitacao.
        let commands = vec![command("x")];
        match resolve("/revisr", &commands) {
            Invocation::Unknown { name, available } => {
                assert_eq!(name, "revisr");
                assert_eq!(available, vec!["revisar".to_owned()]);
            }
            other => panic!("esperava desconhecido, veio {other:?}"),
        }
    }

    #[test]
    fn ordinary_text_is_not_an_invocation() {
        let commands = vec![command("x")];
        assert_eq!(
            resolve("explique este repositorio", &commands),
            Invocation::NotACommand
        );
    }

    #[test]
    fn a_path_is_not_an_invocation() {
        // `/usr/bin/env` num pedido e caminho, nao comando.
        let commands = vec![command("x")];
        assert_eq!(
            resolve("/usr/bin/env esta no PATH?", &commands),
            Invocation::NotACommand
        );
        assert_eq!(resolve("/", &commands), Invocation::NotACommand);
    }

    #[test]
    fn leading_whitespace_does_not_hide_a_command() {
        let commands = vec![command("feito")];
        assert_eq!(
            resolve("   /revisar", &commands),
            Invocation::Expanded("feito".to_owned())
        );
    }
}
