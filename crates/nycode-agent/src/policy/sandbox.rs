//! Confinamento do comando de shell pelo sistema operacional (FR-11).
//!
//! O gate ao lado decide *se* um comando roda. Isto decide *o que ele alcança*
//! depois de começar — e é a única das duas que um comando não consegue
//! ignorar.
//!
//! A forma é imposta pelo workspace: `unsafe_code = "forbid"` elimina chamar
//! `sandbox_init` ou `landlock_*` por FFI, então o confinamento é aplicado
//! envolvendo o processo filho num executável do sistema
//! ([ADR-0005](../../../../docs/architecture/decisions/0005-sandbox-de-so-por-processo-auxiliar.md)).

/// Como um comando será confinado.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Confinement {
    /// `bubblewrap`, o mesmo caminho que o Codex usa no Linux.
    Bubblewrap { program: String },
    /// `sandbox-exec`, a interface de linha de comando do Seatbelt.
    Seatbelt { program: String },
    /// Nenhum disponível neste ambiente.
    ///
    /// A razão acompanha porque ela é o que o usuário precisa para decidir
    /// entre instalar o pacote e aceitar o risco.
    Unavailable { reason: String },
}

/// Quanto o confinamento efetivamente contém.
///
/// A distinção não é acadêmica. Uma política que **nega por omissão** contém
/// também o que ninguém previu; uma que **permite por omissão** contém só o que
/// alguém lembrou de listar, e cada capacidade esquecida é uma porta aberta.
/// Relatar as duas como "confinado" é exatamente a degradação silenciosa que o
/// NFR-4 proíbe, e é o que o FR-8 fecha.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Strength {
    /// Nega por omissão: o que a política não liberou não acontece.
    Restrictive,
    /// Permite por omissão: só valem as proibições listadas.
    Permissive,
    /// Não há confinamento nenhum.
    Absent,
}

impl Confinement {
    #[must_use]
    pub const fn is_enforced(&self) -> bool {
        matches!(self, Self::Bubblewrap { .. } | Self::Seatbelt { .. })
    }

    /// O que a política contém de fato.
    ///
    /// `bubblewrap` monta um namespace novo e liga só o que foi pedido, então o
    /// que não está no `argv` não existe para o filho. O perfil Seatbelt começa
    /// em `(allow default)` e nega uma lista — endurecê-lo para `(deny default)`
    /// exige enumerar cada capacidade que um comando de build legítimo usa, e
    /// verificar isso pede um Mac (ver ADR-0005).
    #[must_use]
    pub const fn strength(&self) -> Strength {
        match self {
            Self::Bubblewrap { .. } => Strength::Restrictive,
            Self::Seatbelt { .. } => Strength::Permissive,
            Self::Unavailable { .. } => Strength::Absent,
        }
    }

    /// Aviso a mostrar quando o confinamento não é o que o usuário suporia.
    ///
    /// Rodar sem sandbox em silêncio é a degradação que o NFR-4 proíbe, e rodar
    /// sob uma que permite por omissão anunciando-a como equivalente à outra é a
    /// mesma coisa um passo adiante: a diferença entre "protegido" e "achou que
    /// estava protegido" é a única que importa aqui.
    #[must_use]
    pub fn warning(&self) -> Option<String> {
        match self {
            Self::Unavailable { reason } => Some(format!(
                "comandos de shell rodam SEM confinamento do sistema operacional ({reason})"
            )),
            Self::Seatbelt { .. } => Some(
                "comandos de shell rodam sob confinamento PARCIAL: o perfil do macOS nega \
                 escrita fora do workspace e, quando pedido, a rede — e permite o resto"
                    .to_owned(),
            ),
            Self::Bubblewrap { .. } => None,
        }
    }
}

/// Onde a sessão está rodando.
///
/// É um valor e não um `cfg!` no meio da lógica porque assim os três caminhos
/// são exercitáveis numa máquina só. Com `cfg!`, o ramo do macOS nunca roda num
/// Linux e a decisão de plataforma fica sem teste justamente onde ela importa.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Linux,
    MacOs,
    Other,
}

impl Platform {
    /// A plataforma em que este binário foi compilado.
    #[must_use]
    pub const fn current() -> Self {
        if cfg!(target_os = "linux") {
            Self::Linux
        } else if cfg!(target_os = "macos") {
            Self::MacOs
        } else {
            Self::Other
        }
    }
}

/// Detecta o confinamento disponível na plataforma corrente.
///
/// O localizador é parâmetro e não leitura direta do ambiente porque `set_var`
/// é `unsafe` na edition 2024, e sem esta costura o comportamento seria
/// intestável.
#[must_use]
pub fn detect(available: &dyn Fn(&str) -> bool) -> Confinement {
    detect_on(Platform::current(), available)
}

/// O mesmo, para uma plataforma explícita.
#[must_use]
pub fn detect_on(platform: Platform, available: &dyn Fn(&str) -> bool) -> Confinement {
    match platform {
        Platform::Linux if available("bwrap") => Confinement::Bubblewrap {
            program: "bwrap".to_owned(),
        },
        Platform::Linux => Confinement::Unavailable {
            reason: "`bwrap` nao encontrado no PATH; instale o pacote bubblewrap".to_owned(),
        },
        Platform::MacOs if available("sandbox-exec") => Confinement::Seatbelt {
            program: "sandbox-exec".to_owned(),
        },
        Platform::MacOs => Confinement::Unavailable {
            reason: "`sandbox-exec` nao encontrado no PATH".to_owned(),
        },
        Platform::Other => Confinement::Unavailable {
            reason: "nenhum confinamento implementado para esta plataforma".to_owned(),
        },
    }
}

/// Detecta consultando o `PATH` de verdade.
#[must_use]
pub fn detect_from_path() -> Confinement {
    detect(&|program| which(program).is_some())
}

/// Diretórios de sistema consultados antes do `PATH`.
///
/// O `PATH` é do usuário, e um `bwrap` plantado à frente dele desliga o
/// confinamento sem que nada indique isso: `is_enforced()` continuaria
/// afirmando que há sandbox enquanto o comando roda solto. Procurar primeiro
/// onde o pacote instala fecha o caso comum. O `PATH` continua valendo depois,
/// porque nem toda distribuição usa os mesmos diretórios e recusar seria trocar
/// uma proteção por uma pane.
const SYSTEM_DIRS: &[&str] = &["/usr/bin", "/bin", "/usr/local/bin", "/usr/sbin", "/sbin"];

/// Procura o executável de confinamento, preferindo os diretórios de sistema.
fn which(program: &str) -> Option<std::path::PathBuf> {
    which_within(program, SYSTEM_DIRS, std::env::var_os("PATH").as_deref())
}

/// O mesmo, com as duas fontes injetadas.
///
/// Injetadas porque `set_var` é `unsafe` na edition 2024, e sem esta costura a
/// precedência entre sistema e `PATH` — que é a decisão de segurança aqui —
/// ficaria sem teste.
fn which_within(
    program: &str,
    system: &[&str],
    path: Option<&std::ffi::OsStr>,
) -> Option<std::path::PathBuf> {
    let in_system = system
        .iter()
        .map(|dir| std::path::Path::new(dir).join(program))
        .find(|candidate| is_executable(candidate));

    in_system.or_else(|| {
        std::env::split_paths(path?)
            .map(|dir| dir.join(program))
            .find(|candidate| is_executable(candidate))
    })
}

/// Se o caminho é um arquivo com bit de execução.
///
/// `is_file` sozinho não basta: um arquivo sem o bit faz `is_enforced()` dizer
/// que há confinamento e o `spawn` falhar só depois — a pior ordem possível,
/// porque a garantia já foi dada ao usuário.
fn is_executable(path: &std::path::Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

mod profile;

pub use profile::{Policy, prefix, wrap};

#[cfg(test)]
mod tests {
    use super::*;

    fn nothing_available(_: &str) -> bool {
        false
    }

    fn everything_available(_: &str) -> bool {
        true
    }

    #[test]
    fn each_platform_picks_its_own_tool() {
        assert_eq!(
            detect_on(Platform::Linux, &everything_available),
            Confinement::Bubblewrap {
                program: "bwrap".to_owned()
            }
        );
        assert_eq!(
            detect_on(Platform::MacOs, &everything_available),
            Confinement::Seatbelt {
                program: "sandbox-exec".to_owned()
            }
        );
    }

    #[test]
    fn a_platform_without_an_implementation_says_so_rather_than_pretending() {
        // Anunciar confinamento onde nao ha e a pior resposta possivel.
        let found = detect_on(Platform::Other, &everything_available);
        assert!(!found.is_enforced());
        assert!(found.warning().unwrap().contains("plataforma"));
    }

    #[test]
    fn a_missing_tool_names_what_to_install() {
        // "indisponivel" sem dizer o que falta deixa o usuario sem acao.
        let linux = detect_on(Platform::Linux, &nothing_available);
        assert!(!linux.is_enforced());
        let warning = linux.warning().expect("precisa avisar");
        assert!(warning.contains("SEM confinamento"), "{warning}");
        assert!(warning.contains("bubblewrap"), "{warning}");

        let mac = detect_on(Platform::MacOs, &nothing_available);
        assert!(mac.warning().unwrap().contains("sandbox-exec"));
    }

    #[test]
    fn a_confinement_that_denies_by_default_does_not_warn() {
        // O aviso e para a excecao. Sob `bubblewrap` nao ha excecao a relatar.
        assert!(
            detect_on(Platform::Linux, &everything_available)
                .warning()
                .is_none()
        );
    }

    #[test]
    fn a_policy_that_allows_by_default_says_so_instead_of_passing_for_the_other() {
        // FR-8. O perfil Seatbelt comeca em `(allow default)` e nega uma lista;
        // anuncia-lo como equivalente ao namespace do Linux e a degradacao
        // silenciosa que o NFR-4 proibe.
        let mac = detect_on(Platform::MacOs, &everything_available);
        assert_eq!(mac.strength(), Strength::Permissive);

        let warning = mac
            .warning()
            .expect("um confinamento parcial precisa avisar");
        assert!(warning.contains("PARCIAL"), "{warning}");
        assert!(warning.contains("permite o resto"), "{warning}");
    }

    #[test]
    fn the_three_postures_are_distinguishable_by_strength() {
        // `is_enforced` responde sim para dois deles, e e por isso que ele nao
        // basta para decidir o que dizer ao usuario e ao modelo.
        assert_eq!(
            detect_on(Platform::Linux, &everything_available).strength(),
            Strength::Restrictive
        );
        assert_eq!(
            detect_on(Platform::MacOs, &everything_available).strength(),
            Strength::Permissive
        );
        assert_eq!(
            detect_on(Platform::Other, &everything_available).strength(),
            Strength::Absent
        );
    }

    #[test]
    fn the_compiled_platform_is_reported_honestly() {
        let current = Platform::current();
        if cfg!(target_os = "linux") {
            assert_eq!(current, Platform::Linux);
        } else if cfg!(target_os = "macos") {
            assert_eq!(current, Platform::MacOs);
        } else {
            assert_eq!(current, Platform::Other);
        }
        // `detect` delega para `detect_on` com a plataforma corrente.
        assert_eq!(
            detect(&nothing_available),
            detect_on(current, &nothing_available)
        );
    }

    /// Escreve um arquivo com o bit de execução pedido.
    fn plant(dir: &std::path::Path, name: &str, executable: bool) -> std::path::PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, "#!/bin/sh\nexit 0").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = if executable { 0o755 } else { 0o644 };
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode)).unwrap();
        }
        path
    }

    #[test]
    fn a_file_without_the_execute_bit_is_not_a_sandbox_binary() {
        // Aceita-lo faria `is_enforced()` prometer confinamento e o spawn falhar
        // depois — a garantia ja teria sido dada ao usuario.
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_executable(&plant(dir.path(), "sem-bit", false)));
        assert!(is_executable(&plant(dir.path(), "com-bit", true)));
    }

    #[test]
    fn a_directory_named_like_the_binary_is_not_a_sandbox_binary() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("bwrap")).unwrap();
        assert!(!is_executable(&dir.path().join("bwrap")));
    }

    #[test]
    fn a_binary_planted_ahead_in_the_path_does_not_win_over_the_system_one() {
        // E o ataque que o SYSTEM_DIRS existe para fechar: um `bwrap` do
        // atacante mais cedo no PATH desligaria o confinamento em silencio, com
        // `is_enforced()` continuando a dizer que ha sandbox.
        let sistema = tempfile::tempdir().unwrap();
        let atacante = tempfile::tempdir().unwrap();
        let verdadeiro = plant(sistema.path(), "bwrap", true);
        plant(atacante.path(), "bwrap", true);

        let achado = which_within(
            "bwrap",
            &[sistema.path().to_str().unwrap()],
            Some(atacante.path().as_os_str()),
        );

        assert_eq!(achado.as_deref(), Some(verdadeiro.as_path()));
    }

    #[test]
    fn the_path_still_answers_when_the_system_directories_do_not() {
        // Nem toda distribuicao instala nos mesmos lugares; recusar o PATH
        // trocaria uma protecao por uma pane.
        let atacante = tempfile::tempdir().unwrap();
        let unico = plant(atacante.path(), "bwrap", true);

        let achado = which_within("bwrap", &[], Some(atacante.path().as_os_str()));
        assert_eq!(achado.as_deref(), Some(unico.as_path()));
    }

    #[test]
    fn without_a_path_and_without_system_directories_nothing_is_found() {
        assert!(which_within("bwrap", &[], None).is_none());
    }

    #[test]
    fn looking_for_a_program_that_cannot_exist_finds_nothing() {
        assert!(which("nycode-programa-que-nao-existe-mesmo").is_none());
    }

    #[test]
    fn detecting_from_the_real_path_always_produces_an_answer() {
        let found = detect_from_path();
        assert!(found.is_enforced() || found.warning().is_some());
    }
}
