//! O vocabulário de códigos de saída do processo.
//!
//! Separado do ponto de entrada porque muda por outro motivo: a linha de comando
//! muda quando uma flag entra, isto muda quando o vocabulário de `stop_reason`
//! do gateway muda. Um script que encadeia `nycode` depende deste arquivo e de
//! mais nenhum.

use std::process::ExitCode;

use nycode_ai::StopReason;

/// Código de saída de quem pediu sessão interativa sem terminal.
pub const NO_TERMINAL: u8 = 2;

/// Código de saída de um turno cancelado.
///
/// 130 é a convenção de shell para término por `SIGINT` (128 + 2), o que permite
/// a um script distinguir cancelamento de falha sem parsear a saída.
pub const CANCELLED: u8 = 130;

/// Traduz o motivo de parada em código de saída.
///
/// Uma recusa ou um estouro de limite não são sucesso: um script que encadeia
/// `nycode` precisa conseguir detectar isso sem parsear a saída.
pub fn code_for(stop_reason: &StopReason) -> ExitCode {
    match stop_reason {
        StopReason::EndTurn | StopReason::StopSequence | StopReason::ToolUse => ExitCode::SUCCESS,
        StopReason::Refusal => ExitCode::from(3),
        StopReason::MaxTokens => ExitCode::from(4),
        StopReason::PauseTurn => ExitCode::from(5),
        StopReason::Unrecognized(_) => ExitCode::from(6),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn refusal_and_limits_do_not_exit_zero() {
        // Um script encadeando nycode precisa detectar recusa sem parsear saida.
        assert_ne!(
            format!("{:?}", code_for(&StopReason::Refusal)),
            format!("{:?}", ExitCode::SUCCESS)
        );
        assert_ne!(
            format!("{:?}", code_for(&StopReason::MaxTokens)),
            format!("{:?}", ExitCode::SUCCESS)
        );
        assert_eq!(
            format!("{:?}", code_for(&StopReason::EndTurn)),
            format!("{:?}", ExitCode::SUCCESS)
        );
    }

    #[test]
    fn an_unrecognized_stop_reason_is_not_reported_as_success() {
        assert_ne!(
            format!("{:?}", code_for(&StopReason::Unrecognized("novo".into()))),
            format!("{:?}", ExitCode::SUCCESS)
        );
    }

    #[test]
    fn a_paused_turn_is_not_reported_as_success() {
        // Uma pausa deixa trabalho por terminar; um script que a lesse como
        // sucesso seguiria em frente com a tarefa pela metade.
        assert_ne!(
            format!("{:?}", code_for(&StopReason::PauseTurn)),
            format!("{:?}", ExitCode::SUCCESS)
        );
        assert_eq!(
            format!("{:?}", code_for(&StopReason::PauseTurn)),
            format!("{:?}", ExitCode::from(5))
        );
    }

    #[test]
    fn every_stop_reason_maps_to_a_distinct_exit_code() {
        // Codigos colididos tornariam impossivel a um script distinguir recusa
        // de estouro de limite sem parsear a saida.
        let codes = [
            StopReason::Refusal,
            StopReason::MaxTokens,
            StopReason::PauseTurn,
            StopReason::Unrecognized("novo".into()),
        ]
        .iter()
        .map(|reason| format!("{:?}", code_for(reason)))
        .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(codes.len(), 4);
    }

    #[test]
    fn a_cancelled_turn_gets_its_own_exit_code() {
        // 130 e a convencao de shell para SIGINT. Colidir com 1 faria um script
        // tratar "o usuario desistiu" como "o comando falhou".
        assert_eq!(CANCELLED, 130);
        let distinct = [
            format!("{:?}", ExitCode::SUCCESS),
            format!("{:?}", ExitCode::FAILURE),
            format!("{:?}", ExitCode::from(NO_TERMINAL)),
            format!("{:?}", code_for(&StopReason::Refusal)),
            format!("{:?}", code_for(&StopReason::MaxTokens)),
            format!("{:?}", code_for(&StopReason::PauseTurn)),
            format!("{:?}", code_for(&StopReason::Unrecognized("x".into()))),
            format!("{:?}", ExitCode::from(CANCELLED)),
        ]
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(distinct.len(), 8, "todo codigo de saida precisa ser unico");
    }
}
