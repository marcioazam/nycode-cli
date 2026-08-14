//! De um processo terminado ao texto que chega ao modelo.
//!
//! Separado do lançamento porque muda por outro motivo: [`super`] muda quando
//! muda como o comando sobe e o que o contém, isto muda quando muda o que o
//! modelo precisa ler para decidir o passo seguinte.

use std::fmt::Write as _;

use super::capture::{Captured, Finished};
use crate::policy::confinement::sandbox::Strength;
use crate::tool::ToolOutput;

/// Teto de saída capturada, por canal.
///
/// A saída vai inteira para o contexto do modelo. Um `find /` despejaria a
/// janela inteira e empurraria para fora o histórico que interessa. O corte
/// acontece durante a leitura, em [`super::capture`], e não aqui: um teto que
/// só valesse depois limitaria o que o modelo lê e não o que o processo ocupa.
pub const MAX_OUTPUT: usize = 64 * 1024;

/// Aviso que acompanha a saída de um comando que rodou solto.
pub const UNCONFINED: &str = "[sem confinamento do sistema operacional]";

/// Aviso de uma política que permite por omissão.
///
/// Separado de [`UNCONFINED`] porque o modelo decide diferente nos dois casos, e
/// colapsá-los faria o perfil do macOS ser lido como o do Linux.
pub const PARTIALLY_CONFINED: &str =
    "[confinamento parcial: a politica permite por omissao e nega uma lista]";

/// Monta o resultado que volta ao modelo.
///
/// Um comando que falhou chega marcado como erro, senão o modelo segue como se
/// o teste tivesse passado.
#[must_use]
pub fn render(output: &Finished, strength: Strength) -> ToolOutput {
    let mut rendered = String::new();
    append_section(&mut rendered, "stdout", &output.stdout);
    append_section(&mut rendered, "stderr", &output.stderr);

    match output.status.code() {
        Some(0) => {
            if rendered.is_empty() {
                // String vazia faria o modelo achar que a ferramenta falhou.
                rendered.push_str("(sem saida)");
            }
            ToolOutput::ok(noting_confinement(rendered, strength))
        }
        Some(code) => ToolOutput::error(noting_confinement(
            format!("codigo de saida {code}\n{rendered}"),
            strength,
        )),
        None => ToolOutput::error(noting_confinement(
            format!("terminado por sinal\n{rendered}"),
            strength,
        )),
    }
}

/// Anexa à resposta o que o confinamento do comando de fato garantiu.
///
/// É a segunda metade do não negociável da
/// [ADR-0005](../../../../../docs/architecture/decisions/0005-sandbox-de-so-por-processo-auxiliar.md):
/// o aviso em `stderr` fala com o usuário, isto fala com o modelo. Sem ele o
/// modelo raciocina sobre um comando que acredita contido e propõe o passo
/// seguinte com base nisso — a diferença entre "protegido" e "achou que estava
/// protegido", vista do outro lado.
///
/// São três estados e não dois porque uma política que permite por omissão não
/// sustenta a mesma conclusão que uma que nega (FR-8).
fn noting_confinement(rendered: String, strength: Strength) -> String {
    match strength {
        Strength::Restrictive => rendered,
        Strength::Permissive => format!("{PARTIALLY_CONFINED}\n{rendered}"),
        Strength::Absent => format!("{UNCONFINED}\n{rendered}"),
    }
}

/// Escreve um canal, dizendo o que ficou de fora.
///
/// O que sobrou é a **cauda**, e a mensagem diz isso: sem essa palavra o modelo
/// leria a primeira linha do bloco como a primeira linha do comando, e
/// concluiria que o build começou pelo erro.
fn append_section(out: &mut String, label: &str, captured: &Captured) {
    if captured.is_empty() {
        return;
    }
    let text = captured.text();

    let _ = write!(out, "--- {label} ---\n{text}");
    if !text.ends_with('\n') {
        out.push('\n');
    }
    if captured.truncated() {
        let _ = writeln!(
            out,
            "[truncado: estes sao os ultimos {MAX_OUTPUT} bytes; {label} tem {}]",
            captured.total()
        );
        // O que ficou de fora continua alcançável, e o modelo precisa do
        // caminho para ler o erro que passou do teto.
        if let Some(path) = captured.spilled() {
            let _ = writeln!(out, "[o restante esta em {}]", path.display());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::process::ExitStatusExt as _;

    fn finished(code: i32, stdout: &str, stderr: &str) -> Finished {
        Finished {
            status: std::process::ExitStatus::from_raw(code << 8),
            stdout: Captured::of(stdout.as_bytes(), stdout.len() as u64),
            stderr: Captured::of(stderr.as_bytes(), stderr.len() as u64),
        }
    }

    /// Uma saída maior do que coube, com só a cauda guardada.
    fn truncado(kept: &str, total: u64) -> Finished {
        Finished {
            status: std::process::ExitStatus::from_raw(0),
            stdout: Captured::of(kept.as_bytes(), total),
            stderr: Captured::default(),
        }
    }

    #[test]
    fn a_confined_command_says_nothing_about_confinement() {
        // O aviso e para a excecao; repeti-lo no caso normal so gastaria a
        // janela e ensinaria o modelo a ignora-lo.
        let out = render(&finished(0, "ola\n", ""), Strength::Restrictive);
        assert!(!out.content.contains(UNCONFINED), "{}", out.content);
    }

    #[test]
    fn an_unconfined_command_tells_the_model_it_was_unconfined() {
        // ADR-0005: a resposta do modelo carrega o fato. Sem isto ele raciocina
        // sobre um comando que acredita contido.
        let out = render(&finished(0, "ola\n", ""), Strength::Absent);
        assert!(out.content.starts_with(UNCONFINED), "{}", out.content);
        assert!(out.content.contains("ola"), "{}", out.content);
    }

    #[test]
    fn a_policy_that_allows_by_default_is_not_reported_as_one_that_denies() {
        // FR-8. Um perfil que nega uma lista e permite o resto nao sustenta a
        // mesma conclusao que um namespace que so liga o que foi pedido, e
        // colapsar os dois em "confinado" faz o modelo raciocinar sobre uma
        // garantia que nao recebeu.
        let parcial = render(&finished(0, "ola\n", ""), Strength::Permissive);
        assert!(
            parcial.content.starts_with(PARTIALLY_CONFINED),
            "{}",
            parcial.content
        );
        assert!(
            !parcial.content.contains(UNCONFINED),
            "parcial nao e ausente: {}",
            parcial.content
        );

        let restrito = render(&finished(0, "ola\n", ""), Strength::Restrictive);
        assert!(
            !restrito.content.contains(PARTIALLY_CONFINED),
            "{}",
            restrito.content
        );
    }

    #[test]
    fn a_partially_confined_failure_carries_both_facts() {
        let out = render(&finished(3, "", "quebrou\n"), Strength::Permissive);
        assert!(out.is_error);
        assert!(out.content.contains(PARTIALLY_CONFINED), "{}", out.content);
        assert!(out.content.contains("codigo de saida 3"), "{}", out.content);
    }

    #[test]
    fn an_unconfined_failure_carries_the_note_and_stays_an_error() {
        // O aviso nao pode encobrir a falha: as duas informacoes sao
        // independentes e o modelo precisa das duas.
        let out = render(&finished(3, "", "quebrou\n"), Strength::Absent);
        assert!(out.is_error);
        assert!(out.content.contains(UNCONFINED), "{}", out.content);
        assert!(out.content.contains("codigo de saida 3"), "{}", out.content);
    }

    #[test]
    fn a_silent_successful_command_says_it_produced_nothing() {
        let out = render(&finished(0, "", ""), Strength::Restrictive);
        assert!(!out.is_error);
        assert_eq!(out.content, "(sem saida)");
    }

    #[test]
    fn oversized_output_is_truncated_and_says_the_real_size() {
        // Truncar em silencio faria o modelo raciocinar sobre uma saida que ele
        // acha que leu inteira.
        let total = (MAX_OUTPUT + 500) as u64;
        let out = render(
            &truncado(&"x".repeat(MAX_OUTPUT), total),
            Strength::Restrictive,
        );

        assert!(out.content.contains("[truncado"), "truncamento ausente");
        assert!(
            out.content.contains(&total.to_string()),
            "o tamanho real precisa aparecer: {}",
            out.content
        );
    }

    #[test]
    fn a_truncated_output_says_which_end_survived() {
        // Sem a palavra, o modelo le a primeira linha do bloco como a primeira
        // linha do comando e conclui que o build comecou pelo erro.
        let out = render(&truncado("fim", 9000), Strength::Restrictive);
        assert!(out.content.contains("ultimos"), "{}", out.content);
    }

    #[test]
    fn output_that_fit_says_nothing_about_truncation() {
        // O aviso e para a excecao; no caso normal so gastaria a janela.
        let out = render(&finished(0, "curto\n", ""), Strength::Restrictive);
        assert!(!out.content.contains("[truncado"), "{}", out.content);
    }

    #[test]
    fn both_streams_are_labelled() {
        let out = render(&finished(0, "saida\n", "erro\n"), Strength::Restrictive);
        assert!(out.content.contains("--- stdout ---"), "{}", out.content);
        assert!(out.content.contains("--- stderr ---"), "{}", out.content);
    }
}
