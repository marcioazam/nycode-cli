//! Varredura de arquivos do workspace.
//!
//! As três ferramentas de leitura — buscar conteúdo, buscar nome, listar — só
//! diferem no que fazem com cada entrada, e as regras que compartilham são as
//! que importam: não sair da raiz, não seguir link simbólico, e não despejar no
//! contexto do modelo o que ele nunca quer ver.
//!
//! O que ele nunca quer ver era uma lista fixa — `target`, `node_modules`,
//! `.venv` — e uma lista fixa erra dos dois lados. Ela não conhece o `build/`
//! que este projeto gera nem o diretório de saída que aquele configurou, e
//! esconde um `dist/` que alguém versionou de propósito. O repositório já
//! declara o que é derivado, no `.gitignore`, e agora é ele que decide.
//!
//! A varredura é preguiçosa e em ordem determinística. Preguiçosa porque quem
//! busca para de olhar ao atingir o teto de resultados, e listar o repositório
//! inteiro antes de examinar o primeiro casamento é trabalho que se joga fora.
//! Determinística porque dois repositórios idênticos precisam produzir a mesma
//! resposta — uma ordem que muda entre execuções invalida o cache de prompt do
//! backend sem nenhum ganho (NFR-7).

use std::path::{Path, PathBuf};

/// Teto de arquivos visitados numa varredura.
///
/// Um repositório grande com um padrão que casa com tudo produziria uma
/// resposta que não cabe na janela e uma espera que parece travamento.
pub const MAX_VISITED: usize = 20_000;

/// Um arquivo encontrado na varredura.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub path: PathBuf,
    /// Caminho relativo à raiz da varredura, para exibição.
    pub relative: String,
}

/// Percorre `root`, devolvendo os arquivos preguiçosamente.
pub fn files(root: &Path) -> impl Iterator<Item = Found> + use<> {
    files_within(root, MAX_VISITED)
}

/// O mesmo que [`files`], com o teto parametrizado.
///
/// O teto é parâmetro para que o teste que prova que ele segura possa usar dez
/// arquivos em vez de vinte mil.
fn files_within(root: &Path, cap: usize) -> impl Iterator<Item = Found> + use<> {
    let base = root.to_path_buf();
    walker(root)
        .build()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_some_and(|kind| kind.is_file()))
        .filter_map(move |entry| {
            let relative = entry
                .path()
                .strip_prefix(&base)
                .ok()?
                .to_string_lossy()
                .replace('\\', "/");
            Some(Found {
                path: entry.into_path(),
                relative,
            })
        })
        .take(cap)
}

/// A varredura configurada, antes de virar iterador.
///
/// Separada porque `ls` precisa da mesma política com profundidade de um.
pub fn walker(root: &Path) -> ignore::WalkBuilder {
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        // Arquivo oculto é conteúdo: `AGENTS.md` mora ao lado de `.claude/`, e
        // esconder o que começa com ponto deixaria o agente cego para a
        // configuração do próprio repositório.
        .hidden(false)
        .git_ignore(true)
        .git_exclude(true)
        // O `.gitignore` global é do usuário, não do repositório: respeitá-lo
        // faria a mesma pergunta ter respostas diferentes em duas máquinas.
        .git_global(false)
        // Sem isto a varredura lê `.gitignore` de diretórios acima da raiz, que
        // é justamente o que a contenção existe para não fazer.
        .parents(false)
        // Um workspace que não é repositório git ainda declara o que é derivado
        // no `.gitignore`; exigir o `.git` faria a declaração ser ignorada.
        .require_git(false)
        // Um link para fora da raiz é a fuga que a contenção de caminho barra;
        // segui-lo aqui a contornaria sem passar por ferramenta nenhuma.
        .follow_links(false)
        .sort_by_file_path(Path::cmp)
        // O `.git` não é derivado e não está no `.gitignore`, mas despejá-lo é
        // gastar a janela com o que o modelo nunca quer ler.
        .filter_entry(|entry| entry.file_name() != ".git");
    builder
}

/// Compila um filtro de nome de arquivo.
///
/// O erro é a mensagem que vai ao modelo: um glob inválido precisa dizer o que
/// está errado, senão ele tenta o mesmo padrão de novo.
pub fn glob(pattern: &str) -> Result<globset::GlobMatcher, String> {
    globset::GlobBuilder::new(pattern)
        // `*` não atravessa separador e `**` sim, que é o que um modelo espera
        // ao escrever `src/*.rs`.
        .literal_separator(true)
        .build()
        .map(|glob| glob.compile_matcher())
        .map_err(|err| format!("glob invalido `{pattern}`: {err}"))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    fn nomes(root: &Path) -> Vec<String> {
        files(root).map(|found| found.relative).collect()
    }

    fn workspace() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/main.rs"), "fn main() {}").unwrap();
        std::fs::write(root.join("leia.md"), "texto").unwrap();
        dir
    }

    #[test]
    fn every_file_under_the_root_is_found_with_a_relative_path() {
        let dir = workspace();
        let mut encontrados = nomes(dir.path());
        encontrados.sort();

        assert_eq!(encontrados, vec!["leia.md", "src/main.rs"]);
    }

    #[test]
    fn what_the_repository_declared_as_derived_is_skipped() {
        // A lista fixa de antes nao conhecia o diretorio de saida que este
        // projeto configurou, e o repositorio ja declara isso no `.gitignore`.
        let dir = workspace();
        std::fs::write(dir.path().join(".gitignore"), "saida/\n*.log\n").unwrap();
        std::fs::create_dir_all(dir.path().join("saida")).unwrap();
        std::fs::write(dir.path().join("saida/gerado.txt"), "x").unwrap();
        std::fs::write(dir.path().join("depuracao.log"), "x").unwrap();

        let encontrados = nomes(dir.path());
        assert!(
            !encontrados.iter().any(|n| n.starts_with("saida/")),
            "{encontrados:?}"
        );
        assert!(
            !encontrados.contains(&"depuracao.log".to_owned()),
            "{encontrados:?}"
        );
        assert!(
            encontrados.contains(&"src/main.rs".to_owned()),
            "{encontrados:?}"
        );
    }

    #[test]
    fn a_directory_someone_versioned_on_purpose_is_not_hidden() {
        // O outro lado do erro da lista fixa: ela escondia um `dist/` que
        // alguem versionou de proposito.
        let dir = workspace();
        std::fs::create_dir_all(dir.path().join("dist")).unwrap();
        std::fs::write(dir.path().join("dist/entregue.js"), "x").unwrap();

        assert!(nomes(dir.path()).contains(&"dist/entregue.js".to_owned()));
    }

    #[test]
    fn a_hidden_file_is_content_and_is_found() {
        // `AGENTS.md` mora ao lado de `.claude/`; esconder o que comeca com
        // ponto deixaria o agente cego para a configuracao do repositorio.
        let dir = workspace();
        std::fs::create_dir_all(dir.path().join(".claude")).unwrap();
        std::fs::write(dir.path().join(".claude/regras.md"), "x").unwrap();

        assert!(nomes(dir.path()).contains(&".claude/regras.md".to_owned()));
    }

    #[test]
    fn the_git_directory_never_appears() {
        let dir = workspace();
        std::fs::create_dir_all(dir.path().join(".git/objects")).unwrap();
        std::fs::write(dir.path().join(".git/objects/abc"), "x").unwrap();

        assert!(!nomes(dir.path()).iter().any(|n| n.starts_with(".git")));
    }

    #[test]
    #[cfg(unix)]
    fn a_symlink_out_of_the_root_is_not_followed() {
        // Segui-lo contornaria a contencao de caminho sem passar por ferramenta.
        let dir = workspace();
        let fora = tempfile::tempdir().unwrap();
        std::fs::write(fora.path().join("segredo.txt"), "x").unwrap();
        std::os::unix::fs::symlink(fora.path(), dir.path().join("atalho")).unwrap();

        assert!(!nomes(dir.path()).iter().any(|n| n.contains("segredo")));
    }

    #[test]
    fn the_order_does_not_change_between_runs() {
        // Uma ordem que muda invalida o cache de prompt do backend sem ganho.
        let dir = workspace();
        assert_eq!(nomes(dir.path()), nomes(dir.path()));
    }

    #[test]
    fn the_ceiling_stops_the_walk() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..30 {
            std::fs::write(dir.path().join(format!("f{i:02}.txt")), "x").unwrap();
        }

        assert_eq!(files_within(dir.path(), 10).count(), 10);
    }

    #[test]
    fn a_glob_matches_the_name_and_respects_the_separator() {
        let matcher = glob("*.rs").unwrap();
        assert!(matcher.is_match("main.rs"));
        assert!(!matcher.is_match("src/main.rs"), "`*` nao atravessa barra");

        let profundo = glob("src/**/*.rs").unwrap();
        assert!(profundo.is_match("src/a/b.rs"));
    }

    #[test]
    fn an_invalid_glob_says_what_is_wrong() {
        // Um erro que so diz "invalido" faz o modelo tentar o mesmo padrao.
        let err = glob("[nao-fecha").unwrap_err();
        assert!(err.contains("glob invalido"), "{err}");
    }
}
