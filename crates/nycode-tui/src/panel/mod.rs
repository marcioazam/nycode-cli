//! Cabeçalho de abertura e rodapé de estado.
//!
//! São as duas superfícies que dizem ao usuário o que a sessão carregou e o que
//! ela está custando. O rodapé em particular existe porque um harness que
//! esconde o custo até a fatura chegar não deixa ninguém decidir nada: a conta
//! de tokens precisa estar visível enquanto ainda dá para mudar de ideia.

use crate::width::{display_width, truncate_to_width};

mod tally;

pub use tally::Tally;

/// Estado que o rodapé apresenta.
#[derive(Debug, Clone)]
pub struct Status<'a> {
    pub workspace: &'a str,
    pub session: &'a str,
    pub model: &'a str,
    pub tally: Tally,
    /// Se a sessão pode escrever no workspace.
    pub writable: bool,
}

/// Separador entre os campos do rodapé.
const SEPARATOR: &str = "  ·  ";

/// Monta a linha de rodapé, encaixada na largura disponível.
///
/// O encaixe não é um truncamento à direita: a linha termina na permissão, e
/// cortar pela direita apagava exatamente ela. Quem cede espaço é o caminho do
/// workspace — o único campo de comprimento livre, e o único cujo valor o
/// usuário já conhece.
#[must_use]
pub fn footer(status: &Status<'_>, width: usize) -> String {
    let mut parts = vec![
        format!("sessao {}", short_id(status.session)),
        status.model.to_owned(),
    ];

    let tally = status.tally;
    if tally.input_tokens > 0 || tally.output_tokens > 0 {
        let mut usage = format!(
            "↑{} ↓{}",
            compact(tally.input_tokens),
            compact(tally.output_tokens)
        );
        if let Some(rate) = tally.cache_hit_rate() {
            let _ = std::fmt::Write::write_fmt(&mut usage, format_args!(" cache {rate:.0}%"));
        }
        if tally.repaid_tokens > 0 {
            // O tamanho do erro, e não só a taxa: é o número que faz alguém
            // olhar para o que está reescrevendo o começo do contexto.
            let _ = std::fmt::Write::write_fmt(
                &mut usage,
                format_args!(" repagou {}", compact(tally.repaid_tokens)),
            );
        }
        if let Some(cost) = tally.cost {
            // O FR-19 pede custo, e contagem de tokens e volume. As duas
            // grandezas divergem por mais de uma ordem de magnitude entre
            // modelos, e a decisao que o numero informa — vale trocar de modelo
            // agora — depende do preco.
            let _ = std::fmt::Write::write_fmt(&mut usage, format_args!(" {}", money(cost)));
        }
        if tally.estimated {
            // O gateway sinaliza contagem heurística; apresentá-la como medida
            // seria a degradação silenciosa que o NFR-4 proíbe.
            usage.push_str(" (estimado)");
        }
        parts.push(usage);
    }

    if !status.writable {
        parts.push("somente-leitura".to_owned());
    }

    let rest = parts.join(SEPARATOR);
    let reserved = display_width(&rest) + display_width(SEPARATOR);
    let workspace = fit_workspace(status.workspace, width.saturating_sub(reserved));

    if workspace.is_empty() {
        // SIMPLIFICACAO: numa largura em que nem os campos fixos cabem, o corte
        // pela direita volta e a permissao pode cair. Abaixo de ~60 colunas o
        // rodape ja nao informa nada de util; se algum dia importar, o proximo
        // campo a ceder e a contagem de tokens, nao a permissao.
        return truncate_to_width(&rest, width);
    }
    truncate_to_width(&format!("{workspace}{SEPARATOR}{rest}"), width)
}

/// Encaixa o caminho do workspace no que sobrou da linha, cedendo o começo.
///
/// O fim do caminho é o que nomeia o projeto; o começo é onde todos os projetos
/// de uma máquina se parecem (`/home/alguem/source/`). Devolve vazio quando não
/// sobra espaço nem para a reticência mais um caractere — meia abreviação só
/// ocuparia a coluna de que outro campo precisa.
///
/// Texto simples de propósito: um caminho não carrega sequência ANSI, e cortar
/// uma pelo fim exigiria remontar o estado de cor de trás para frente.
fn fit_workspace(workspace: &str, budget: usize) -> String {
    if display_width(workspace) <= budget {
        return workspace.to_owned();
    }
    if budget < 2 {
        return String::new();
    }

    let mut buffer = [0_u8; 4];
    let mut used = 1; // a reticência
    let mut start = workspace.len();
    for (at, ch) in workspace.char_indices().rev() {
        let cells = display_width(ch.encode_utf8(&mut buffer));
        if used + cells > budget {
            break;
        }
        used += cells;
        start = at;
    }
    format!("…{}", &workspace[start..])
}

/// Monta o cabeçalho de abertura.
#[must_use]
pub fn header(
    version: &str,
    context_files: &[String],
    skills: &[String],
    width: usize,
) -> Vec<String> {
    let mut lines = vec![format!("nycode {version}")];

    if !context_files.is_empty() {
        lines.push(format!("contexto: {}", context_files.join(", ")));
    }
    if !skills.is_empty() {
        lines.push(format!("skills: {}", skills.join(", ")));
    }
    lines.push("Enter envia · Alt+Enter quebra linha · Ctrl+C interrompe · Ctrl+D sai".to_owned());

    lines
        .into_iter()
        .map(|line| truncate_to_width(&line, width))
        .collect()
}

/// Abrevia um id longo preservando o começo, que é o que ordena.
fn short_id(id: &str) -> String {
    if display_width(id) <= 12 {
        return id.to_owned();
    }
    id.chars().take(12).collect()
}

/// Abrevia uma contagem grande.
fn compact(value: u64) -> String {
    match value {
        0..=999 => value.to_string(),
        1_000..=999_999 => format!(
            "{:.1}k",
            f64::from(u32::try_from(value).unwrap_or(u32::MAX)) / 1000.0
        ),
        _ => {
            #[allow(clippy::cast_precision_loss)]
            let millions = value as f64 / 1_000_000.0;
            format!("{millions:.1}M")
        }
    }
}

/// Escreve um custo com precisão suficiente para o turno e para a sessão.
///
/// Quatro casas abaixo de um dólar, duas acima. Um turno barato custa frações
/// de centavo, e duas casas o mostrariam como zero ou como um centavo redondo —
/// justamente quando o usuário está calibrando quanto o trabalho custa. Acima
/// de um dólar a fração deixa de decidir qualquer coisa e só ocupa espaço.
fn money(value: f64) -> String {
    if value < 1.0 {
        format!("${value:.4}")
    } else {
        format!("${value:.2}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status() -> Status<'static> {
        Status {
            workspace: "~/proj",
            session: "0000001700000000000",
            model: "nylla-sonnet-4.5",
            tally: Tally::default(),
            writable: true,
        }
    }

    #[test]
    fn a_fresh_footer_shows_where_and_with_what_but_no_counts() {
        // Mostrar zero token numa sessao que ainda nao pediu nada sugeriria que
        // algo foi cobrado.
        let line = footer(&status(), 200);
        assert!(line.contains("~/proj"));
        assert!(line.contains("nylla-sonnet-4.5"));
        assert!(!line.contains('↑'), "sem turno nao ha contagem: {line}");
    }

    #[test]
    fn the_footer_reports_usage_once_a_turn_happened() {
        let mut status = status();
        status.tally.absorb(1500, 300, 750, 0);

        let line = footer(&status, 200);
        assert!(line.contains("↑1.5k"), "{line}");
        assert!(line.contains("↓300"), "{line}");
        assert!(line.contains("cache 50%"), "{line}");
    }

    #[test]
    fn an_estimated_count_is_labelled_as_such() {
        // Apresentar heuristica como medicao e exatamente o que o NFR-4 proibe.
        let mut status = status();
        status.tally.absorb(100, 10, 0, 0);
        status.tally.estimated = true;
        assert!(footer(&status, 200).contains("estimado"));
    }

    #[test]
    fn a_read_only_session_says_so() {
        // O usuario precisa saber por que o agente recusou uma escrita.
        let mut status = status();
        status.writable = false;
        assert!(footer(&status, 200).contains("somente-leitura"));
    }

    #[test]
    fn a_writable_session_does_not_advertise_it() {
        assert!(!footer(&status(), 200).contains("somente-leitura"));
    }

    #[test]
    fn the_footer_never_exceeds_the_width_it_was_given() {
        // Uma linha mais larga que o terminal quebraria sozinha e empurraria o
        // painel inteiro para cima a cada redesenho.
        let mut status = status();
        status.workspace = "/um/caminho/absurdamente/longo/que/nao/cabe/em/lugar/nenhum";
        status.tally.absorb(1_234_567, 89_000, 1_000_000, 5);

        for width in [10, 24, 40, 80] {
            let line = footer(&status, width);
            assert!(
                display_width(&line) <= width,
                "largura {width} estourada por: {line}"
            );
        }
    }

    #[test]
    fn a_line_that_does_not_fit_gives_up_the_path_and_not_the_permission() {
        // Truncar a linha inteira pela direita apagava a ultima parte, que e
        // justamente a permissao: quem trabalhava num projeto de caminho fundo
        // ficava numa sessao somente-leitura sem nada no rodape dizendo isso, e
        // sem resposta para "por que a escrita foi recusada". Um estado que
        // desaparece por causa da largura do terminal e a degradacao silenciosa
        // que o NFR-4 proibe. O caminho e que cede espaco — ele e o unico
        // pedaco de comprimento livre, e o mais dispensavel.
        let mut status = status();
        status.workspace = "/home/alguem/source/um-projeto-de-nome-comprido";
        status.writable = false;

        let line = footer(&status, 80);

        assert!(line.contains("somente-leitura"), "{line}");
        assert!(line.contains("nylla-sonnet-4.5"), "{line}");
        assert!(display_width(&line) <= 80, "{line}");
    }

    #[test]
    fn the_shortened_path_keeps_the_end_that_names_the_project() {
        // O comeco de um caminho e onde os projetos se parecem
        // (`/home/alguem/source/`); o fim e o que os distingue.
        let mut status = status();
        status.workspace = "/home/alguem/source/um-projeto-de-nome-comprido";
        status.writable = false;

        let line = footer(&status, 80);

        assert!(line.contains("comprido"), "{line}");
        assert!(!line.contains("/home/alguem"), "{line}");
    }

    #[test]
    fn a_long_session_id_is_shortened_but_keeps_its_start() {
        // O prefixo e o timestamp, que e o que ordena as sessoes.
        let line = footer(&status(), 200);
        assert!(line.contains("000000170000"), "{line}");
        assert!(!line.contains("0000001700000000000"), "{line}");
    }

    #[test]
    fn a_short_session_id_is_left_alone() {
        let mut status = status();
        status.session = "curta";
        assert!(footer(&status, 200).contains("sessao curta"));
    }

    #[test]
    fn counts_are_abbreviated_by_magnitude() {
        assert_eq!(compact(0), "0");
        assert_eq!(compact(999), "999");
        assert_eq!(compact(1_000), "1.0k");
        assert_eq!(compact(1_500_000), "1.5M");
    }

    fn status_with(tally: Tally) -> Status<'static> {
        Status {
            workspace: "~/proj",
            session: "0000001700000000000",
            model: "m",
            tally,
            writable: true,
        }
    }

    #[test]
    fn a_model_without_a_declared_price_shows_volume_and_no_cost() {
        // Um custo zerado ao lado de uma contagem grande seria lido como
        // gratis; calar diz "nao sei", que e a verdade.
        let mut tally = Tally::default();
        tally.absorb(1_000, 500, 0, 0);

        let linha = footer(&status_with(tally), 200);
        assert!(linha.contains("↑1.0k"), "{linha}");
        assert!(!linha.contains('$'), "{linha}");
    }

    #[test]
    fn a_priced_session_shows_the_cost_next_to_the_counts() {
        // O FR-19 pede custo, e contagem de tokens e volume. Sem esta linha o
        // requisito estava marcado entregue mostrando outra grandeza.
        let mut tally = Tally::default();
        tally.absorb(1_000, 500, 0, 0);
        tally.absorb_cost(0.0123);

        let linha = footer(&status_with(tally), 200);
        assert!(linha.contains("$0.0123"), "{linha}");
    }

    #[test]
    fn a_repaid_prefix_is_reported_in_the_footer() {
        let mut tally = Tally::default();
        tally.absorb(0, 100, 0, 100_000);
        tally.absorb(10_000, 100, 90_000, 0);

        let linha = footer(&status_with(tally), 200);
        assert!(linha.contains("repagou 10.0k"), "{linha}");
    }

    #[test]
    fn a_session_without_waste_says_nothing_about_it() {
        // O aviso e para a excecao; mostra-lo zerado ensinaria a ignora-lo.
        let mut tally = Tally::default();
        tally.absorb(0, 100, 0, 50_000);

        assert!(!footer(&status_with(tally), 200).contains("repagou"));
    }

    #[test]
    fn a_sub_dollar_cost_keeps_the_digits_that_decide_something() {
        // Duas casas mostrariam zero, ou um centavo redondo, em toda sessao
        // curta — que e quando o usuario esta calibrando o custo do trabalho.
        assert_eq!(money(0.0004), "$0.0004");
        assert_eq!(money(0.0123), "$0.0123");
        assert_eq!(money(1.5), "$1.50");
    }

    #[test]
    fn the_header_names_what_the_session_loaded() {
        // Sem isto o usuario nao tem como saber se o AGENTS.md dele foi lido.
        let lines = header(
            "0.1.0",
            &["AGENTS.md".to_owned()],
            &["revisar".to_owned()],
            200,
        );
        let joined = lines.join("\n");
        assert!(joined.contains("nycode 0.1.0"));
        assert!(joined.contains("AGENTS.md"));
        assert!(joined.contains("revisar"));
        assert!(joined.contains("Ctrl+C"), "os atalhos precisam aparecer");
    }

    #[test]
    fn the_header_omits_the_lines_it_has_nothing_to_say_on() {
        let lines = header("0.1.0", &[], &[], 200);
        let joined = lines.join("\n");
        assert!(!joined.contains("contexto:"));
        assert!(!joined.contains("skills:"));
    }

    #[test]
    fn no_header_line_exceeds_the_width() {
        let lines = header(
            "0.1.0",
            &vec!["um/caminho/bem/longo/AGENTS.md".to_owned(); 6],
            &vec!["skill".to_owned(); 6],
            30,
        );
        for line in lines {
            assert!(display_width(&line) <= 30, "estourou: {line}");
        }
    }
}
