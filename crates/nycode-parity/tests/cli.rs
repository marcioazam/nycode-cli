//! Prova de que o harness diferencial acusa divergência de verdade.
//!
//! O crate declara que recusa o antipadrão do harness que não pode falhar. Esta
//! é a verificação que sustenta a declaração: dois harnesses que deixam o disco
//! diferente precisam produzir saída não-zero, e dois que se comportam igual
//! precisam passar. Sem estes dois casos, um bug no comparador transformaria o
//! gate inteiro em carimbo.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

/// Cria um harness de mentira: um script que ignora os argumentos.
fn stub(dir: &Path, name: &str, body: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    path
}

fn compare(nycode: &Path, reference: &Path, extra: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_nycode-parity"))
        .arg("--nycode")
        .arg(nycode)
        .arg("--reference")
        .arg(reference)
        .args(extra)
        .env("NYCODE_BASE_URL", "http://gateway-de-mentira/v1")
        .env("NYCODE_API_KEY", "chave")
        .output()
        .expect("o binario do harness deveria executar")
}

/// Roda o modo instrumento, que não compara com ninguém.
fn compare_self(nycode: &Path, extra: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_nycode-parity"))
        .arg("--nycode")
        .arg(nycode)
        .arg("--self-check")
        .args(extra)
        .env("NYCODE_BASE_URL", "http://gateway-de-mentira/v1")
        .env("NYCODE_API_KEY", "chave")
        .output()
        .expect("o binario do harness deveria executar")
}

/// O evento de fechamento no dialeto do `nycode`.
const CANDIDATE_CLOSE: &str = r#"echo '{"type":"result","stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":3}}'"#;

/// O mesmo fechamento no vocabulario da referencia.
///
/// `stop` traduz para `end_turn` e o usage mora dentro de `message`. Duas
/// grafias, um contrato: e o que a traducao de dialeto existe para provar.
const REFERENCE_CLOSE: &str = r#"echo '{"type":"message_end","message":{"stopReason":"stop","usage":{"input":10,"output":3}}}'"#;

/// Uma execucao completa no dialeto do `nycode`: ferramenta e fechamento.
const CANDIDATE_RUN: &str = concat!(
    r#"echo '{"type":"tool_start","name":"bash","input":{"command":"ls"}}'; "#,
    r#"echo '{"type":"result","stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":3}}'"#,
);

/// A mesma execucao no vocabulario da referencia.
const REFERENCE_RUN: &str = concat!(
    r#"echo '{"type":"tool_execution_start","toolName":"bash","args":{"command":"ls"}}'; "#,
    r#"echo '{"type":"message_end","message":{"stopReason":"stop","usage":{"input":10,"output":3}}}'"#,
);

#[test]
fn two_harnesses_that_behave_the_same_report_no_divergence() {
    // Os dois lados precisam falar: duas execucoes silenciosas nao demonstram
    // igualdade nenhuma, e antes da guarda de evidencia este teste passava
    // exatamente sobre esse vazio.
    let dir = tempfile::tempdir().unwrap();
    let candidate = stub(dir.path(), "candidato.sh", CANDIDATE_RUN);
    let reference = stub(dir.path(), "referencia.sh", REFERENCE_RUN);

    let out = compare(&candidate, &reference, &["--prompt", "use uma ferramenta"]);

    assert!(
        out.status.success(),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        String::from_utf8_lossy(&out.stdout).contains("sem divergencia"),
        "{}",
        String::from_utf8_lossy(&out.stdout)
    );
}

#[test]
fn two_silent_harnesses_are_refused_instead_of_approved() {
    // O modo de falha que o crate existe para recusar. Antes, dois harnesses
    // que nao publicavam nada produziam quatro dimensoes vazias dos dois lados,
    // o diff aprovava por igualdade, e o gate imprimia "sem divergencia".
    let dir = tempfile::tempdir().unwrap();
    let quiet = stub(dir.path(), "quieto.sh", "exit 0");

    let out = compare(&quiet, &quiet, &["--prompt", "nao faca nada"]);

    assert!(
        !out.status.success(),
        "aprovar sobre ausencia e paridade falsa"
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("SEM EVIDENCIA"), "{stdout}");
    assert!(stdout.contains("sequencia de tool calls"), "{stdout}");
    assert!(stdout.contains("contabilidade de tokens"), "{stdout}");
}

#[test]
fn a_prompt_without_tools_does_not_by_itself_count_as_missing_evidence() {
    // O conjunto padrao tem um prompt que legitimamente nao chama ferramenta.
    // Se a guarda fosse por prompt, ela reprovaria esse caso e viraria ruido.
    // Os stubs olham o prompt: so o primeiro chama ferramenta. O segundo fecha
    // o turno em texto, como o "responda apenas com a palavra: ok" do conjunto
    // padrao faria.
    let dir = tempfile::tempdir().unwrap();
    let candidate = stub(
        dir.path(),
        "candidato-condicional.sh",
        &format!("case \"$*\" in *ferramenta*) {CANDIDATE_RUN} ;; *) {CANDIDATE_CLOSE} ;; esac"),
    );
    let reference = stub(
        dir.path(),
        "referencia-condicional.sh",
        &format!("case \"$*\" in *ferramenta*) {REFERENCE_RUN} ;; *) {REFERENCE_CLOSE} ;; esac"),
    );

    let out = compare(
        &candidate,
        &reference,
        &["--prompt", "use uma ferramenta", "--prompt", "diga ok"],
    );

    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        !stdout.contains("SEM EVIDENCIA"),
        "a dimensao foi exercitada: {stdout}"
    );
}

#[test]
fn a_harness_that_leaves_the_disk_different_is_caught() {
    // E a razao de existir do crate: a deriva silenciosa de uma reescrita
    // aparece como um arquivo a mais, nao como um erro.
    let dir = tempfile::tempdir().unwrap();
    let quiet = stub(dir.path(), "quieto.sh", "exit 0");
    let noisy = stub(dir.path(), "escreve.sh", "echo divergi > divergiu.txt");

    let out = compare(&noisy, &quiet, &["--prompt", "escreva algo"]);

    assert!(
        !out.status.success(),
        "uma divergencia precisa falhar o gate"
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("DIVERGIU"), "{stdout}");
    assert!(stdout.contains("divergiu.txt"), "{stdout}");
}

#[test]
fn a_harness_that_exits_differently_is_caught() {
    // Codigo de saida e a dimensao que um script encadeando o binario le.
    let dir = tempfile::tempdir().unwrap();
    let ok = stub(dir.path(), "ok.sh", "exit 0");
    let bad = stub(dir.path(), "ruim.sh", "exit 1");

    let out = compare(&bad, &ok, &["--prompt", "qualquer"]);

    assert!(!out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("DIVERGIU"), "{stdout}");
}

#[test]
fn the_tool_sequence_is_compared_and_not_just_ignored() {
    // Era a dimensao fixada em vazio dos dois lados. Um harness que anuncia uma
    // ferramenta que o outro nao anuncia precisa ser pego.
    let dir = tempfile::tempdir().unwrap();
    let quiet = stub(dir.path(), "quieto.sh", "exit 0");
    let tooling = stub(
        dir.path(),
        "com-ferramenta.sh",
        r#"echo '{"type":"tool_start","name":"bash","input":{"command":"ls"}}'"#,
    );

    let out = compare(&tooling, &quiet, &["--prompt", "use uma ferramenta"]);

    assert!(!out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("sequencia de tool calls"), "{stdout}");
}

#[test]
fn self_check_approves_a_candidate_that_produces_every_dimension() {
    // O modo existe porque o harness de referencia nem sempre esta instalado,
    // e a alternativa era nao rodar nada — que e como o gate passou a vida
    // inteira.
    let dir = tempfile::tempdir().unwrap();
    let candidate = stub(dir.path(), "candidato.sh", CANDIDATE_RUN);

    let out = compare_self(&candidate, &["--prompt", "use uma ferramenta"]);

    assert!(
        out.status.success(),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("as 4 dimensoes foram observadas"),
        "{stdout}"
    );
    assert!(stdout.contains("NAO e paridade"), "{stdout}");
}

#[test]
fn self_check_refuses_a_candidate_the_harness_cannot_observe() {
    // E metade do defeito historico: o dialeto lendo o vocabulario errado zera
    // as dimensoes em toda execucao, e a comparacao aprovaria por ausencia.
    let dir = tempfile::tempdir().unwrap();
    let quiet = stub(dir.path(), "quieto.sh", "exit 0");

    let out = compare_self(&quiet, &["--prompt", "qualquer"]);

    assert!(!out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("SEM EVIDENCIA"), "{stdout}");
}

#[test]
fn self_check_together_with_a_reference_is_refused_rather_than_silently_resolved() {
    // Escolher um dos dois faria quem passou `--reference` acreditar que
    // comparou quando so o instrumento foi verificado.
    let dir = tempfile::tempdir().unwrap();
    let quiet = stub(dir.path(), "quieto.sh", "exit 0");

    let out = compare(&quiet, &quiet, &["--self-check"]);

    assert!(!out.status.success());
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("--self-check"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn help_explains_the_usage_without_needing_a_gateway() {
    let out = Command::new(env!("CARGO_BIN_EXE_nycode-parity"))
        .arg("--help")
        .output()
        .unwrap();

    assert!(out.status.success());
    assert!(String::from_utf8_lossy(&out.stdout).contains("--nycode"));
}

#[test]
fn running_without_a_gateway_refuses_instead_of_comparing_two_failures() {
    let out = Command::new(env!("CARGO_BIN_EXE_nycode-parity"))
        .args(["--nycode", "/bin/true", "--reference", "/bin/true"])
        .env_remove("NYCODE_BASE_URL")
        .env_remove("NYCODE_API_KEY")
        .output()
        .unwrap();

    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("NYCODE_BASE_URL"));
}
