//! Binário do harness diferencial.
//!
//! Roda os mesmos prompts nos dois harnesses contra o mesmo gateway e falha se
//! o contrato observável divergir. Existe como binário, e não só como
//! biblioteca, para que o CI possa executá-lo — uma verificação que só roda sob
//! demanda é uma verificação que não acontece.

use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use nycode_parity::{Harness, diff, run, unattested};

/// Diferença de tokens tolerada antes de virar divergência.
///
/// Backends arredondam de forma diferente e um token de diferença não é
/// defeito. Uma divergência de sinalização de estimativa é, e não passa por
/// aqui: ela é comparada exatamente.
const TOKEN_TOLERANCE: u64 = 2;

/// Prompts do conjunto padrão.
///
/// Curtos e determinísticos de propósito: o que se compara é o contrato
/// observável, e um prompt aberto produziria divergência de prosa que não
/// significa nada.
const DEFAULT_PROMPTS: &[&str] = &[
    "responda apenas com a palavra: ok",
    "leia o arquivo README.md e diga em uma linha o que ele contem",
    "crie um arquivo chamado saida.txt com o texto pronto",
];

/// Texto de uso, impresso por `--help`.
const USAGE: &str = "uso: nycode-parity --nycode <bin> --reference <bin> [--prompt <texto>]...\n\
     ou:  nycode-parity --nycode <bin> --self-check [--prompt <texto>]...\n\
     ambiente: NYCODE_BASE_URL, NYCODE_API_KEY";

#[derive(Debug, PartialEq, Eq)]
struct Options {
    nycode: PathBuf,
    /// Ausente em `--self-check`, que não compara com ninguém.
    reference: Option<PathBuf>,
    base_url: String,
    api_key: String,
    prompts: Vec<String>,
}

/// O que a linha de comando pediu.
#[derive(Debug, PartialEq, Eq)]
enum Request {
    Compare(Box<Options>),
    /// Imprimir o uso e sair.
    Help,
}

/// Interpreta argumentos e ambiente.
///
/// Recebe os dois em vez de lê-los porque `set_var` é `unsafe` na edition 2024
/// e `unsafe_code` é `forbid` no workspace: sem esta costura o comportamento
/// seria intestável.
fn parse<I>(args: I, base_url: Option<String>, api_key: Option<String>) -> Result<Request>
where
    I: IntoIterator<Item = String>,
{
    let mut args = args.into_iter();
    let mut nycode = None;
    let mut reference = None;
    let mut prompts = Vec::new();
    let mut self_check = false;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--nycode" => nycode = args.next().map(PathBuf::from),
            "--reference" => reference = args.next().map(PathBuf::from),
            "--prompt" => prompts.extend(args.next()),
            "--self-check" => self_check = true,
            "--help" | "-h" => return Ok(Request::Help),
            other => bail!("argumento desconhecido: {other}"),
        }
    }

    if prompts.is_empty() {
        prompts = DEFAULT_PROMPTS.iter().map(|p| (*p).to_owned()).collect();
    }

    // Pedir os dois e ambiguo: um deles seria ignorado em silencio, e quem
    // passou `--reference` acharia que comparou.
    if self_check && reference.is_some() {
        bail!("--self-check nao compara com ninguem; nao passe --reference junto");
    }
    if !self_check && reference.is_none() {
        bail!("faltou --reference <caminho>, ou --self-check para verificar so o instrumento");
    }

    Ok(Request::Compare(Box::new(Options {
        nycode: nycode.context("faltou --nycode <caminho>")?,
        reference,
        base_url: base_url.context("NYCODE_BASE_URL precisa apontar para o gateway")?,
        api_key: api_key.context("NYCODE_API_KEY precisa estar definida")?,
        prompts,
    })))
}

#[tokio::main]
async fn main() -> Result<()> {
    let request = parse(
        std::env::args().skip(1),
        std::env::var("NYCODE_BASE_URL").ok(),
        std::env::var("NYCODE_API_KEY").ok(),
    )?;

    let options = match request {
        Request::Help => {
            println!("{USAGE}");
            return Ok(());
        }
        Request::Compare(options) => *options,
    };
    let candidate = Harness::nycode(&options.nycode, &options.base_url, &options.api_key);
    let Some(reference_path) = options.reference.clone() else {
        return self_check(&candidate, &options.prompts).await;
    };
    let reference = Harness::reference(&reference_path, &options.base_url, &options.api_key);

    let mut diverged = 0;
    // Uma dimensao so e "sem evidencia" quando ficou vazia em *toda* a
    // execucao. Por prompt seria errado: "responda apenas com a palavra: ok"
    // legitimamente nao chama ferramenta, e reprovar isso transformaria a
    // guarda em ruido. O defeito que ela existe para pegar e o dialeto lendo o
    // vocabulario errado, e esse zera a dimensao em todo prompt.
    let mut never_attested: Vec<&'static str> = nycode_parity::DIMENSIONS.to_vec();

    for prompt in &options.prompts {
        // Cada harness roda num workspace próprio, semeado igual: comparar
        // duas execuções no mesmo diretório mediria a segunda contra o que a
        // primeira deixou.
        let left = tempfile::tempdir()?;
        let right = tempfile::tempdir()?;
        seed(left.path())?;
        seed(right.path())?;

        let observed_reference = run(&reference, left.path(), prompt).await?;
        let observed_candidate = run(&candidate, right.path(), prompt).await?;

        let absent = unattested(&observed_reference, &observed_candidate);
        never_attested.retain(|dimension| absent.contains(dimension));

        let divergences = diff(&observed_reference, &observed_candidate, TOKEN_TOLERANCE);
        if divergences.is_empty() {
            println!("ok: {prompt}");
            continue;
        }

        diverged += 1;
        println!("DIVERGIU: {prompt}");
        for divergence in divergences {
            println!("  {divergence}");
        }
    }

    // A ausencia de evidencia e reportada depois de todos os prompts, e vem
    // antes do veredito: duas ausencias sao iguais, e um "sem divergencia"
    // impresso sobre elas e indistinguivel de paridade para quem le a saida.
    if !never_attested.is_empty() {
        println!(
            "SEM EVIDENCIA em nenhum dos {} prompts:",
            options.prompts.len()
        );
        for dimension in &never_attested {
            println!("  {dimension}: vazia nos dois lados em toda a execucao");
        }
        bail!(
            "{} dimensoes nao foram comparadas em execucao nenhuma; aprovar sobre ausencia e paridade falsa (NFR-6)",
            never_attested.len()
        );
    }

    if diverged > 0 {
        bail!(
            "{diverged} de {} prompts divergiram; toda divergencia precisa virar ADR ou correcao (NFR-6)",
            options.prompts.len()
        );
    }

    println!(
        "paridade: {} prompts sem divergencia",
        options.prompts.len()
    );
    Ok(())
}

/// Verifica o instrumento sem comparar com ninguém.
///
/// Existe porque o harness de referência nem sempre está instalado, e nesse
/// caso a alternativa era não rodar nada — que é como o gate passou a vida
/// inteira. Isto não é paridade e não é anunciado como tal: é a prova de que o
/// harness consegue observar o candidato, que é metade do defeito histórico.
/// A outra metade — ler a referência — só a comparação de verdade cobre.
async fn self_check(candidate: &Harness, prompts: &[String]) -> Result<()> {
    let mut never_attested: Vec<&'static str> = nycode_parity::DIMENSIONS.to_vec();

    for prompt in prompts {
        let workspace = tempfile::tempdir()?;
        seed(workspace.path())?;
        let observed = run(candidate, workspace.path(), prompt).await?;

        // Comparar o transcrito consigo mesmo responde exatamente "quais
        // dimensoes ficaram vazias nele".
        let absent = unattested(&observed, &observed);
        never_attested.retain(|dimension| absent.contains(dimension));
        println!("observado: {prompt}");
    }

    if !never_attested.is_empty() {
        println!("SEM EVIDENCIA em nenhum dos {} prompts:", prompts.len());
        for dimension in &never_attested {
            println!("  {dimension}: vazia em toda a execucao");
        }
        bail!(
            "o harness nao conseguiu observar {} dimensoes do candidato; sem isso a comparacao com a referencia aprovaria por ausencia (NFR-6)",
            never_attested.len()
        );
    }

    println!(
        "instrumento: as {} dimensoes foram observadas no candidato em {} prompts",
        nycode_parity::DIMENSIONS.len(),
        prompts.len()
    );
    println!("instrumento: isto NAO e paridade — falta o lado da referencia");
    Ok(())
}

/// Semeia o workspace com o mínimo que os prompts padrão esperam encontrar.
fn seed(root: &std::path::Path) -> Result<()> {
    std::fs::write(
        root.join("README.md"),
        "# projeto de teste\n\nUm repositorio minimo para o harness de paridade.\n",
    )
    .with_context(|| format!("nao foi possivel semear {}", root.display()))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|a| (*a).to_owned()).collect()
    }

    fn gateway() -> (Option<String>, Option<String>) {
        (Some("http://gw/v1".to_owned()), Some("chave".to_owned()))
    }

    fn compared(request: Request) -> Options {
        match request {
            Request::Compare(options) => *options,
            Request::Help => panic!("esperava uma comparacao"),
        }
    }

    #[test]
    fn the_two_harnesses_and_the_gateway_are_all_required() {
        let (url, key) = gateway();

        let options = compared(
            parse(
                args(&["--nycode", "/bin/a", "--reference", "/bin/b"]),
                url.clone(),
                key.clone(),
            )
            .unwrap(),
        );
        assert_eq!(options.nycode, PathBuf::from("/bin/a"));
        assert_eq!(options.reference, Some(PathBuf::from("/bin/b")));
        assert_eq!(options.base_url, "http://gw/v1");
    }

    #[test]
    fn a_missing_harness_says_which_one_is_missing() {
        let (url, key) = gateway();

        let err = parse(args(&["--reference", "/bin/b"]), url.clone(), key.clone()).unwrap_err();
        assert!(err.to_string().contains("--nycode"), "{err}");

        let err = parse(args(&["--nycode", "/bin/a"]), url, key).unwrap_err();
        assert!(err.to_string().contains("--reference"), "{err}");
    }

    #[test]
    fn self_check_runs_without_a_reference() {
        // O harness de referencia nem sempre esta instalado, e a alternativa
        // era nao rodar nada — que e como o gate passou a vida inteira.
        let (url, key) = gateway();
        let options =
            compared(parse(args(&["--nycode", "/bin/a", "--self-check"]), url, key).unwrap());
        assert_eq!(options.reference, None);
    }

    #[test]
    fn self_check_together_with_a_reference_is_refused_rather_than_silently_resolved() {
        // Escolher um dos dois faria quem passou `--reference` acreditar que
        // comparou quando so o instrumento foi verificado.
        let (url, key) = gateway();
        let err = parse(
            args(&["--nycode", "/a", "--reference", "/b", "--self-check"]),
            url,
            key,
        )
        .unwrap_err();
        assert!(err.to_string().contains("--self-check"), "{err}");
    }

    #[test]
    fn the_usage_mentions_both_modes() {
        assert!(USAGE.contains("--reference"));
        assert!(USAGE.contains("--self-check"));
    }

    #[test]
    fn a_missing_gateway_is_refused_before_running_anything() {
        // Rodar sem gateway compararia duas falhas de conexao e chamaria isso
        // de paridade.
        let base = args(&["--nycode", "/bin/a", "--reference", "/bin/b"]);

        let err = parse(base.clone(), None, Some("k".to_owned())).unwrap_err();
        assert!(err.to_string().contains("NYCODE_BASE_URL"), "{err}");

        let err = parse(base, Some("http://gw/v1".to_owned()), None).unwrap_err();
        assert!(err.to_string().contains("NYCODE_API_KEY"), "{err}");
    }

    #[test]
    fn without_prompts_the_default_set_is_used() {
        let (url, key) = gateway();
        let options =
            compared(parse(args(&["--nycode", "/a", "--reference", "/b"]), url, key).unwrap());
        assert_eq!(options.prompts.len(), DEFAULT_PROMPTS.len());
    }

    #[test]
    fn explicit_prompts_replace_the_default_set() {
        let (url, key) = gateway();
        let options = compared(
            parse(
                args(&[
                    "--nycode",
                    "/a",
                    "--reference",
                    "/b",
                    "--prompt",
                    "um",
                    "--prompt",
                    "dois",
                ]),
                url,
                key,
            )
            .unwrap(),
        );
        assert_eq!(options.prompts, vec!["um".to_owned(), "dois".to_owned()]);
    }

    #[test]
    fn help_short_circuits_before_demanding_a_gateway() {
        // `--help` sem gateway precisa explicar o uso, nao reclamar de
        // configuracao ausente.
        assert_eq!(parse(args(&["--help"]), None, None).unwrap(), Request::Help);
        assert_eq!(parse(args(&["-h"]), None, None).unwrap(), Request::Help);
        assert!(USAGE.contains("--nycode"));
    }

    #[test]
    fn an_unknown_argument_is_refused_rather_than_ignored() {
        // Ignorar faria um `--promtp` digitado errado rodar o conjunto padrao
        // e o resultado nao teria relacao com o que foi pedido.
        let (url, key) = gateway();
        let err = parse(args(&["--promtp", "x"]), url, key).unwrap_err();
        assert!(err.to_string().contains("--promtp"), "{err}");
    }

    #[test]
    fn seeding_writes_the_file_the_default_prompts_expect() {
        let dir = tempfile::tempdir().unwrap();
        seed(dir.path()).unwrap();
        assert!(dir.path().join("README.md").exists());
    }

    #[test]
    fn seeding_a_directory_that_does_not_exist_says_where_it_failed() {
        let err = seed(std::path::Path::new("/nao/existe/mesmo")).unwrap_err();
        assert!(err.to_string().contains("/nao/existe/mesmo"), "{err}");
    }
}
