//! Contrato de ferramenta, o contexto em que ela roda, e o que a saída dela
//! pode ser.
//!
//! O que uma ferramenta produz não é texto do harness: vem de um comando, de um
//! arquivo do repositório ou de um servidor de terceiro. [`sanitize`] é o que
//! impede esse texto de virar controle de terminal no caminho até o usuário.
//!
//! E o caminho que ela recebe também não é do harness. [`ToolContext::resolve`]
//! decide se ele está dentro da raiz; [`contain`] é o que faz a decisão valer
//! até a abertura, fechando a janela entre uma coisa e outra.

pub mod coerce;
pub mod contain;
pub mod repair;
pub mod sanitize;

use std::path::{Component, Path, PathBuf};

use async_trait::async_trait;
use nycode_ai::anthropic::ContentBlock;
use serde_json::Value;

use crate::error::{Error, Result};

/// Uma chamada de ferramenta pedida pelo modelo, já com argumentos completos.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: Value,
}

/// Resultado da execução de uma ferramenta.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolOutput {
    pub content: String,
    /// Marcado quando a ferramenta falhou.
    ///
    /// O modelo reage diferente a um resultado marcado como erro e a um texto
    /// que apenas descreve um erro. Achatar os dois faz o agente seguir em
    /// frente como se a operação tivesse funcionado.
    pub is_error: bool,
    pub image: Option<ToolImage>,
    /// Encerra o turno depois desta rodada, se todas as chamadas pedirem.
    pub terminate: bool,
}

/// Imagem no resultado de uma ferramenta (FR-15).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolImage {
    pub media_type: String,
    pub data: String,
}

impl ToolOutput {
    #[must_use]
    pub fn ok(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            is_error: false,
            image: None,
            terminate: false,
        }
    }

    #[must_use]
    pub fn error(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            is_error: true,
            image: None,
            terminate: false,
        }
    }

    #[must_use]
    pub fn image(media_type: impl Into<String>, data: impl Into<String>) -> Self {
        Self {
            content: String::new(),
            is_error: false,
            image: Some(ToolImage {
                media_type: media_type.into(),
                data: data.into(),
            }),
            terminate: false,
        }
    }

    pub(crate) fn stop(&mut self) {
        self.terminate = true;
    }

    #[must_use]
    pub fn into_blocks(self, tool_use_id: impl Into<String>) -> Vec<ContentBlock> {
        let id = tool_use_id.into();
        let mut blocks = Vec::with_capacity(2);
        blocks.push(if self.is_error {
            ContentBlock::tool_error(id, self.content)
        } else {
            ContentBlock::tool_result(id, self.content)
        });
        if let Some(image) = self.image {
            blocks.push(ContentBlock::image(image.media_type, image.data));
        }
        blocks
    }
}

/// Ambiente em que as ferramentas operam.
#[derive(Debug, Clone)]
pub struct ToolContext {
    root: PathBuf,
}

impl ToolContext {
    /// Cria um contexto ancorado num diretório de trabalho.
    pub fn new(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        let root = root.canonicalize().map_err(|err| {
            Error::Workspace(format!("raiz inacessivel {}: {err}", root.display()))
        })?;
        Ok(Self { root })
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Resolve um caminho pedido pelo modelo para dentro da raiz.
    ///
    /// Um agente recebe caminhos de um modelo, que por sua vez pode estar
    /// repetindo conteúdo de um arquivo lido. Sem esta checagem, um `../` numa
    /// string de entrada vira leitura arbitrária do sistema de arquivos. A
    /// normalização é feita em cima dos componentes porque o arquivo alvo pode
    /// ainda não existir, o que impede usar `canonicalize` sobre ele.
    ///
    /// A normalização léxica sozinha não basta: ela barra `..` e caminho
    /// absoluto, e deixa passar link simbólico. Quem fecha isso é
    /// [`Self::refuse_symlink_escape`], no fim.
    pub fn resolve(&self, requested: &str) -> Result<PathBuf> {
        let requested = Path::new(requested);
        if requested.as_os_str().is_empty() {
            return Err(Error::PathEscape("caminho vazio".to_owned()));
        }

        let joined = if requested.is_absolute() {
            requested.to_path_buf()
        } else {
            self.root.join(requested)
        };

        let mut normalized = PathBuf::new();
        for component in joined.components() {
            match component {
                Component::ParentDir => {
                    // Um `..` que consegue subir acima da raiz e exatamente a
                    // fuga que precisa ser barrada.
                    if !normalized.pop() || !normalized.starts_with(&self.root) {
                        return Err(Error::PathEscape(requested.display().to_string()));
                    }
                }
                Component::CurDir => {}
                other => normalized.push(other),
            }
        }

        if !normalized.starts_with(&self.root) {
            return Err(Error::PathEscape(requested.display().to_string()));
        }
        self.refuse_symlink_escape(&normalized, requested)?;
        Ok(normalized)
    }

    /// Recusa o caminho que só fica na raiz enquanto ninguém segue os links.
    ///
    /// `<raiz>/atalho` satisfaz `starts_with` por construção, e quem abre o
    /// caminho depois — `read`, `write`, `edit` — segue o link. Sem isto, um
    /// link commitado no repositório lê e sobrescreve qualquer arquivo do
    /// usuário.
    ///
    /// A resposta vem do ancestral existente mais próximo, e não do alvo:
    /// `write` cria arquivo que ainda não existe, e `canonicalize` falha sobre o
    /// que não existe. Subir até o que existe resolve os links que já estão no
    /// caminho sem exigir que o alvo esteja lá.
    fn refuse_symlink_escape(&self, normalized: &Path, requested: &Path) -> Result<()> {
        // A raiz do contexto já é canônica desde `new`, então não se paga a
        // canonicalização dela a cada chamada de ferramenta.
        if within_canonical_root(&self.root, normalized) {
            return Ok(());
        }
        Err(Error::PathEscape(requested.display().to_string()))
    }

    /// Caminho relativo à raiz, para exibição.
    #[must_use]
    pub fn display_path(&self, path: &Path) -> String {
        path.strip_prefix(&self.root)
            .unwrap_or(path)
            .display()
            .to_string()
    }
}

/// Se o caminho continua dentro da raiz depois de os links serem resolvidos.
///
/// Existe fora do [`ToolContext`] porque o carregamento de contexto —
/// instrução, skill, comando — lê do disco antes de haver contexto de
/// ferramenta. É o caminho que vaza sem nenhuma chamada de ferramenta: o
/// conteúdo entra no prompt de sistema na abertura da sessão.
#[must_use]
pub fn stays_within(root: &Path, path: &Path) -> bool {
    root.canonicalize()
        .is_ok_and(|root| within_canonical_root(&root, path))
}

/// O mesmo, para quem já tem a raiz canônica em mãos.
///
/// A resposta vem do ancestral existente mais próximo, e não do alvo:
/// `canonicalize` falha sobre o que não existe, e `write` cria arquivo novo.
/// Subir até o que existe resolve os links que já estão no caminho sem exigir
/// que o alvo esteja lá.
fn within_canonical_root(root: &Path, path: &Path) -> bool {
    let mut ancestor = path;
    loop {
        match ancestor.canonicalize() {
            Ok(real) => return real.starts_with(root),
            Err(_) => match ancestor.parent() {
                Some(parent) => ancestor = parent,
                None => return false,
            },
        }
    }
}

/// Uma capacidade que o modelo pode invocar.
#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;

    /// Descrição enviada ao modelo. É o que determina se a ferramenta é usada
    /// na hora certa, então vale mais que a implementação.
    fn description(&self) -> &str;

    /// Se esta ferramenta pode entrar ou sair entre sessões.
    ///
    /// Uma nativa está sempre lá; uma de servidor MCP aparece porque o
    /// workspace a declarou e some quando o servidor não sobe. Quem declara
    /// isso decide de que lado do ponto de corte do cache a ferramenta fica
    /// (NFR-7), e o padrão é o lado estável porque é onde as nativas ficam.
    fn is_extension(&self) -> bool {
        false
    }

    fn input_schema(&self) -> Value;

    /// Executa a chamada.
    ///
    /// Retorna [`ToolOutput`] mesmo em falha: um erro de ferramenta é dado para
    /// o modelo reagir, não uma falha do turno.
    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolOutput;
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    fn ctx() -> (tempfile::TempDir, ToolContext) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();
        (dir, ctx)
    }

    #[test]
    fn resolves_relative_paths_inside_the_root() {
        let (_dir, ctx) = ctx();
        let resolved = ctx.resolve("src/main.rs").unwrap();
        assert!(resolved.starts_with(ctx.root()));
        assert_eq!(ctx.display_path(&resolved), "src/main.rs");
    }

    #[test]
    fn blocks_parent_traversal_out_of_the_root() {
        // Um caminho vem do modelo, que pode estar repetindo conteudo de um
        // arquivo lido. Sem esta checagem isso vira leitura arbitraria do disco.
        let (_dir, ctx) = ctx();
        for escape in [
            "../etc/passwd",
            "src/../../etc/passwd",
            "../../../../etc/shadow",
        ] {
            let err = ctx
                .resolve(escape)
                .expect_err("{escape} deveria ser barrado");
            assert!(
                matches!(err, Error::PathEscape(_)),
                "{escape} passou: {err:?}"
            );
        }
    }

    #[test]
    fn blocks_absolute_paths_outside_the_root() {
        let (_dir, ctx) = ctx();
        assert!(matches!(
            ctx.resolve("/etc/passwd"),
            Err(Error::PathEscape(_))
        ));
    }

    #[test]
    #[cfg(unix)]
    fn blocks_a_symlink_that_leaves_the_root() {
        // A normalizacao e lexica, entao `<raiz>/atalho` satisfaz `starts_with`
        // por construcao. Sem resolver o link, `read` le o alvo e `write` o
        // sobrescreve: a contencao inteira vira decoracao para quem controla o
        // conteudo do repositorio.
        let (dir, ctx) = ctx();
        let outside = tempfile::tempdir().unwrap();
        let segredo = outside.path().join("id_rsa");
        std::fs::write(&segredo, "chave").unwrap();
        std::os::unix::fs::symlink(&segredo, dir.path().join("atalho")).unwrap();

        assert!(matches!(ctx.resolve("atalho"), Err(Error::PathEscape(_))));
    }

    #[test]
    #[cfg(unix)]
    fn blocks_a_file_that_does_not_exist_yet_under_a_symlinked_directory() {
        // `write` cria arquivo inexistente, entao a checagem precisa subir ate o
        // ancestral que existe. Sem isso um diretorio-link e porta de escrita
        // fora da raiz, que e o caso pior dos dois.
        let (dir, ctx) = ctx();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("fora")).unwrap();

        assert!(matches!(
            ctx.resolve("fora/novo.txt"),
            Err(Error::PathEscape(_))
        ));
    }

    #[test]
    #[cfg(unix)]
    fn a_symlink_that_stays_inside_the_root_still_resolves() {
        // Barrar todo link seria excessivo: apontar para dentro da raiz e uso
        // legitimo, e recusa-lo quebraria repositorio que compartilha arquivo
        // entre diretorios.
        let (dir, ctx) = ctx();
        std::fs::write(dir.path().join("src/main.rs"), "fn main() {}").unwrap();
        std::os::unix::fs::symlink(dir.path().join("src/main.rs"), dir.path().join("atalho.rs"))
            .unwrap();

        assert!(ctx.resolve("atalho.rs").is_ok());
    }

    #[test]
    fn allows_traversal_that_stays_within_the_root() {
        // Barrar `..` incondicionalmente rejeitaria caminhos legitimos que o
        // modelo produz ao navegar a arvore.
        let (_dir, ctx) = ctx();
        let resolved = ctx.resolve("src/../src/main.rs").unwrap();
        assert_eq!(ctx.display_path(&resolved), "src/main.rs");
    }

    #[test]
    fn accepts_an_absolute_path_that_is_inside_the_root() {
        let (_dir, ctx) = ctx();
        let inside = ctx.root().join("src/lib.rs");
        let resolved = ctx.resolve(&inside.display().to_string()).unwrap();
        assert_eq!(resolved, inside);
    }

    #[test]
    fn rejects_an_empty_path() {
        let (_dir, ctx) = ctx();
        assert!(matches!(ctx.resolve(""), Err(Error::PathEscape(_))));
    }

    #[test]
    fn tool_output_carries_the_error_flag_distinctly() {
        assert!(!ToolOutput::ok("conteudo").is_error);
        assert!(ToolOutput::error("falhou").is_error);
        assert_eq!(ToolOutput::ok("ok").into_blocks("t1").len(), 1);
    }

    #[test]
    fn an_image_result_becomes_a_tool_result_and_an_image_block() {
        let blocks = ToolOutput::image("image/png", "QUJD").into_blocks("t1");
        assert_eq!(blocks.len(), 2);
        assert!(
            matches!(&blocks[0], ContentBlock::ToolResult { tool_use_id, .. } if tool_use_id == "t1")
        );
        assert!(matches!(blocks[1], ContentBlock::Image { .. }));
    }
}
