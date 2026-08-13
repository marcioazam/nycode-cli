//! Preço por modelo, e o custo que ele produz sobre uma contabilidade.
//!
//! O FR-19 promete que "o custo acumulado da sessão é visível a qualquer
//! momento", e estava marcado entregue. O que existia era contagem de tokens —
//! volume, não custo. As duas grandezas divergem por mais de uma ordem de
//! magnitude entre modelos, e a decisão que o número deveria informar, que é se
//! vale trocar de modelo agora, depende do preço.
//!
//! O preço vem do catálogo descoberto e nunca do binário
//! ([ADR-0026](../../../../docs/architecture/decisions/0026-o-preco-vem-do-catalogo-descoberto.md)):
//! o FR-6 proíbe lista fixa, e uma tabela de tarifas compilada envelheceria a
//! cada mudança de preço sem ninguém perceber.

use serde::{Deserialize, Serialize};

use crate::event::Usage;

/// Tarifas em unidade monetária por milhão de tokens.
///
/// Milhão, e não token, porque é a unidade em que os provedores publicam — e
/// converter na leitura esconderia o número que dá para conferir contra a
/// fatura.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Rates {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

/// Uma faixa de preço que passa a valer acima de certo tamanho de entrada.
///
/// A faixa escolhida vale para o **pedido inteiro**, não só para o excedente.
/// Tratá-la como progressiva daria um número menor que a fatura.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Tier {
    pub above_input_tokens: u64,
    pub rates: Rates,
}

/// O preço de um modelo.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Price {
    pub base: Rates,
    /// Faixas adicionais, da menor para a maior. Vazio é o caso comum.
    #[serde(default)]
    pub tiers: Vec<Tier>,
}

/// O que um turno custou, por componente.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Cost {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

impl Cost {
    #[must_use]
    pub fn total(&self) -> f64 {
        self.input + self.output + self.cache_read + self.cache_write
    }
}

impl Price {
    /// As tarifas que valem para uma entrada deste tamanho.
    ///
    /// A entrada que decide a faixa inclui o que foi lido e escrito em cache:
    /// é tudo que o provedor conta como entrada do pedido.
    #[must_use]
    pub fn rates_for(&self, input_tokens: u64) -> Rates {
        self.tiers
            .iter()
            .filter(|tier| input_tokens > tier.above_input_tokens)
            .max_by_key(|tier| tier.above_input_tokens)
            .map_or(self.base, |tier| tier.rates)
    }

    /// O custo de uma contabilidade sob este preço.
    ///
    /// Uma escrita de cache de retenção longa é cobrada ao **dobro da tarifa de
    /// entrada**, e não à tarifa de escrita de cache. É regra do provedor, não
    /// se deduz da estrutura de preços, e ignorá-la subestima a fatura de toda
    /// sessão longa — que é justamente onde a retenção longa é usada.
    #[must_use]
    pub fn cost(&self, usage: Usage) -> Cost {
        let charged_input = usage.input_tokens + usage.cache_read_tokens + usage.cache_write_tokens;
        let rates = self.rates_for(charged_input);

        let long = usage.cache_write_1h_tokens.min(usage.cache_write_tokens);
        let short = usage.cache_write_tokens - long;

        Cost {
            input: per_million(rates.input, usage.input_tokens),
            output: per_million(rates.output, usage.output_tokens),
            cache_read: per_million(rates.cache_read, usage.cache_read_tokens),
            cache_write: per_million(rates.cache_write, short)
                + per_million(rates.input * 2.0, long),
        }
    }
}

#[expect(
    clippy::cast_precision_loss,
    reason = "contagem de tokens cabe folgada na mantissa de f64; o erro so apareceria acima de 2^53 tokens"
)]
fn per_million(rate: f64, tokens: u64) -> f64 {
    rate * tokens as f64 / 1_000_000.0
}

/// Lê o preço de uma entrada de catálogo.
///
/// Devolve `None` quando o endpoint não declara preço. Estimar por família de
/// modelo daria um número inventado com a mesma confiança de um medido, e a
/// ausência o usuário percebe — o valor errado, não.
#[must_use]
pub fn parse(raw: &serde_json::Value) -> Option<Price> {
    let node = raw.get("cost").or_else(|| raw.get("pricing"))?;
    let base = rates(node)?;

    let tiers = node
        .get("tiers")
        .and_then(serde_json::Value::as_array)
        .map(|list| list.iter().filter_map(tier).collect())
        .unwrap_or_default();

    Some(Price { base, tiers })
}

fn rates(node: &serde_json::Value) -> Option<Rates> {
    let number = |names: &[&str]| -> f64 {
        names
            .iter()
            .find_map(|name| node.get(*name).and_then(serde_json::Value::as_f64))
            .unwrap_or(0.0)
    };

    // Um no de preco sem entrada nem saida nao e preco; aceita-lo produziria
    // custo zero em toda sessao, que e pior que dizer que nao sabe.
    let input = number(&["input", "input_tokens", "prompt"]);
    let output = number(&["output", "output_tokens", "completion"]);
    if input == 0.0 && output == 0.0 {
        return None;
    }

    Some(Rates {
        input,
        output,
        cache_read: number(&["cache_read", "cacheRead", "cached_input"]),
        cache_write: number(&["cache_write", "cacheWrite"]),
    })
}

fn tier(raw: &serde_json::Value) -> Option<Tier> {
    Some(Tier {
        above_input_tokens: raw
            .get("above_input_tokens")
            .or_else(|| raw.get("inputTokensAbove"))
            .and_then(serde_json::Value::as_u64)?,
        rates: rates(raw)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn price() -> Price {
        Price {
            base: Rates {
                input: 3.0,
                output: 15.0,
                cache_read: 0.3,
                cache_write: 3.75,
            },
            tiers: Vec::new(),
        }
    }

    fn usage(input: u64, output: u64) -> Usage {
        Usage {
            input_tokens: input,
            output_tokens: output,
            ..Usage::default()
        }
    }

    #[test]
    fn a_turn_costs_the_rate_times_the_tokens_over_a_million() {
        let cost = price().cost(usage(1_000_000, 1_000_000));
        assert!((cost.input - 3.0).abs() < 1e-9, "{}", cost.input);
        assert!((cost.output - 15.0).abs() < 1e-9, "{}", cost.output);
        assert!((cost.total() - 18.0).abs() < 1e-9);
    }

    #[test]
    fn a_turn_with_no_tokens_costs_nothing() {
        assert!((price().cost(Usage::default()).total()).abs() < 1e-12);
    }

    #[test]
    fn a_long_retention_cache_write_is_charged_at_double_the_input_rate() {
        // Regra do provedor, nao dedutivel da estrutura de precos. Ignora-la
        // subestima a fatura de toda sessao longa.
        let cost = price().cost(Usage {
            cache_write_tokens: 1_000_000,
            cache_write_1h_tokens: 1_000_000,
            ..Usage::default()
        });
        assert!(
            (cost.cache_write - 6.0).abs() < 1e-9,
            "{}",
            cost.cache_write
        );
    }

    #[test]
    fn a_short_retention_cache_write_uses_the_cache_write_rate() {
        let cost = price().cost(Usage {
            cache_write_tokens: 1_000_000,
            ..Usage::default()
        });
        assert!(
            (cost.cache_write - 3.75).abs() < 1e-9,
            "{}",
            cost.cache_write
        );
    }

    #[test]
    fn a_mixed_cache_write_charges_each_half_at_its_own_rate() {
        let cost = price().cost(Usage {
            cache_write_tokens: 1_000_000,
            cache_write_1h_tokens: 400_000,
            ..Usage::default()
        });
        // 600k curtos a 3.75 mais 400k longos a 6.00.
        assert!(
            (cost.cache_write - (2.25 + 2.4)).abs() < 1e-9,
            "{}",
            cost.cache_write
        );
    }

    #[test]
    fn a_long_write_larger_than_the_total_write_cannot_charge_twice() {
        // Um backend que reporte numeros inconsistentes nao deve produzir
        // custo maior que o volume que ele mesmo declarou.
        let cost = price().cost(Usage {
            cache_write_tokens: 1_000,
            cache_write_1h_tokens: 999_999,
            ..Usage::default()
        });
        assert!(cost.cache_write <= per_million(6.0, 1_000) + 1e-12);
    }

    #[test]
    fn the_tier_that_applies_covers_the_whole_request_not_just_the_excess() {
        // Tratar a faixa como progressiva daria um numero menor que a fatura.
        let tiered = Price {
            base: Rates {
                input: 3.0,
                ..Rates::default()
            },
            tiers: vec![Tier {
                above_input_tokens: 200_000,
                rates: Rates {
                    input: 6.0,
                    ..Rates::default()
                },
            }],
        };

        let cost = tiered.cost(usage(1_000_000, 0));
        assert!((cost.input - 6.0).abs() < 1e-9, "{}", cost.input);
    }

    #[test]
    fn below_the_tier_the_base_rate_applies() {
        let tiered = Price {
            base: Rates {
                input: 3.0,
                ..Rates::default()
            },
            tiers: vec![Tier {
                above_input_tokens: 200_000,
                rates: Rates {
                    input: 6.0,
                    ..Rates::default()
                },
            }],
        };
        assert!((tiered.rates_for(199_999).input - 3.0).abs() < 1e-9);
    }

    #[test]
    fn the_highest_matching_tier_wins() {
        let tiered = Price {
            base: Rates::default(),
            tiers: vec![
                Tier {
                    above_input_tokens: 100_000,
                    rates: Rates {
                        input: 6.0,
                        ..Rates::default()
                    },
                },
                Tier {
                    above_input_tokens: 500_000,
                    rates: Rates {
                        input: 9.0,
                        ..Rates::default()
                    },
                },
            ],
        };
        assert!((tiered.rates_for(600_000).input - 9.0).abs() < 1e-9);
    }

    #[test]
    fn the_tier_is_decided_by_everything_the_provider_counts_as_input() {
        // Cache lido e escrito tambem e entrada do pedido; ignora-los escolheria
        // uma faixa mais barata que a cobrada.
        let tiered = Price {
            base: Rates {
                input: 3.0,
                cache_read: 1.0,
                ..Rates::default()
            },
            tiers: vec![Tier {
                above_input_tokens: 200_000,
                rates: Rates {
                    input: 6.0,
                    cache_read: 2.0,
                    ..Rates::default()
                },
            }],
        };

        let cost = tiered.cost(Usage {
            input_tokens: 100_000,
            cache_read_tokens: 150_000,
            ..Usage::default()
        });
        assert!((cost.input - 0.6).abs() < 1e-9, "{}", cost.input);
    }

    #[test]
    fn a_catalog_entry_without_a_price_says_so_instead_of_guessing() {
        // Um numero inventado tem a mesma cara de um medido. A ausencia o
        // usuario percebe; o valor errado, nao.
        assert_eq!(parse(&json!({ "id": "m" })), None);
        assert_eq!(parse(&json!({ "id": "m", "cost": {} })), None);
    }

    #[test]
    fn a_price_is_read_from_either_spelling_the_endpoints_use() {
        let from_cost = parse(&json!({ "cost": { "input": 3.0, "output": 15.0 } })).unwrap();
        let from_pricing =
            parse(&json!({ "pricing": { "prompt": 3.0, "completion": 15.0 } })).unwrap();
        assert!((from_cost.base.input - from_pricing.base.input).abs() < 1e-9);
        assert!((from_cost.base.output - from_pricing.base.output).abs() < 1e-9);
    }

    #[test]
    fn cache_rates_are_read_when_declared() {
        let price = parse(&json!({
            "cost": { "input": 3.0, "output": 15.0, "cache_read": 0.3, "cache_write": 3.75 }
        }))
        .unwrap();
        assert!((price.base.cache_read - 0.3).abs() < 1e-9);
        assert!((price.base.cache_write - 3.75).abs() < 1e-9);
    }

    #[test]
    fn tiers_are_read_when_declared_and_absent_otherwise() {
        let plain = parse(&json!({ "cost": { "input": 3.0, "output": 15.0 } })).unwrap();
        assert!(plain.tiers.is_empty());

        let tiered = parse(&json!({
            "cost": {
                "input": 3.0,
                "output": 15.0,
                "tiers": [{ "above_input_tokens": 200_000, "input": 6.0, "output": 22.5 }]
            }
        }))
        .unwrap();
        assert_eq!(tiered.tiers.len(), 1);
        assert_eq!(tiered.tiers[0].above_input_tokens, 200_000);
        assert!((tiered.tiers[0].rates.input - 6.0).abs() < 1e-9);
    }

    #[test]
    fn a_tier_without_a_threshold_is_dropped_rather_than_applied_everywhere() {
        let price = parse(&json!({
            "cost": { "input": 3.0, "output": 15.0, "tiers": [{ "input": 6.0 }] }
        }))
        .unwrap();
        assert!(price.tiers.is_empty());
    }
}
