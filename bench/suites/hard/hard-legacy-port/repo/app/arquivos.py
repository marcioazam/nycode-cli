"""Leitura de arquivos de lote do disco."""

from app import config


def linhas_uteis(texto: str) -> list:
    """Linhas não vazias e que não começam com o marcador de comentário."""
    saida = []
    for linha in texto.splitlines():
        limpa = linha.strip()
        if limpa == "" or limpa.startswith(config.COMENTARIO):
            continue
        saida.append(limpa)
    return saida


def le_lote(caminho: str) -> list:
    with open(caminho, encoding="utf-8") as fh:
        return linhas_uteis(fh.read())
