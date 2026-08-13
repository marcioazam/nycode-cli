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

#[test]
fn two_harnesses_that_behave_the_same_report_no_divergence() {
    let dir = tempfile::tempdir().unwrap();
    let quiet = stub(dir.path(), "quieto.sh", "exit 0");

    let out = compare(&quiet, &quiet, &["--prompt", "nao faca nada"]);

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
