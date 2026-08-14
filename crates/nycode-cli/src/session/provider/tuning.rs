//! O que modula o pedido, e o que o dialeto escolhido não consegue modular.
//!
//! Separado de [`super`] porque muda por outro motivo: aquele muda quando muda
//! a montagem da sessão, e isto muda quando muda o vocabulário de amostragem ou
//! o que cada dialeto aceita.
//!
//! Existe porque `Sampling` e `Client::with_sampling` passaram a vida inteira
//! sem chamador de produção. O tipo estava completo, tinha teste, tinha
//! cobertura acima do piso — e nada no caminho real o construía. Nível de
//! raciocínio, temperatura e sequência de parada eram configuráveis no papel e
//! nunca saíam do processo.

use std::collections::BTreeMap;

use nycode_ai::catalog::Price;
use nycode_ai::{Sampling, ThinkingLevel};

use crate::Cli;

/// Monta a amostragem desta sessão a partir da invocação.
///
/// A chave de cache vem do id da sessão, e não de um valor novo por processo:
/// retomar com `--continue` precisa cair no mesmo balde do backend, senão o
/// prefixo é reescrito e o NFR-7 se perde exatamente na sessão longa, que é a
/// que mais teria a ganhar com ele.
pub fn sampling_for(cli: &Cli, session_id: &str) -> anyhow::Result<Sampling> {
    let mut sampling = Sampling::default().with_cache_key(session_id);

    if let Some(raw) = cli.thinking.as_deref() {
        let level = ThinkingLevel::parse(raw).ok_or_else(|| {
            anyhow::anyhow!(
                "nivel de raciocinio desconhecido: `{raw}`; use off, minimal, low, medium, high, xhigh ou max"
            )
        })?;
        sampling = sampling.with_thinking(level);
    }
    Ok(sampling)
}

/// Indexa por modelo as tarifas que o catálogo declarou.
///
/// Um mapa e não uma varredura na hora de mostrar: o rodapé é redesenhado a
/// cada tecla, e procurar linearmente no catálogo a cada quadro colocaria uma
/// busca no caminho de digitação.
#[must_use]
pub fn prices_of(models: &[nycode_ai::Model]) -> BTreeMap<String, Price> {
    models
        .iter()
        .filter_map(|model| model.price.clone().map(|price| (model.id.clone(), price)))
        .collect()
}

/// Indexa por modelo a janela de contexto que o catálogo declarou.
///
/// Só os modelos que declaram entram: sem número declarado o agente não compara
/// nada, e um valor inventado o faria acusar truncamento onde não houve.
#[must_use]
pub fn windows_of(models: &[nycode_ai::Model]) -> BTreeMap<String, u64> {
    models
        .iter()
        .filter_map(|model| {
            model
                .context_window
                .map(|window| (model.id.clone(), window))
        })
        .collect()
}

/// O que dizer ao usuário sobre o que o dialeto não fará.
///
/// Devolve as linhas em vez de imprimi-las para que o caminho seja testável sem
/// capturar `stderr` — a mesma costura que o resto da montagem usa.
#[must_use]
pub fn caveats(dialect: &str, unsupported: &[&str], sampling: &Sampling) -> Vec<String> {
    let mut lines: Vec<String> = unsupported
        .iter()
        .map(|parametro| {
            format!(
                "nycode: o dialeto `{dialect}` nao emite `{parametro}`; a configuracao foi ignorada"
            )
        })
        .collect();

    // O rebaixamento vem do proprio nivel, e nao de uma comparacao aqui: quem
    // sabe ate onde o dialeto alcanca e a traducao, nao quem a chama.
    if let Some(effort) = sampling.thinking.effort()
        && let Some(pedido) = effort.requested
    {
        lines.push(format!(
            "nycode: o dialeto `{dialect}` nao alcanca o nivel `{pedido}`; o pedido saiu como `{}`",
            effort.name
        ));
    }
    lines
}

/// Conta ao usuário o que [`caveats`] apurou.
///
/// A separação existe para que a decisão do que dizer seja testável sem
/// capturar `stderr`; aqui só sobra a escrita.
pub fn report(dialect: &str, unsupported: &[&str], sampling: &Sampling) {
    for linha in caveats(dialect, unsupported, sampling) {
        eprintln!("{linha}");
    }
}

/// Constrói o cliente já modulado, e conta o que o dialeto não fará.
///
/// Os três passos andam juntos porque separá-los é o que produziu a assimetria
/// original: dava para construir o cliente sem nunca lhe dar a amostragem, e
/// nada apontava a omissão. Aqui não dá — a amostragem é a única forma de
/// chegar ao cliente.
pub fn tuned_client(
    cli: &Cli,
    session_id: &str,
    config: nycode_ai::Config,
    dialect: &str,
) -> anyhow::Result<(std::sync::Arc<nycode_ai::Client>, Sampling)> {
    let sampling = sampling_for(cli, session_id)?;
    let client =
        std::sync::Arc::new(nycode_ai::Client::new(config)?.with_sampling(sampling.clone()));
    report(dialect, &client.unsupported_sampling(), &sampling);
    Ok((client, sampling))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    /// Uma invocação sem nenhuma flag, como o `clap` a produz.
    fn bare() -> Cli {
        <Cli as clap::Parser>::parse_from(["nycode"])
    }

    fn thinking(level: &str) -> Cli {
        <Cli as clap::Parser>::parse_from(["nycode", "--thinking", level])
    }

    #[test]
    fn the_cache_key_is_the_session_so_resuming_keeps_hitting_the_same_bucket() {
        // Uma chave nova por processo faria `--continue` reescrever o prefixo e
        // perder o cache justamente na sessao longa.
        let sampling = sampling_for(&bare(), "sessao-abc").unwrap();
        assert_eq!(sampling.cache_key.as_deref(), Some("sessao-abc"));
    }

    #[test]
    fn without_the_flag_no_reasoning_is_asked_for() {
        assert_eq!(
            sampling_for(&bare(), "s").unwrap().thinking,
            ThinkingLevel::Off
        );
    }

    #[test]
    fn the_flag_reaches_the_sampling_that_the_client_will_use() {
        assert_eq!(
            sampling_for(&thinking("high"), "s").unwrap().thinking,
            ThinkingLevel::High
        );
    }

    #[test]
    fn an_unknown_level_names_the_levels_that_exist() {
        // Recusar sem dizer o que aceitar obriga o usuario a ler o `--help`
        // para descobrir que digitou `hihg`.
        let err = sampling_for(&thinking("hihg"), "s")
            .unwrap_err()
            .to_string();
        assert!(err.contains("hihg"), "{err}");
        assert!(err.contains("xhigh"), "{err}");
    }

    #[test]
    fn only_models_the_catalog_prices_end_up_in_the_map() {
        // A ausencia e o caso comum: a maioria dos endpoints declara
        // identificador e janela, e nao preco.
        let modelo = |id: &str, price: Option<Price>| nycode_ai::Model {
            id: id.to_owned(),
            display_name: id.to_owned(),
            context_window: None,
            max_output_tokens: None,
            price,
        };
        let precificado = Price {
            base: nycode_ai::catalog::Rates {
                input: 3.0,
                ..nycode_ai::catalog::Rates::default()
            },
            tiers: Vec::new(),
        };

        let mapa = prices_of(&[modelo("com", Some(precificado)), modelo("sem", None)]);

        assert!(mapa.contains_key("com"));
        assert!(!mapa.contains_key("sem"));
    }

    #[test]
    fn only_models_the_catalog_sizes_end_up_in_the_window_map() {
        // Sem janela declarada nao ha com o que comparar o usage. Preencher a
        // ausencia com um padrao faria o agente acusar truncamento silencioso
        // em todo modelo cujo endpoint simplesmente nao publica o numero.
        let modelo = |id: &str, context_window: Option<u64>| nycode_ai::Model {
            id: id.to_owned(),
            display_name: id.to_owned(),
            context_window,
            max_output_tokens: None,
            price: None,
        };

        let mapa = windows_of(&[modelo("com", Some(200_000)), modelo("sem", None)]);

        assert_eq!(mapa.get("com"), Some(&200_000));
        assert!(!mapa.contains_key("sem"));
    }

    #[test]
    fn a_dialect_that_emits_everything_has_nothing_to_say() {
        assert!(caveats("anthropic-messages", &[], &Sampling::default()).is_empty());
    }

    #[test]
    fn a_dropped_parameter_is_named_along_with_the_dialect_that_dropped_it() {
        let lines = caveats(
            "openai-responses",
            &["stop_sequences"],
            &Sampling::default(),
        );
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("stop_sequences"), "{}", lines[0]);
        assert!(lines[0].contains("openai-responses"), "{}", lines[0]);
    }

    #[test]
    fn a_downgraded_level_says_what_was_asked_and_what_was_sent() {
        // Dizer so "rebaixado" obrigaria o usuario a adivinhar para onde.
        let sampling = Sampling::default().with_thinking(ThinkingLevel::Max);
        let lines = caveats("openai-responses", &[], &sampling);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("max"), "{}", lines[0]);
        assert!(lines[0].contains("high"), "{}", lines[0]);
    }

    #[test]
    fn a_level_the_dialect_reaches_produces_no_line() {
        let sampling = Sampling::default().with_thinking(ThinkingLevel::Medium);
        assert!(caveats("openai-responses", &[], &sampling).is_empty());
    }
}
