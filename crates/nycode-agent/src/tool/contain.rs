//! Abertura de arquivo com a contenção imposta pelo núcleo.
//!
//! [`super::ToolContext::resolve`] decide se um caminho está dentro da raiz, e
//! decide certo. O que ele não consegue é fazer a decisão valer: entre a
//! checagem e o `open` que vem depois, o caminho pode passar a apontar para
//! outro lugar. Basta que um componente vire link simbólico nesse intervalo — e
//! o intervalo não é teórico, porque `edit` lê, compara ocorrências e só então
//! escreve, com uma chamada de modelo de distância entre as duas pontas.
//!
//! Um caminho validado não é um arquivo. Aqui a resposta é um descritor: o
//! núcleo resolve o caminho uma vez, sob a restrição de não sair da raiz, e o
//! que volta é o próprio objeto aberto. Não há segunda resolução para
//! envenenar.
//!
//! No Linux isso é `openat2` com `RESOLVE_BENEATH`, que é exatamente esta
//! semântica em uma chamada — e é mais permissivo que `O_NOFOLLOW` de propósito:
//! um link que aponta para dentro da raiz continua funcionando, que é o
//! comportamento que o repositório já tinha e que um `O_NOFOLLOW` componente a
//! componente recusaria.
//!
//! Onde `openat2` não existe — núcleo anterior ao 5.6, outro sistema — a
//! abertura volta a ser por caminho, com a validação léxica de `resolve` como
//! única garantia. É menos, e o módulo diz que é menos em vez de fingir: a
//! alternativa portátil recusaria link legítimo dentro do workspace, que
//! trocaria uma corrida difícil por uma quebra certa.

use std::fs::File;
use std::path::Path;

/// Abre um arquivo para leitura, sem deixar a resolução sair da raiz.
///
/// O caminho já passou por [`super::ToolContext::resolve`]; o que esta função
/// acrescenta é que o arquivo aberto seja o mesmo que foi validado.
pub fn open_read(root: &Path, path: &Path) -> std::io::Result<File> {
    beneath::read(root, path)?.map_or_else(|| File::open(path), Ok)
}

/// Cria ou trunca um arquivo para escrita, sem deixar a resolução sair da raiz.
pub fn create_write(root: &Path, path: &Path) -> std::io::Result<File> {
    beneath::write(root, path)?.map_or_else(|| File::create(path), Ok)
}

/// Abre para leitura e entrega o arquivo pronto para o `tokio`.
///
/// A abertura em si é síncrona porque a contenção é uma chamada de sistema
/// sobre caminho local, que não bloqueia de forma mensurável — o mesmo custo do
/// `is_dir` que as ferramentas já pagam ao lado.
pub fn open_read_async(root: &Path, path: &Path) -> std::io::Result<tokio::fs::File> {
    Ok(tokio::fs::File::from_std(open_read(root, path)?))
}

/// Escreve o conteúdo inteiro, criando ou truncando, sem sair da raiz.
pub async fn write(root: &Path, path: &Path, content: &[u8]) -> std::io::Result<()> {
    use tokio::io::AsyncWriteExt as _;

    let mut file = tokio::fs::File::from_std(create_write(root, path)?);
    file.write_all(content).await?;
    file.flush().await
}

/// Cria os diretórios que faltam até o pai do caminho.
///
/// Componente a componente a partir da raiz, e não `create_dir_all` sobre o
/// caminho inteiro: aquele resolve links em cada nível no momento em que chega
/// neles, então um componente que vire link durante a criação faz os
/// diretórios seguintes nascerem fora da raiz. O arquivo em si não escaparia,
/// porque a abertura é contida — mas criar diretório fora do workspace já é
/// escrever fora dele.
pub fn create_parents(root: &Path, path: &Path) -> std::io::Result<()> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    let Ok(relative) = parent.strip_prefix(root) else {
        // Fora da raiz não se cria nada. `resolve` já teria recusado; chegar
        // aqui significa que alguém montou o caminho por outro caminho.
        return Err(escapes());
    };
    beneath::create_dirs(root, relative)
}

/// O erro de quem tentou sair da raiz.
fn escapes() -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::PermissionDenied,
        "o caminho sai da raiz do workspace",
    )
}

#[cfg(target_os = "linux")]
mod beneath {
    use std::fs::File;
    use std::path::Path;

    use rustix::fs::{Mode, OFlags, ResolveFlags};

    /// Como o núcleo é instruído a resolver.
    ///
    /// `BENEATH` recusa caminho absoluto, `..` que suba além do descritor e link
    /// que aponte para fora. `NO_MAGICLINKS` fecha a porta de `/proc`, onde
    /// `self/fd/N` e `self/cwd` levam a qualquer lugar sem serem link simbólico
    /// comum — e um workspace que tenha `/proc` montado dentro dele é raro, mas
    /// o custo de fechar é zero.
    const HOW: ResolveFlags = ResolveFlags::BENEATH.union(ResolveFlags::NO_MAGICLINKS);

    pub fn read(root: &Path, path: &Path) -> std::io::Result<Option<File>> {
        open(root, path, OFlags::RDONLY, Mode::empty())
    }

    pub fn write(root: &Path, path: &Path) -> std::io::Result<Option<File>> {
        open(
            root,
            path,
            OFlags::WRONLY | OFlags::CREATE | OFlags::TRUNC,
            Mode::from_bits_truncate(0o666),
        )
    }

    fn open(root: &Path, path: &Path, flags: OFlags, mode: Mode) -> std::io::Result<Option<File>> {
        let Ok(relative) = path.strip_prefix(root) else {
            return Err(super::escapes());
        };
        if relative.as_os_str().is_empty() {
            // A própria raiz não é arquivo; deixar seguir daria um erro de
            // "é um diretório" vindo de dentro, três camadas mais fundo.
            return Err(super::escapes());
        }

        let anchor = File::open(root)?;
        match rustix::fs::openat2(&anchor, relative, flags, mode, HOW) {
            Ok(fd) => Ok(Some(File::from(fd))),
            Err(err) if unsupported(err) => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    /// Cria os diretórios que faltam, um componente por vez.
    pub fn create_dirs(root: &Path, relative: &Path) -> std::io::Result<()> {
        let mut here = File::open(root)?;
        for component in relative.components() {
            let name = component.as_os_str();
            match rustix::fs::mkdirat(&here, name, Mode::from_bits_truncate(0o777)) {
                Ok(()) => {}
                // Já existir é o caso comum e não é falha.
                Err(err) if err == rustix::io::Errno::EXIST => {}
                Err(err) if unsupported(err) => {
                    return std::fs::create_dir_all(root.join(relative));
                }
                Err(err) => return Err(err.into()),
            }
            let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC;
            match rustix::fs::openat2(&here, name, flags, Mode::empty(), HOW) {
                Ok(fd) => here = File::from(fd),
                Err(err) if unsupported(err) => {
                    return std::fs::create_dir_all(root.join(relative));
                }
                Err(err) => return Err(err.into()),
            }
        }
        Ok(())
    }

    /// Se o núcleo não conhece a chamada, em vez de ter recusado o caminho.
    ///
    /// `ENOSYS` é o núcleo anterior ao 5.6. `EPERM` é o filtro de chamadas de um
    /// contêiner que ainda não liberou `openat2` — comum em imagens com perfil
    /// de `seccomp` antigo. `EINVAL` aparece quando a implementação existe mas
    /// não conhece uma das opções de resolução.
    ///
    /// Distinguir importa: tratar recusa como ausência de suporte cairia no
    /// caminho sem contenção justamente quando a contenção acabou de funcionar.
    fn unsupported(err: rustix::io::Errno) -> bool {
        matches!(
            err,
            rustix::io::Errno::NOSYS | rustix::io::Errno::PERM | rustix::io::Errno::INVAL
        )
    }
}

#[cfg(not(target_os = "linux"))]
mod beneath {
    use std::fs::File;
    use std::path::Path;

    pub fn read(_root: &Path, _path: &Path) -> std::io::Result<Option<File>> {
        Ok(None)
    }

    pub fn write(_root: &Path, _path: &Path) -> std::io::Result<Option<File>> {
        Ok(None)
    }

    pub fn create_dirs(root: &Path, relative: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(root.join(relative))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use std::io::Read as _;

    fn workspace() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn read_to_string(mut file: File) -> String {
        let mut text = String::new();
        file.read_to_string(&mut text).unwrap();
        text
    }

    #[test]
    fn a_file_inside_the_root_opens_normally() {
        let dir = workspace();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("dentro.txt"), "conteudo").unwrap();

        let file = open_read(&root, &root.join("dentro.txt")).unwrap();
        assert_eq!(read_to_string(file), "conteudo");
    }

    #[test]
    fn a_file_under_a_subdirectory_opens_normally() {
        let dir = workspace();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join("a/b")).unwrap();
        std::fs::write(root.join("a/b/c.txt"), "fundo").unwrap();

        let file = open_read(&root, &root.join("a/b/c.txt")).unwrap();
        assert_eq!(read_to_string(file), "fundo");
    }

    #[test]
    #[cfg(unix)]
    fn a_symlink_that_stays_inside_the_root_still_opens() {
        // A contencao nao pode virar uma quebra: um link para dentro e uso
        // legitimo, e e por isso que a resposta e `RESOLVE_BENEATH` e nao
        // `O_NOFOLLOW`.
        let dir = workspace();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("alvo.txt"), "legitimo").unwrap();
        std::os::unix::fs::symlink("alvo.txt", root.join("atalho.txt")).unwrap();

        let file = open_read(&root, &root.join("atalho.txt")).unwrap();
        assert_eq!(read_to_string(file), "legitimo");
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn a_symlink_swapped_after_the_check_does_not_open_what_it_points_to() {
        // A corrida em si. O caminho e validado enquanto e um arquivo comum, e
        // vira link para fora antes da abertura — que e o que acontece entre a
        // leitura e a escrita do `edit`. Com abertura por caminho, o segredo
        // seria lido; com o descritor contido, o nucleo recusa.
        let dir = workspace();
        let root = dir.path().canonicalize().unwrap();
        let fora = dir
            .path()
            .parent()
            .unwrap()
            .join(format!("nycode-segredo-{}.txt", std::process::id()));
        std::fs::write(&fora, "segredo").unwrap();

        let alvo = root.join("inocente.txt");
        std::fs::write(&alvo, "inocente").unwrap();
        // O que o atacante faz na janela: troca o arquivo pelo link.
        std::fs::remove_file(&alvo).unwrap();
        std::os::unix::fs::symlink(&fora, &alvo).unwrap();

        let aberto = open_read(&root, &alvo);
        let _ = std::fs::remove_file(&fora);

        assert!(
            aberto.is_err(),
            "abriu o alvo do link: {:?}",
            aberto.map(read_to_string)
        );
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn a_write_through_a_swapped_symlink_does_not_land_outside() {
        let dir = workspace();
        let root = dir.path().canonicalize().unwrap();
        let fora = dir
            .path()
            .parent()
            .unwrap()
            .join(format!("nycode-vitima-{}.txt", std::process::id()));
        std::fs::write(&fora, "original").unwrap();

        let alvo = root.join("saida.txt");
        std::os::unix::fs::symlink(&fora, &alvo).unwrap();

        let escrito = create_write(&root, &alvo);
        let sobreviveu = std::fs::read_to_string(&fora).unwrap_or_default();
        let _ = std::fs::remove_file(&fora);

        assert!(escrito.is_err(), "abriu para escrita fora da raiz");
        assert_eq!(sobreviveu, "original", "o arquivo de fora foi sobrescrito");
    }

    #[test]
    fn a_path_that_is_not_under_the_root_is_refused() {
        let dir = workspace();
        let root = dir.path().canonicalize().unwrap();
        assert!(open_read(&root, Path::new("/etc/hostname")).is_err());
    }

    #[test]
    fn the_root_itself_is_not_a_file() {
        let dir = workspace();
        let root = dir.path().canonicalize().unwrap();
        assert!(open_read(&root, &root).is_err());
    }

    #[test]
    fn creating_a_file_writes_where_it_says() {
        let dir = workspace();
        let root = dir.path().canonicalize().unwrap();

        let mut file = create_write(&root, &root.join("novo.txt")).unwrap();
        std::io::Write::write_all(&mut file, b"escrito").unwrap();
        drop(file);

        assert_eq!(
            std::fs::read_to_string(root.join("novo.txt")).unwrap(),
            "escrito"
        );
    }

    #[test]
    fn creating_a_file_truncates_what_was_there() {
        let dir = workspace();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("velho.txt"), "conteudo bem longo").unwrap();

        let mut file = create_write(&root, &root.join("velho.txt")).unwrap();
        std::io::Write::write_all(&mut file, b"curto").unwrap();
        drop(file);

        assert_eq!(
            std::fs::read_to_string(root.join("velho.txt")).unwrap(),
            "curto"
        );
    }

    #[test]
    fn intermediate_directories_are_created() {
        let dir = workspace();
        let root = dir.path().canonicalize().unwrap();
        let alvo = root.join("a/b/c/arquivo.txt");

        create_parents(&root, &alvo).unwrap();
        assert!(root.join("a/b/c").is_dir());

        let mut file = create_write(&root, &alvo).unwrap();
        std::io::Write::write_all(&mut file, b"fundo").unwrap();
        drop(file);

        assert_eq!(std::fs::read_to_string(&alvo).unwrap(), "fundo");
    }

    #[test]
    fn creating_directories_that_already_exist_is_not_a_failure() {
        let dir = workspace();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join("a/b")).unwrap();

        create_parents(&root, &root.join("a/b/arquivo.txt")).unwrap();
        assert!(root.join("a/b").is_dir());
    }

    #[test]
    fn creating_parents_outside_the_root_is_refused() {
        let dir = workspace();
        let root = dir.path().canonicalize().unwrap();
        let fora = dir.path().parent().unwrap().join("fora/arquivo.txt");

        assert!(create_parents(&root, &fora).is_err());
        assert!(!fora.parent().unwrap().exists());
    }

    #[test]
    fn a_file_at_the_root_has_no_parents_to_create() {
        let dir = workspace();
        let root = dir.path().canonicalize().unwrap();
        create_parents(&root, &root.join("solto.txt")).unwrap();
    }
}
