//! Quanto cada etapa da montagem da sessão custou.
//!
//! O gate de performance mede a sessão montada e dá um número só
//! ([ADR-0013](../../../../docs/architecture/decisions/0013-o-gate-mede-a-sessao-montada-e-nao-o-version.md)),
//! e um número só diz que regrediu sem dizer onde. Resolver credencial, varrer o
//! workspace, indexar a sessão, buscar o catálogo e subir os servidores MCP têm
//! causas de regressão diferentes e correções diferentes; um salto de 2 ms é
//! ação imediata se for a varredura e é o esperado se for um servidor novo.
//!
//! O custo de medir é uma leitura de relógio por etapa, contra um orçamento de
//! 15 ms. Fica sempre ligado porque o valor está justamente em ter o número do
//! dia em que a regressão aparece, e não em poder pedi-lo depois.

use std::time::{Duration, Instant};

/// As etapas da montagem, na ordem em que rodaram.
#[derive(Debug, Default, Clone)]
pub struct Phases {
    marks: Vec<(&'static str, Duration)>,
    last: Option<Instant>,
}

impl Phases {
    /// Começa a contar.
    #[must_use]
    pub fn start() -> Self {
        Self {
            marks: Vec::new(),
            last: Some(Instant::now()),
        }
    }

    /// Fecha a etapa que acabou de rodar.
    pub fn mark(&mut self, name: &'static str) {
        let now = Instant::now();
        if let Some(last) = self.last.replace(now) {
            self.marks.push((name, now.duration_since(last)));
        }
    }

    /// Uma linha com cada etapa em microssegundos.
    ///
    /// Microssegundos e não milissegundos: no regime em que este binário opera,
    /// uma etapa de 300 µs arredondada para `0ms` é uma etapa invisível, e são
    /// justamente as pequenas que somam.
    #[must_use]
    pub fn report(&self) -> String {
        self.marks
            .iter()
            .map(|(name, took)| format!("{name}={}us", took.as_micros()))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn each_marked_phase_appears_named_in_the_report() {
        // Sem o nome o relatorio volta a ser um numero so, que e o que ele
        // existe para deixar de ser.
        let mut phases = Phases::start();
        phases.mark("credencial");
        phases.mark("workspace");

        let report = phases.report();
        assert!(report.contains("credencial="), "{report}");
        assert!(report.contains("workspace="), "{report}");
        assert_eq!(report.split_whitespace().count(), 2);
    }

    #[test]
    fn phases_are_reported_in_the_order_they_ran() {
        // A ordem e a informacao: ela diz qual etapa empurrou as seguintes.
        let mut phases = Phases::start();
        phases.mark("primeira");
        phases.mark("segunda");

        let report = phases.report();
        let primeira = report.find("primeira").unwrap();
        let segunda = report.find("segunda").unwrap();
        assert!(primeira < segunda, "{report}");
    }

    #[test]
    fn a_run_that_marked_nothing_reports_nothing() {
        assert!(Phases::start().report().is_empty());
        assert!(Phases::default().report().is_empty());
    }

    #[test]
    fn the_unit_is_microseconds_because_a_rounded_millisecond_hides_the_phase() {
        let mut phases = Phases::start();
        phases.mark("rapida");
        assert!(phases.report().ends_with("us"), "{}", phases.report());
    }
}
