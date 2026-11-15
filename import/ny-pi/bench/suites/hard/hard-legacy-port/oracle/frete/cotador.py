"""Cálculo da cotação, com histórico por instância."""

from util.numeros import pct_meio_acima, teto_multiplo

from frete import tabelas
from frete.erros import ErroItem, ErroPedidoVazio, ErroPeso, ErroServico
from frete.modelos import Cotacao

PESO_MAX = 30000
PISO = 1200
SEGURO_FRANQUIA = 50000


def _pesa(itens):
    peso = volumes = valor = 0
    for it in itens:
        if it.quantidade == 0:
            continue
        if it.quantidade < 0 or it.peso_g <= 0:
            raise ErroItem("quantidade negativa ou peso nao positivo")
        if it.comprimento_cm < 0 or it.largura_cm < 0 or it.altura_cm < 0:
            raise ErroItem("dimensao negativa")
        cubado = (it.comprimento_cm * it.largura_cm * it.altura_cm) // 6
        peso += max(it.peso_g, cubado) * it.quantidade
        volumes += it.quantidade
        valor += it.valor_centavos * it.quantidade
    if volumes == 0:
        raise ErroPedidoVazio("pedido sem itens")
    return peso, volumes, valor


def _servico(servico, avisos):
    texto = "" if servico is None else str(servico).strip()
    if texto == "":
        return "N"
    letra = texto[0].upper()
    if letra not in tabelas.MULT_SERVICO:
        avisos.append("servico desconhecido: " + texto)
        return "N"
    return letra


def _cupom(cupom, frete, servico, zona, avisos):
    codigo = "" if cupom is None else str(cupom).strip().upper()
    if codigo == "":
        return frete
    if codigo == "FRETE10":
        return frete - pct_meio_acima(frete, 10)
    if codigo == "GRATIS":
        return 0 if servico == "N" and zona <= 2 else frete
    avisos.append("cupom desconhecido: " + codigo)
    return frete


def _prazo(zona, servico, peso):
    if zona == 0:
        return 1
    prazo = tabelas.TAB_PRAZO[zona]
    if servico == "E":
        prazo = (prazo + 1) // 2
    elif servico == "X":
        prazo = 1
    return prazo + 1 if peso > 10000 else prazo


class Cotador:
    def __init__(self, cep_origem: str = "01310-100"):
        self._origem = tabelas.normaliza_cep(cep_origem)
        self._historico = []

    @property
    def historico(self) -> tuple:
        return tuple(self._historico)

    @property
    def total_acumulado(self) -> int:
        return sum(c.total_centavos for c in self._historico)

    def cotar(self, pedido) -> Cotacao:
        avisos = []
        peso, volumes, valor = _pesa(pedido.itens)
        cep = tabelas.normaliza_cep(pedido.cep_destino)
        peso = teto_multiplo(peso, 100)
        if peso > PESO_MAX:
            raise ErroPeso("peso acima de 30 kg")
        zona = tabelas.zona_do_cep(cep, self._origem)
        servico = _servico(pedido.servico, avisos)
        if servico == "X" and zona == 5:
            raise ErroServico("servico X indisponivel na zona 5")

        base = tabelas.preco_base(zona, peso)
        if zona >= 3:
            base += pct_meio_acima(base, 5)
        frete = pct_meio_acima(base, tabelas.MULT_SERVICO[servico])
        if volumes > 10:
            frete += 200 * (volumes - 10)
        frete = max(frete, PISO)
        frete = _cupom(pedido.cupom, frete, servico, zona, avisos)
        seguro = (valor - SEGURO_FRANQUIA) // 100 if valor > SEGURO_FRANQUIA else 0

        cotacao = Cotacao(
            numero=len(self._historico) + 1,
            cep_destino=cep,
            zona=zona,
            servico=servico,
            peso_taxavel_g=peso,
            volumes=volumes,
            frete_centavos=frete,
            seguro_centavos=seguro,
            total_centavos=frete + seguro,
            prazo_dias=_prazo(zona, servico, peso),
            avisos=tuple(avisos),
        )
        self._historico.append(cotacao)
        return cotacao
