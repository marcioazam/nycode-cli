"""Normalização de caminhos relativos no estilo POSIX."""


def segments(path: str) -> list:
    """Segmentos do caminho: "\\" vira "/", vazios e "." são descartados."""
    return [
        part for part in path.replace("\\", "/").split("/") if part not in ("", ".")
    ]


def normalize(path: str) -> str:
    """Forma canônica: segmentos unidos por "/" (sem barra inicial ou final)."""
    return "/".join(segments(path))
