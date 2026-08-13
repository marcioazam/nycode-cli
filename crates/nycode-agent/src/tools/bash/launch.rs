//! Do comando pedido ao processo terminado.
//!
//! Separado da ferramenta porque muda por outro motivo: [`super`] muda quando
//! muda o contrato que o modelo vê — nome, descrição, argumentos —, e isto muda
//! quando muda como o comando sobe e o que o contém. É o outro lado da divisão
//! que [`super::output`] já fazia: aquele converte um processo terminado em
//! texto, este produz o processo terminado.
//!
//! As três coisas que contêm o comando vivem aqui, e nenhuma delas é opcional:
//! o confinamento do sistema operacional (FR-11), o prazo, e o ambiente que o
//! filho recebe.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use super::capture::Finished;
use crate::policy::environment::Allowlist;
use crate::policy::sandbox::{self, Confinement};

/// Teto de tempo de um comando.
///
/// Sem isto, um comando que espera entrada — um `git commit` sem `-m`, um
/// instalador interativo — trava o turno para sempre.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(90);

/// Como um comando de shell sobe e o que o contém.
#[derive(Debug, Clone)]
pub struct Launch {
    timeout: Duration,
    confinement: Confinement,
    environment: Allowlist,
    cap: usize,
}

impl Default for Launch {
    fn default() -> Self {
        Self {
            timeout: DEFAULT_TIMEOUT,
            confinement: sandbox::detect_from_path(),
            environment: Allowlist::discover(),
            cap: super::output::MAX_OUTPUT,
        }
    }
}

impl Launch {
    /// Substitui o prazo padrão.
    #[must_use]
    pub fn with_timeout(timeout: Duration) -> Self {
        Self {
            timeout,
            ..Self::default()
        }
    }

    /// Substitui o confinamento detectado.
    #[must_use]
    pub fn with_confinement(mut self, confinement: Confinement) -> Self {
        self.confinement = confinement;
        self
    }

    /// Substitui a lista de variáveis que o comando recebe.
    #[must_use]
    pub fn with_environment(mut self, environment: Allowlist) -> Self {
        self.environment = environment;
        self
    }

    /// Substitui o teto de bytes guardados por canal.
    #[cfg(test)]
    #[must_use]
    pub const fn with_cap(mut self, cap: usize) -> Self {
        self.cap = cap;
        self
    }

    /// Como os comandos são confinados.
    #[must_use]
    pub const fn confinement(&self) -> &Confinement {
        &self.confinement
    }

    /// Sobe o comando e espera o fim dele.
    ///
    /// O erro é a mensagem que vai ao modelo: quem chama não tem o que decidir
    /// sobre uma falha de arranque além de contá-la.
    pub async fn run(&self, root: &Path, command: &str) -> Result<Finished, String> {
        // O confinamento envolve o comando; sem ele o `argv` é o `bash -lc` de
        // sempre, e o aviso na abertura da sessão é o que diz isso ao usuário.
        let argv = sandbox::wrap(&self.confinement, root, command);
        let Some((program, rest)) = argv.split_first() else {
            return Err("confinamento produziu uma linha de comando vazia".to_owned());
        };

        let mut command = tokio::process::Command::new(program);
        command
            .args(rest)
            .current_dir(root)
            // Sem isto o comando herda o terminal e pode bloquear esperando
            // entrada que nunca vem.
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // Largar o future não mata o processo: o `Child` do tokio o
            // desanexa no drop, e o comando segue escrevendo no workspace
            // depois de a ferramenta ter dito que o interrompeu. Isto vale para
            // os dois caminhos que largam o future — o prazo aqui e o
            // cancelamento no despacho (ADR-0015).
            .kill_on_drop(true);
        // O comando é composto pelo modelo a partir de conteúdo do repositório.
        // Herdar o ambiente do harness colocaria a credencial do gateway ao
        // alcance de um `env` que o modelo pode ser induzido a emitir.
        self.environment.apply(&mut command);
        // Líder de um grupo próprio: terminar o comando é terminar o que ele
        // iniciou, e não só o processo direto.
        crate::policy::process::detach(&mut command);

        // A ligação é deliberada: o `Timeout` é largado ao fim desta instrução,
        // e é esse drop que termina o comando. Deixá-lo dentro do `match`
        // adiaria o término para depois do braço.
        let finished =
            tokio::time::timeout(self.timeout, super::supervise::collect(command, self.cap)).await;

        match finished {
            Ok(Ok(output)) => Ok(output),
            Ok(Err(err)) => Err(format!("nao foi possivel executar: {err}")),
            Err(_) => Err(self.timed_out()),
        }
    }

    /// Se terminar o comando leva junto os processos que ele iniciou.
    ///
    /// Só o namespace de PID do `bubblewrap` garante isso. Sem ele o término
    /// alcança o `bash` e para o laço, mas um neto já iniciado sobrevive — e a
    /// mensagem precisa dizer isso, em vez de afirmar uma interrupção completa
    /// que não aconteceu.
    const fn ends_the_whole_tree(&self) -> bool {
        matches!(self.confinement, Confinement::Bubblewrap { .. })
    }

    /// O que dizer quando o prazo estoura.
    fn timed_out(&self) -> String {
        let secs = self.timeout.as_secs();
        if self.ends_the_whole_tree() {
            format!("comando excedeu {secs}s e foi interrompido")
        } else {
            format!(
                "comando excedeu {secs}s e foi interrompido; sem confinamento, \
                 processos que ele tenha iniciado podem seguir rodando"
            )
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    /// Uma variável que o processo de teste tem e que não está no mínimo.
    ///
    /// `set_var` é `unsafe` na edition 2024, então não dá para plantar
    /// `NYCODE_API_KEY` no processo para provar que ela não passa. O `cargo`
    /// define esta ao rodar a suíte, e ela exerce o mesmo caminho: uma variável
    /// herdada que o filho não deve ver.
    const HERDADA: &str = "CARGO_PKG_NAME";

    /// Sem confinamento e com o ambiente fixado no mínimo.
    ///
    /// O comportamento de arranque não pode depender de `bwrap` estar instalado
    /// na máquina de quem roda a suíte, nem da configuração de ambiente de quem
    /// a roda: um teste que depende de arquivo fora do repositório passa ou
    /// falha por motivo que o repositório não controla.
    fn bare() -> Launch {
        Launch::default()
            .with_confinement(Confinement::Unavailable {
                reason: "teste".to_owned(),
            })
            .with_environment(Allowlist::default())
    }

    fn workspace() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    async fn saida(launch: &Launch, root: &Path, command: &str) -> String {
        let out = launch.run(root, command).await.unwrap();
        out.stdout.text().into_owned()
    }

    #[tokio::test]
    async fn a_shell_command_cannot_read_the_credentials_of_whoever_launched_the_agent() {
        // O comando e composto pelo modelo a partir de conteudo do repositorio.
        // Com o ambiente herdado, um `AGENTS.md` que peca "rode `env`" entrega
        // a chave do gateway sem contornar nenhuma camada de politica.
        let dir = workspace();
        assert!(
            std::env::var_os(HERDADA).is_some(),
            "o teste so prova algo se o pai tiver a variavel"
        );

        let out = saida(&bare(), dir.path(), &format!("echo \"[${HERDADA}]\"")).await;
        assert_eq!(out.trim(), "[]");
    }

    #[tokio::test]
    async fn the_minimum_that_makes_a_command_run_still_reaches_it() {
        // Sem `PATH` o comando nao acha binario nenhum, e a protecao viraria
        // uma quebra.
        let dir = workspace();
        let out = saida(&bare(), dir.path(), "echo \"[$PATH]\"").await;
        assert_ne!(out.trim(), "[]", "PATH precisa chegar ao comando");
    }

    #[tokio::test]
    async fn a_variable_the_user_declared_reaches_the_command() {
        // A extensao existe porque um comando legitimo precisa de `GH_TOKEN` ou
        // `SSH_AUTH_SOCK`. Sem saida, o usuario exportaria a variavel dentro do
        // proprio comando e a lista viraria teatro.
        let dir = workspace();
        let launch = bare().with_environment(Allowlist::with([HERDADA.to_owned()]));

        let out = saida(&launch, dir.path(), &format!("echo \"[${HERDADA}]\"")).await;
        assert_ne!(out.trim(), "[]");
    }

    #[tokio::test]
    async fn a_command_that_floods_its_output_does_not_grow_the_process() {
        // O invariante que o `.output()` nao dava: ele lia os dois canos ate o
        // fim antes de qualquer corte, entao o teto limitava o que o modelo
        // lia e nao o que o processo ocupava. Um MiB contra um teto de 1 KiB e
        // uma razao de mil — se a leitura voltar a ser integral, o guardado
        // passa a ser o tamanho da saida e a asercao cai.
        //
        // Mil basta e oito mil nao acrescentava: o teste roda junto com a suite
        // inteira, e despejar oito MiB por um cano atrasa o escalonamento de
        // quem mede prazo do outro lado do binario.
        const CAP: usize = 1024;
        let dir = workspace();

        let out = bare()
            .with_cap(CAP)
            .run(
                dir.path(),
                "head -c 1048576 /dev/zero | tr '\\0' 'x'; echo; echo FIM",
            )
            .await
            .unwrap();

        assert!(out.stdout.total() > 1_000_000, "{}", out.stdout.total());
        assert!(
            out.stdout.text().len() <= CAP,
            "guardou {} bytes com teto de {CAP}",
            out.stdout.text().len()
        );
        assert!(
            out.stdout.text().trim_end().ends_with("FIM"),
            "a cauda e o que interessa num comando"
        );
    }

    #[tokio::test]
    async fn a_command_that_floods_stderr_does_not_deadlock() {
        // Ler um canal de cada vez trava quando o outro enche: o buffer do cano
        // e de 64 KiB no Linux, e um comando que escreve mais que isso em
        // `stderr` enquanto quem le esta preso no `stdout` espera para sempre.
        // Sem o `join`, este teste estoura o prazo em vez de falhar.
        //
        // 256 KiB e quatro vezes o buffer, que e o que basta para encher: mais
        // que isso so somaria carga a uma suite que ja mede prazo em paralelo.
        let dir = workspace();
        let launch = Launch::with_timeout(Duration::from_secs(20))
            .with_confinement(Confinement::Unavailable {
                reason: "teste".to_owned(),
            })
            .with_environment(Allowlist::default());

        let out = launch
            .run(
                dir.path(),
                "head -c 262144 /dev/zero | tr '\\0' 'e' >&2; echo pronto",
            )
            .await
            .unwrap();

        assert!(out.status.success());
        assert!(out.stderr.total() >= 262_144, "{}", out.stderr.total());
        assert!(out.stdout.text().contains("pronto"));
    }

    #[tokio::test]
    async fn a_hanging_command_is_interrupted_by_the_timeout() {
        // Sem o teto, um comando que espera entrada trava o turno para sempre.
        let dir = workspace();
        let launch = Launch::with_timeout(Duration::from_millis(200)).with_confinement(
            Confinement::Unavailable {
                reason: "teste".to_owned(),
            },
        );

        let err = launch.run(dir.path(), "sleep 30").await.unwrap_err();
        assert!(err.contains("excedeu"), "{err}");
    }

    #[tokio::test]
    async fn a_descendant_holding_the_pipe_does_not_hold_the_turn_until_the_deadline() {
        // O lider sai na hora; o neto herda a ponta de escrita do cano e a
        // segura por trinta segundos. Sem terminar o grupo no instante em que o
        // lider sai, a drenagem espera um EOF que so viria com a morte do neto,
        // e o turno inteiro fica preso ate o prazo do comando — um comando que
        // teve sucesso reportado como estouro de prazo.
        let dir = workspace();
        let launch = Launch::with_timeout(Duration::from_secs(30)).with_confinement(
            Confinement::Unavailable {
                reason: "teste".to_owned(),
            },
        );

        let started = std::time::Instant::now();
        let out = launch
            .run(dir.path(), "sleep 30 & echo pronto")
            .await
            .expect("o comando terminou com sucesso e nao deveria virar estouro de prazo");
        let elapsed = started.elapsed();

        assert!(
            elapsed < Duration::from_secs(10),
            "a drenagem segurou o turno por {elapsed:?}, perto do prazo de 30s"
        );
        // Terminar o grupo nao pode custar a saida que ja estava no cano: fechar
        // a ponta de escrita nao descarta byte escrito.
        assert!(
            out.stdout.text().contains("pronto"),
            "a saida do lider se perdeu ao terminar o grupo: {:?}",
            out.stdout.text()
        );
    }

    #[tokio::test]
    async fn stdin_is_closed_so_interactive_commands_do_not_block() {
        let dir = workspace();
        // `cat` sem argumento leria stdin para sempre se ele nao estivesse fechado.
        let out = bare().run(dir.path(), "cat").await.unwrap();
        assert!(out.status.success(), "stdin fechado deveria encerrar o cat");
    }

    #[tokio::test]
    async fn dropping_a_running_command_ends_it_instead_of_orphaning_it() {
        // Largar o future e o que acontece nos dois caminhos que interrompem um
        // comando: o estouro de prazo aqui e o cancelamento no despacho. Sem
        // matar o processo ele segue escrevendo no workspace que o modelo esta
        // inspecionando, e a ferramenta afirma uma interrupcao que nao houve.
        let dir = workspace();
        let sentinela = dir.path().join("sentinela.txt");
        let size = || std::fs::metadata(&sentinela).map_or(0, |m| m.len());

        // Teto alto de proposito: quem termina o comando neste teste e o drop, e
        // nao o prazo. Amarrar o teste ao prazo o faria correr com o arranque do
        // `bash -lc`, que e um shell de login e demora sob carga.
        let launch = Launch::with_timeout(Duration::from_mins(1)).with_confinement(
            Confinement::Unavailable {
                reason: "teste".to_owned(),
            },
        );
        // `Box::pin`, e nao `tokio::pin!`: o segundo produz um `Pin<&mut F>`, e
        // largar a referencia nao larga o future nem o processo que ele segura.
        let mut running = Box::pin(launch.run(
            dir.path(),
            "while true; do echo . >> sentinela.txt; sleep 0.02; done",
        ));

        // Esperar o primeiro sinal de vida e o que remove a corrida: so faz
        // sentido largar um comando que ja comecou a escrever.
        let alive = async {
            let deadline = std::time::Instant::now() + Duration::from_secs(30);
            while size() == 0 && std::time::Instant::now() < deadline {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        };
        tokio::select! {
            _ = &mut running => {}
            () = alive => {}
        }
        drop(running);

        tokio::time::sleep(Duration::from_millis(150)).await;
        let logo_depois = size();
        assert!(
            logo_depois > 0,
            "o comando precisa ter escrito algo, senao o teste passa a toa"
        );
        tokio::time::sleep(Duration::from_millis(500)).await;

        assert_eq!(
            logo_depois,
            size(),
            "o comando continuou escrevendo depois de largado"
        );
    }

    #[tokio::test]
    async fn dropping_a_command_also_ends_what_it_started_and_not_only_the_leader() {
        // O que o teste acima nao pega: ele larga um comando que escreve ele
        // mesmo, entao matar o lider basta e o `kill_on_drop` do tokio da conta.
        // Aqui quem escreve e o neto. O ADR-0021 afirma que o `kill_on_drop`
        // "cobre o drop do future", e isso e verdade para o lider e falso para o
        // que ele iniciou — o neto sobrevivia ao cancelamento escrevendo no
        // workspace que o modelo estava inspecionando.
        let dir = workspace();
        let sentinela = dir.path().join("neto.txt");
        let size = || std::fs::metadata(&sentinela).map_or(0, |m| m.len());

        let launch = Launch::with_timeout(Duration::from_mins(1)).with_confinement(
            Confinement::Unavailable {
                reason: "teste".to_owned(),
            },
        );
        // O lider inicia o neto e fica esperando: quem escreve na sentinela e o
        // processo de dentro, nunca o que o `kill_on_drop` alcanca.
        let mut running = Box::pin(launch.run(
            dir.path(),
            "(while true; do echo . >> neto.txt; sleep 0.02; done) & wait",
        ));

        let alive = async {
            let deadline = std::time::Instant::now() + Duration::from_secs(30);
            while size() == 0 && std::time::Instant::now() < deadline {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        };
        tokio::select! {
            _ = &mut running => {}
            () = alive => {}
        }
        drop(running);

        tokio::time::sleep(Duration::from_millis(150)).await;
        let logo_depois = size();
        assert!(
            logo_depois > 0,
            "o neto precisa ter escrito algo, senao o teste passa a toa"
        );
        tokio::time::sleep(Duration::from_millis(500)).await;

        assert_eq!(
            logo_depois,
            size(),
            "o neto continuou escrevendo depois de o comando ser largado"
        );
    }

    #[test]
    fn the_timeout_message_admits_what_it_cannot_guarantee() {
        // Afirmar interrupcao completa onde ela nao e garantida repetiria, com
        // texto novo, o defeito que o termino corrige.
        let sem_confinamento = Launch::default().with_confinement(Confinement::Unavailable {
            reason: "teste".to_owned(),
        });
        assert!(
            sem_confinamento
                .timed_out()
                .contains("podem seguir rodando"),
            "{}",
            sem_confinamento.timed_out()
        );

        let confinado = Launch::default().with_confinement(Confinement::Bubblewrap {
            program: "bwrap".to_owned(),
        });
        assert!(confinado.timed_out().contains("interrompido"));
        assert!(
            !confinado.timed_out().contains("podem seguir rodando"),
            "sob namespace de PID a interrupcao e completa: {}",
            confinado.timed_out()
        );
    }
}
