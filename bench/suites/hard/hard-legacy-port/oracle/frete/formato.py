"""Saídas em texto: etiqueta do balcão e linha CSV."""

from util.texto import agrupa_milhar

from frete.tabelas import NOME_SERVICO


def formata_moeda(centavos: int) -> str:
    return f"R$ {agrupa_milhar(centavos // 100)},{centavos % 100:02d}"


def formata_peso(gramas: int) -> str:
    return f"{gramas // 1000},{(gramas % 1000) // 100} kg"


def _valor(rotulo: str, centavos: int) -> str:
    return f"{rotulo:<8}{formata_moeda(centavos):>16}"


def etiqueta(cotacao) -> str:
    cep = cotacao.cep_destino
    linhas = [
        f"COTACAO #{cotacao.numero:04d}",
        f"Destino: {cep[:5]}-{cep[5:]} (zona {cotacao.zona})",
        f"Servico: {NOME_SERVICO[cotacao.servico]}",
        f"Peso taxavel: {formata_peso(cotacao.peso_taxavel_g)}",
        f"Volumes: {cotacao.volumes}",
        _valor("Frete:", cotacao.frete_centavos),
    ]
    if cotacao.seguro_centavos > 0:
        linhas.append(_valor("Seguro:", cotacao.seguro_centavos))
    linhas.append(_valor("Total:", cotacao.total_centavos))
    if cotacao.prazo_dias == 1:
        linhas.append("Prazo: 1 dia util")
    else:
        linhas.append(f"Prazo: {cotacao.prazo_dias} dias uteis")
    linhas.extend(f"Aviso: {aviso}" for aviso in cotacao.avisos)
    return "\n".join(linhas)


def linha_csv(cotacao) -> str:
    c = cotacao
    return (
        f"{c.numero:04d};{c.cep_destino};{c.zona};{c.servico};{c.peso_taxavel_g};"
        f"{c.volumes};{c.frete_centavos};{c.seguro_centavos};{c.total_centavos};{c.prazo_dias}"
    )
