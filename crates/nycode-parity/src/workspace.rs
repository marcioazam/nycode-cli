//! Captura do estado do disco depois de uma execução.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{Context, Result};

/// Arquivos e diretórios ignorados ao fotografar o workspace.
///
/// Sem isto, `target/` e `.git/` dominam a comparação com ruído que nenhuma das
/// duas execuções controla.
const IGNORED: &[&str] = &["target", ".git", "node_modules", ".nycode", ".pi"];

/// Fotografa o conteúdo do workspace como caminho relativo para digest.
pub fn snapshot(root: &Path) -> Result<BTreeMap<String, String>> {
    let mut files = BTreeMap::new();
    walk(root, root, &mut files)?;
    Ok(files)
}

fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, String>) -> Result<()> {
    let entries = std::fs::read_dir(dir)
        .with_context(|| format!("nao foi possivel listar {}", dir.display()))?;

    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();

        if IGNORED.contains(&name.as_ref()) {
            continue;
        }

        let kind = entry.file_type()?;
        if kind.is_dir() {
            walk(root, &path, out)?;
        } else if kind.is_file() {
            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .display()
                .to_string();
            out.insert(relative, digest(&std::fs::read(&path)?));
        }
        // Symlinks sao ignorados: seguir um poderia sair do workspace e
        // fotografar o sistema inteiro.
    }
    Ok(())
}

/// Digest estável do conteúdo.
///
/// FNV-1a: não é criptográfico e não precisa ser. A pergunta é "este arquivo
/// mudou entre duas execuções", não "alguém forjou uma colisão".
fn digest(bytes: &[u8]) -> String {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;

    let mut hash = OFFSET;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(PRIME);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, relative: &str, contents: &str) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, contents).unwrap();
    }

    #[test]
    fn captures_nested_files_with_relative_paths() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.rs", "conteudo");
        write(dir.path(), "src/b.rs", "outro");

        let snap = snapshot(dir.path()).unwrap();
        assert_eq!(snap.len(), 2);
        assert!(snap.contains_key("a.rs"));
        assert!(snap.contains_key("src/b.rs"));
    }

    #[test]
    fn identical_content_produces_identical_digests() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.txt", "igual");
        write(dir.path(), "b.txt", "igual");

        let snap = snapshot(dir.path()).unwrap();
        assert_eq!(snap["a.txt"], snap["b.txt"]);
    }

    #[test]
    fn a_one_byte_change_changes_the_digest() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.txt", "antes");
        let before = snapshot(dir.path()).unwrap();

        write(dir.path(), "a.txt", "anteS");
        let after = snapshot(dir.path()).unwrap();

        assert_ne!(before["a.txt"], after["a.txt"]);
    }

    #[test]
    fn build_and_vcs_directories_are_ignored() {
        // Sem isto o ruido de `target/` domina a comparacao e afoga a
        // divergencia real.
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "src/a.rs", "codigo");
        write(dir.path(), "target/debug/artefato", "lixo");
        write(dir.path(), ".git/HEAD", "ref");

        let snap = snapshot(dir.path()).unwrap();
        assert_eq!(snap.keys().collect::<Vec<_>>(), vec!["src/a.rs"]);
    }

    #[test]
    fn an_empty_workspace_snapshots_to_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(snapshot(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn ordering_is_deterministic_across_calls() {
        // BTreeMap garante ordem; sem ela o diff acusaria divergencia por causa
        // da ordem de leitura do sistema de arquivos.
        let dir = tempfile::tempdir().unwrap();
        for name in ["z.rs", "a.rs", "m.rs"] {
            write(dir.path(), name, "x");
        }
        let keys: Vec<_> = snapshot(dir.path()).unwrap().into_keys().collect();
        assert_eq!(keys, vec!["a.rs", "m.rs", "z.rs"]);
    }
}
