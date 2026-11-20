"""Tipos imutáveis da API."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Item:
    peso_g: int
    comprimento_cm: int
    largura_cm: int
    altura_cm: int
    quantidade: int = 1
    valor_centavos: int = 0


@dataclass(frozen=True)
class Pedido:
    cep_destino: str
    itens: tuple
    servico: str = "N"
    cupom: str = ""


@dataclass(frozen=True)
class Cotacao:
    numero: int
    cep_destino: str
    zona: int
    servico: str
    peso_taxavel_g: int
    volumes: int
    frete_centavos: int
    seguro_centavos: int
    total_centavos: int
    prazo_dias: int
    avisos: tuple = ()
