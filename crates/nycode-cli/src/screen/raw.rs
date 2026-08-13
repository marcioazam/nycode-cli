//! O terminal em modo bruto, e a tradução de fim de linha que ele exige.
//!
//! Baixo nível de propósito: nada aqui sabe o que é uma sessão. Separado porque
//! muda quando o terminal muda, e o resto da tela muda quando a sessão muda.

use std::io::Write;

/// Mantém o terminal em modo bruto enquanto existir.
///
/// A restauração é no `Drop` porque o caminho de saída não é único: a sessão
/// termina por `Ctrl+D`, por erro, ou por `panic` com unwind num teste. Deixar
/// o terminal em modo bruto obriga o usuário a digitar `reset` às cegas.
#[derive(Debug)]
pub struct RawMode {
    active: bool,
    restore: Toggle,
}

/// Como o modo bruto é ligado e desligado.
///
/// Parâmetro e não chamada direta porque `enable_raw_mode` exige um TTY, e sem
/// esta costura a restauração — que é a parte que importa — ficaria sem teste
/// justamente na máquina de CI que não tem terminal.
type Toggle = fn() -> std::io::Result<()>;

impl RawMode {
    /// Entra em modo bruto.
    ///
    /// Falhar aqui não é fatal para o processo, mas é fatal para a sessão
    /// interativa: sem modo bruto não há leitura de tecla a tecla.
    pub fn enter() -> std::io::Result<Self> {
        Self::entering(
            crossterm::terminal::enable_raw_mode,
            crossterm::terminal::disable_raw_mode,
        )
    }

    fn entering(enter: Toggle, restore: Toggle) -> std::io::Result<Self> {
        enter()?;
        Ok(Self {
            active: true,
            restore,
        })
    }

    /// Sai antes do fim do escopo, para quando outro programa assume o terminal.
    pub fn leave(&mut self) {
        if self.active {
            let _ = (self.restore)();
            self.active = false;
        }
    }
}

impl Drop for RawMode {
    fn drop(&mut self) {
        self.leave();
    }
}

/// Escritor que traduz `\n` em `\r\n`.
///
/// Envolve o destino em vez de corrigir na origem porque a origem é o texto do
/// modelo, que não sabe em que modo o terminal está.
#[derive(Debug)]
pub struct Crlf<W: Write> {
    inner: W,
}

impl<W: Write> Crlf<W> {
    pub const fn new(inner: W) -> Self {
        Self { inner }
    }

    #[cfg(test)]
    pub fn into_inner(self) -> W {
        self.inner
    }

    /// Empresta o destino, para inspecionar o que foi escrito.
    #[cfg(test)]
    pub const fn inner(&self) -> &W {
        &self.inner
    }
}

impl<W: Write> Write for Crlf<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let mut start = 0;
        for (index, byte) in buf.iter().enumerate() {
            if *byte != b'\n' {
                continue;
            }
            self.inner.write_all(&buf[start..index])?;
            // Um `\n` que já vem precedido de `\r` não ganha outro: o texto
            // sairia com uma linha em branco a cada quebra.
            if index == 0 || buf[index - 1] != b'\r' {
                self.inner.write_all(b"\r")?;
            }
            self.inner.write_all(b"\n")?;
            start = index + 1;
        }
        self.inner.write_all(&buf[start..])?;
        // O contrato de `write` é reportar quanto do buffer de entrada foi
        // consumido, não quantos bytes saíram: os `\r` inseridos não contam.
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn flushing_reaches_the_inner_writer() {
        let mut writer = Crlf::new(Vec::new());
        writer.write_all(b"x").unwrap();
        writer.flush().unwrap();
        assert_eq!(writer.into_inner(), b"x");
    }

    /// Contador de quantas vezes a restauração foi pedida.
    static RESTORED: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    // A assinatura vem do tipo `Toggle`, então o `Result` é obrigatório mesmo
    // nos dublês que nunca falham.
    #[allow(clippy::unnecessary_wraps)]
    fn ok() -> std::io::Result<()> {
        Ok(())
    }

    #[allow(clippy::unnecessary_wraps)]
    fn counting() -> std::io::Result<()> {
        RESTORED.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    fn refuses() -> std::io::Result<()> {
        Err(std::io::Error::other("sem terminal"))
    }

    #[test]
    fn leaving_restores_the_terminal_exactly_once() {
        // O caminho de saida nao e unico: `leave` explicito e `Drop` podem
        // acontecer os dois, e restaurar duas vezes ligaria o eco de volta no
        // meio de outro programa.
        RESTORED.store(0, std::sync::atomic::Ordering::SeqCst);
        {
            let mut raw = RawMode::entering(ok, counting).unwrap();
            raw.leave();
            raw.leave();
        }
        assert_eq!(RESTORED.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[test]
    fn dropping_restores_the_terminal_even_without_an_explicit_leave() {
        // Sair por `panic` ou por erro deixaria o usuario digitando `reset` as
        // cegas.
        RESTORED.store(0, std::sync::atomic::Ordering::SeqCst);
        drop(RawMode::entering(ok, counting).unwrap());
        assert_eq!(RESTORED.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[test]
    fn a_terminal_that_refuses_raw_mode_reports_the_failure() {
        // Sem modo bruto nao ha leitura de tecla a tecla; seguir assim daria
        // uma sessao que nao responde a nada.
        assert!(RawMode::entering(refuses, ok).is_err());
    }
}
