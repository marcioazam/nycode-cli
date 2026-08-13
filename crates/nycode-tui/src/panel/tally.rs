//! Contabilidade acumulada de uma sessão.
//!
//! Separado de [`super`] porque muda por outro motivo: aquele muda quando muda
//! o que o rodapé mostra e como, e isto muda quando muda o que se conta — e o
//! que se conta veio de fora, do stream e do catálogo.

/// Contabilidade acumulada de uma sessão.
///
/// Sem `Eq`: o custo é ponto flutuante, e igualdade exata de `f64` não é uma
/// relação de equivalência.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Tally {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    /// Custo acumulado, quando o catálogo declara preço para o modelo.
    ///
    /// `None` é dizer que não se sabe, e o rodapé cala em vez de mostrar zero.
    /// Um custo zerado ao lado de uma contagem grande seria lido como grátis.
    pub cost: Option<f64>,
    /// Verdadeiro se qualquer turno reportou usage estimado.
    ///
    /// Propagar isto é o que impede um número heurístico de ser apresentado
    /// como medido.
    pub estimated: bool,
    /// Tokens que já estavam no prefixo e foram cobrados de novo.
    ///
    /// A taxa de acerto sozinha diz que o cache errou; ela não diz o tamanho do
    /// erro. Um turno com 90% de acerto sobre um contexto de cem mil tokens
    /// repaga dez mil, e o rodapé mostrava só o `90%`.
    pub repaid_tokens: u64,
    /// Tamanho do prompt do turno anterior.
    previous_prompt: u64,
}

/// Repagamento até aqui é granularidade do ponto de corte, não erro.
///
/// O marcador de cache cobre até uma fronteira de bloco, então um punhado de
/// tokens sempre fica de fora. Contá-los faria o rodapé acusar desperdício em
/// toda sessão saudável, e um alarme que soa sempre é um alarme desligado.
const NOISE_FLOOR: u64 = 1024;

impl Tally {
    /// Soma o usage de mais um turno.
    pub const fn absorb(&mut self, input: u64, output: u64, cache_read: u64, cache_write: u64) {
        // O que este turno mandou de prompt. O que se sobrepõe ao turno
        // anterior deveria ter vindo do cache; o que não veio, foi repago.
        let prompt = input + cache_read + cache_write;
        let overlap = if self.previous_prompt < prompt {
            self.previous_prompt
        } else {
            prompt
        };
        let repaid = overlap.saturating_sub(cache_read);
        if repaid > NOISE_FLOOR {
            self.repaid_tokens += repaid;
        }
        self.previous_prompt = prompt;

        self.input_tokens += input;
        self.output_tokens += output;
        self.cache_read_tokens += cache_read;
        self.cache_write_tokens += cache_write;
    }

    /// Soma o custo de mais um turno.
    ///
    /// Separado de [`Self::absorb`] porque a origem é outra: os tokens vêm do
    /// stream, e o preço vem do catálogo — e um modelo sem preço declarado
    /// continua somando tokens sem somar custo.
    pub const fn absorb_cost(&mut self, cost: f64) {
        self.cost = Some(match self.cost {
            Some(accumulated) => accumulated + cost,
            None => cost,
        });
    }

    /// Declara que o contexto mudou de propósito.
    ///
    /// Depois de uma compactação o prompt seguinte é conteúdo novo, e não
    /// conteúdo recobrado: contá-lo como repagamento acusaria desperdício
    /// justamente onde o harness fez a coisa certa. Trocar de modelo **não**
    /// zera — ali o prompt é o mesmo e é cobrado de novo de verdade.
    pub const fn forget_prefix(&mut self) {
        self.previous_prompt = 0;
    }

    /// Fração dos tokens de entrada servida de cache, em porcentagem.
    ///
    /// `None` quando não houve entrada: zero por cento e "não houve pedido" são
    /// coisas diferentes, e mostrar `0%` num rodapé recém-aberto sugeriria que
    /// o cache está falhando.
    #[must_use]
    pub fn cache_hit_rate(&self) -> Option<f64> {
        if self.input_tokens == 0 {
            return None;
        }
        #[allow(clippy::cast_precision_loss)]
        Some((self.cache_read_tokens as f64 / self.input_tokens as f64) * 100.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Um turno com prefixo servido de cache.
    fn hit(prompt: u64) -> (u64, u64, u64, u64) {
        (0, 100, prompt, 0)
    }

    #[test]
    fn a_prefix_served_from_cache_costs_nothing_to_repay() {
        let mut tally = Tally::default();
        tally.absorb(0, 100, 0, 50_000);
        let (i, o, r, w) = hit(50_000);
        tally.absorb(i, o, r, w);

        assert_eq!(tally.repaid_tokens, 0);
    }

    #[test]
    fn a_prefix_billed_again_is_counted() {
        // A taxa sozinha diz que o cache errou e nao diz o tamanho do erro: um
        // turno com 90% de acerto sobre cem mil tokens repaga dez mil.
        let mut tally = Tally::default();
        tally.absorb(0, 100, 0, 100_000);
        tally.absorb(10_000, 100, 90_000, 0);

        assert_eq!(tally.repaid_tokens, 10_000);
    }

    #[test]
    fn a_handful_of_tokens_is_granularity_and_not_waste() {
        // O marcador cobre ate uma fronteira de bloco; contar o resto faria o
        // rodape acusar desperdicio em toda sessao saudavel.
        let mut tally = Tally::default();
        tally.absorb(0, 100, 0, 50_000);
        tally.absorb(500, 100, 49_500, 0);

        assert_eq!(tally.repaid_tokens, 0);
    }

    #[test]
    fn compaction_does_not_count_as_waste() {
        // Depois de compactar o prompt seguinte e conteudo novo, e nao
        // conteudo recobrado.
        let mut tally = Tally::default();
        tally.absorb(0, 100, 0, 100_000);
        tally.forget_prefix();
        tally.absorb(20_000, 100, 0, 20_000);

        assert_eq!(tally.repaid_tokens, 0);
    }

    #[test]
    fn a_growing_context_only_counts_what_overlapped() {
        // O turno seguinte e maior; o que excede o anterior e conteudo novo e
        // nao pode entrar na conta de repagamento.
        let mut tally = Tally::default();
        tally.absorb(0, 100, 0, 10_000);
        tally.absorb(30_000, 100, 0, 0);

        assert_eq!(tally.repaid_tokens, 10_000, "so a sobreposicao");
    }

    #[test]
    fn the_cache_rate_is_absent_rather_than_zero_before_the_first_turn() {
        assert_eq!(Tally::default().cache_hit_rate(), None);

        let mut tally = Tally::default();
        tally.absorb(200, 0, 50, 0);
        assert_eq!(tally.cache_hit_rate(), Some(25.0));
    }

    #[test]
    fn absorbing_accumulates_across_turns() {
        let mut tally = Tally::default();
        tally.absorb(100, 10, 40, 60);
        tally.absorb(100, 20, 60, 0);
        assert_eq!(tally.input_tokens, 200);
        assert_eq!(tally.output_tokens, 30);
        assert_eq!(tally.cache_read_tokens, 100);
        assert_eq!(tally.cache_write_tokens, 60);
    }

    #[test]
    fn a_model_without_a_declared_price_accumulates_no_cost() {
        // `None` e "nao sei". Um zero acumulado seria lido como gratis.
        let mut tally = Tally::default();
        tally.absorb(1_000, 500, 0, 0);
        assert_eq!(tally.cost, None);
    }

    #[test]
    fn cost_accumulates_across_turns_once_a_price_is_known() {
        let mut tally = Tally::default();
        tally.absorb_cost(0.10);
        tally.absorb_cost(0.05);
        assert!((tally.cost.unwrap() - 0.15).abs() < 1e-9);
    }
}
