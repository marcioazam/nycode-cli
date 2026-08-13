//! Binário do gateway de fixture.
//!
//! Casca de E/S sobre [`nycode_parity::fixture`]. A decisão inteira — o que
//! responder a cada pedido — vive lá, em funções puras e testadas; aqui só se
//! lê bytes do socket e se escreve bytes de volta.
//!
//! Imprime a URL base em stdout na primeira linha, para que o script que o sobe
//! saiba em que porta ele caiu sem precisar fixar uma.

use anyhow::Result;
use nycode_parity::fixture::{parse_head, respond, route};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// Teto do que se lê de uma conexão.
///
/// O prompt de sistema e os schemas de ferramenta dos dois harnesses cabem
/// folgados; um corpo maior que isto é engano, não uso.
const MAX_BODY: usize = 4 * 1024 * 1024;

/// Pede o desligamento negociado, sem sinal, ao fim da entrada padrão.
const SHUTDOWN_FLAG: &str = "--shutdown-on-stdin";

#[tokio::main]
async fn main() -> Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    println!("http://{}/v1", listener.local_addr()?);
    // O `flush` importa: quem sobe o fixture le esta linha para descobrir a
    // porta, e sem ele a linha pode ficar no buffer ate o processo morrer.
    // Sincrono de proposito — e uma linha, antes do laco, e o stdout assincrono
    // do tokio custaria uma feature a mais no binario.
    std::io::Write::flush(&mut std::io::stdout())?;

    // Fechar a entrada padrao encerra o fixture, e so quando pedido. E como a
    // bateria de testes o desliga sem sinal, e ha uma razao concreta para nao
    // usar sinal ali: um processo morto por `SIGKILL` nunca grava o arquivo de
    // perfil, e a casca de E/S apareceria com zero por cento de cobertura por
    // um motivo que nao tem nada a ver com ela estar testada.
    //
    // Opcional porque quem sobe o fixture em segundo plano — o
    // `parity-gate.sh` — nao segura a entrada padrao, e ali ela e `/dev/null`:
    // EOF na primeira leitura. Incondicional, o gateway morria depois de
    // anunciar a porta e antes do primeiro pedido, e o gate acusava o
    // candidato de falha de transporte que era do instrumento.
    //
    // Nao e superficie de rede: quem fecha a entrada padrao ja e dono do
    // processo.
    let (tx, mut closed) = tokio::sync::oneshot::channel();
    let mut _owner = None;
    if std::env::args().any(|arg| arg == SHUTDOWN_FLAG) {
        watch_stdin(tx);
    } else {
        // Segurar o remetente e o que mantem o receptor pendente para sempre:
        // largado, ele resolveria na hora e o desligamento voltaria a ser
        // incondicional, so que por outro caminho.
        _owner = Some(tx);
    }

    loop {
        tokio::select! {
            _ = &mut closed => return Ok(()),
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                // Uma tarefa por conexao: o agente abre a proxima requisicao
                // antes de a anterior ter sido colhida, e servir em serie os
                // travaria.
                tokio::spawn(async move {
                    if let Err(err) = handle(stream).await {
                        eprintln!("fixture: {err}");
                    }
                });
            }
        }
    }
}

/// Avisa pelo canal quando a entrada padrão chegar ao fim.
///
/// Numa thread bloqueante, e não no runtime: ler a entrada padrão de forma
/// assíncrona custaria uma feature a mais do tokio, e esta leitura nunca
/// devolve dado — só o fim dele.
fn watch_stdin(tx: tokio::sync::oneshot::Sender<()>) {
    std::thread::spawn(move || {
        let mut descartado = Vec::new();
        let _ = std::io::Read::read_to_end(&mut std::io::stdin(), &mut descartado);
        let _ = tx.send(());
    });
}

async fn handle(mut stream: TcpStream) -> Result<()> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 8192];

    // Le ate o fim do cabecalho, que e onde o tamanho do corpo e declarado.
    let head_end = loop {
        if let Some(at) = find_head_end(&buffer) {
            break at;
        }
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Ok(());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_BODY {
            return Ok(());
        }
    };

    let head = String::from_utf8_lossy(&buffer[..head_end]).into_owned();
    let Some((method, path, length)) = parse_head(&head) else {
        return Ok(());
    };

    let body_start = head_end + 4;
    while buffer.len() < body_start + length.min(MAX_BODY) {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    let body = String::from_utf8_lossy(&buffer[body_start.min(buffer.len())..]).into_owned();

    stream
        .write_all(respond(&route(&method, &path, &body)).as_bytes())
        .await?;
    stream.flush().await?;
    Ok(())
}

fn find_head_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|w| w == b"\r\n\r\n")
}
