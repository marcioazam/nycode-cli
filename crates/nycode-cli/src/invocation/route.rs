//! Qual superfície o pedido quer.
//!
//! Separado do ponto de entrada porque a escolha é função pura dos argumentos e
//! do ambiente, e assim é verificável sem depender de o teste estar rodando com
//! ou sem TTY. Ao `main` fica o que só o dono do processo pode fazer: construir
//! o runtime e tomar posse do terminal.

use std::time::Duration;

/// A superfície escolhida.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    /// Um prompt, uma resposta.
    Headless(String),
    Interactive,
    /// Monta a sessão, mantém-na ociosa pelo tempo pedido e sai.
    Probe(Duration),
    /// Pediu sessão interativa onde não há terminal.
    NoTerminal,
}

/// Escolhe a superfície.
pub fn choose(probe: Option<u64>, prompt: Option<String>, has_terminal: bool) -> Route {
    // A sonda vence prompt e terminal. Quem a pede quer medir a montagem da
    // sessão, e tanto gastar um turno quanto tomar posse do terminal mediriam
    // outra coisa — além de exigir gateway e TTY para uma medição que não
    // depende de nenhum dos dois.
    if let Some(idle) = probe {
        return Route::Probe(Duration::from_millis(idle));
    }
    match prompt {
        Some(prompt) => Route::Headless(prompt),
        // Sem terminal não há sessão interativa: `echo x | nycode` abriria um
        // prompt que ninguém pode responder. Dizer isso é melhor que pendurar.
        None if has_terminal => Route::Interactive,
        None => Route::NoTerminal,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn a_prompt_goes_headless_with_or_without_a_terminal() {
        // `nycode -p` num pipe e o caso de automacao; exigir TTY o quebraria.
        for has_terminal in [true, false] {
            assert_eq!(
                choose(None, Some("oi".to_owned()), has_terminal),
                Route::Headless("oi".to_owned())
            );
        }
    }

    #[test]
    fn no_prompt_opens_a_session_only_where_there_is_a_terminal() {
        assert_eq!(choose(None, None, true), Route::Interactive);
        assert_eq!(choose(None, None, false), Route::NoTerminal);
    }

    #[test]
    fn the_startup_probe_wins_over_every_other_surface() {
        // O gate de performance mede sem gateway e sem TTY. Se um prompt ou um
        // terminal desviasse a sonda, a medicao passaria a exigir os dois, e
        // deixaria de medir a montagem da sessao para medir um turno.
        for has_terminal in [true, false] {
            for prompt in [None, Some("oi".to_owned())] {
                assert_eq!(
                    choose(Some(0), prompt, has_terminal),
                    Route::Probe(Duration::ZERO)
                );
            }
        }
    }

    #[test]
    fn the_probe_holds_the_session_for_as_long_as_it_was_asked_to() {
        // O intervalo e o que separa as duas medicoes: zero para a latencia de
        // NFR-1, algo maior para o pico de memoria de NFR-2. Descarta-lo faria
        // as duas medirem a mesma coisa.
        assert_eq!(
            choose(Some(250), None, false),
            Route::Probe(Duration::from_millis(250))
        );
    }
}
