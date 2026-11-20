"""Tabelas e consultas de zona/preço (mesmos valores do legado)."""

from util.numeros import teto_div
from util.texto import so_digitos

from frete.erros import ErroCep

ZONA_POR_DIGITO = {
    "0": 1,
    "1": 1,
    "2": 2,
    "3": 2,
    "4": 3,
    "5": 3,
    "6": 4,
    "7": 4,
    "8": 3,
    "9": 4,
}
ZONA_EXCECAO = {"08": 2, "29": 3, "68": 5, "69": 5, "79": 5}
TAB_PRECO = {
    0: (800, 1200, 1800, 150),
    1: (1500, 2200, 3100, 250),
    2: (1900, 2900, 4200, 350),
    3: (2400, 3800, 5600, 480),
    4: (3100, 4900, 7300, 620),
    5: (4500, 7200, 10900, 950),
}
TAB_PRAZO = {0: 1, 1: 2, 2: 4, 3: 6, 4: 9, 5: 14}
MULT_SERVICO = {"N": 100, "E": 150, "X": 220}
NOME_SERVICO = {"N": "NORMAL", "E": "EXPRESSO", "X": "EXTREMO"}


def normaliza_cep(cep) -> str:
    texto = "" if cep is None else str(cep)
    for ch in " -.":
        texto = texto.replace(ch, "")
    if len(texto) != 8 or not so_digitos(texto) or texto == "00000000":
        raise ErroCep(f"CEP invalido: {cep!r}")
    return texto


def zona_do_cep(cep8: str, origem8: str) -> int:
    if cep8[:3] == origem8[:3]:
        return 0
    if cep8[:2] in ZONA_EXCECAO:
        return ZONA_EXCECAO[cep8[:2]]
    return ZONA_POR_DIGITO[cep8[0]]


def preco_base(zona: int, peso_g: int) -> int:
    ate1, ate5, ate10, por_kg = TAB_PRECO[zona]
    if peso_g <= 1000:
        return ate1
    if peso_g <= 5000:
        return ate5
    if peso_g <= 10000:
        return ate10
    return ate10 + teto_div(peso_g - 10000, 1000) * por_kg
