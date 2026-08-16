//! Prova de que a referência fala com o gateway local, e não com a API real.
//!
//! O teste que existia afirmava que o harness *define* `ANTHROPIC_BASE_URL`.
//! Esta versão do `pi` ignora a variável: o endpoint vem da definição do
//! modelo. Um teste verde sobre a variável é a classe de defeito que a spec 002
//! existe para eliminar. O observável aqui é outro: a contabilidade constante
//! do fixture (`input_tokens = 1234`) aparece na transcrição. A API real da
//! Anthropic não emite esse número.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use nycode_parity::{Harness, run};

/// Contabilidade que só o script do fixture emite.
const FIXTURE_INPUT_TOKENS: u64 = 1_234;

struct Fixture {
    child: Child,
    url: String,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        drop(self.child.stdin.take());
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                _ => break,
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn start_fixture() -> Fixture {
    let mut child = Command::new(env!("CARGO_BIN_EXE_nycode-parity-fixture"))
        .arg("--shutdown-on-stdin")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("o fixture deveria subir");
    let stdout = child.stdout.take().expect("stdout foi pedido em pipe");
    let mut linha = String::new();
    BufReader::new(stdout)
        .read_line(&mut linha)
        .expect("o fixture anuncia a porta na primeira linha");
    Fixture {
        child,
        url: linha.trim().to_owned(),
    }
}

fn reference_program() -> Option<PathBuf> {
    std::env::var_os("PARITY_REFERENCE")
        .map(PathBuf::from)
        .filter(|path| path.is_file())
}

#[tokio::test]
async fn the_reference_harness_reaches_the_local_gateway_instead_of_the_real_api() {
    let Some(program) = reference_program() else {
        eprintln!("pulando: PARITY_REFERENCE nao aponta para o executavel da referencia");
        return;
    };

    let fixture = start_fixture();
    let workspace = tempfile::tempdir().unwrap();
    let (harness, _agent_dir) = Harness::reference(&program, &fixture.url, "fixture")
        .expect("o diretorio de agente da referencia deveria materializar");

    let transcript = run(&harness, workspace.path(), "diga so a palavra xyzzy")
        .await
        .expect("a referencia deveria terminar");

    // Assercao positiva: o fixture atendeu. "Nao deu 401" aprovaria um harness
    // que nao chamou ninguem. Este numero so existe no script do fixture.
    assert_eq!(
        transcript.tokens.input, FIXTURE_INPUT_TOKENS,
        "a referencia nao falou com o fixture local; transcricao: stop={} error={:?} tokens={:?}",
        transcript.stop_reason, transcript.error, transcript.tokens
    );
    assert!(
        transcript
            .error
            .as_deref()
            .is_none_or(|error| !error.contains("authentication_error")),
        "a referencia foi a API real: {:?}",
        transcript.error
    );
}
