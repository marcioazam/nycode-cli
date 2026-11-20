# ruff: noqa: UP031  (estilo antigo de propósito: é o código legado a portar)
# frete_fmt.py - saidas em texto (etiqueta do balcao e linha do arquivao)
#
# A impressora do balcao tem 24 colunas; por isso as linhas de valor
# sao rotulo em 8 colunas + valor alinhado a direita em 16.

from legacy import frete_tab

LARG_ROTULO = 8
LARG_VALOR = 16


def fmt_moeda(centavos):
    # 123456 -> 'R$ 1.234,56' ; 5 -> 'R$ 0,05'
    # (nunca recebe negativo)
    reais = centavos // 100
    cent = centavos % 100
    s = str(reais)
    grupos = []
    while len(s) > 3:
        grupos.insert(0, s[-3:])
        s = s[:-3]
    grupos.insert(0, s)
    return "R$ " + ".".join(grupos) + "," + "%02d" % cent


def fmt_peso(gramas):
    # sempre uma casa, virgula decimal: 2300 -> '2,3 kg' ; 800 -> '0,8 kg'
    # o peso taxavel e multiplo de 100 g, entao nao ha o que arredondar;
    # se vier quebrado, trunca.
    return "%d,%d kg" % (gramas // 1000, (gramas % 1000) // 100)


def fmt_cep(cep8):
    return cep8[:5] + "-" + cep8[5:]


def _linha_valor(rotulo, centavos):
    return "%-*s%*s" % (LARG_ROTULO, rotulo, LARG_VALOR, fmt_moeda(centavos))


def etiqueta(res):
    # Etiqueta do balcao. Sem quebra de linha no final.
    #
    # - a linha 'Seguro:' SO aparece quando o seguro e maior que zero
    #   (economia de papel);
    # - prazo 1 e '1 dia util', o resto e 'N dias uteis';
    # - um 'Aviso: ...' por aviso, na ordem em que foram gerados.
    linhas = []
    linhas.append("COTACAO #%04d" % res["num"])
    linhas.append("Destino: %s (zona %d)" % (fmt_cep(res["cep"]), res["zona"]))
    linhas.append("Servico: %s" % frete_tab.nome_servico(res["serv"]))
    linhas.append("Peso taxavel: %s" % fmt_peso(res["peso"]))
    linhas.append("Volumes: %d" % res["vol"])
    linhas.append(_linha_valor("Frete:", res["frete"]))
    if res["seguro"] > 0:
        linhas.append(_linha_valor("Seguro:", res["seguro"]))
    linhas.append(_linha_valor("Total:", res["total"]))
    if res["prazo"] == 1:
        linhas.append("Prazo: 1 dia util")
    else:
        linhas.append("Prazo: %d dias uteis" % res["prazo"])
    for av in res["avisos"]:
        linhas.append("Aviso: %s" % av)
    return "\n".join(linhas)


def linha_csv(res):
    # linha do arquivao: tudo inteiro, separado por ponto e virgula,
    # numero com 4 digitos, CEP sem traco, sem quebra de linha
    return "%04d;%s;%d;%s;%d;%d;%d;%d;%d;%d" % (
        res["num"],
        res["cep"],
        res["zona"],
        res["serv"],
        res["peso"],
        res["vol"],
        res["frete"],
        res["seguro"],
        res["total"],
        res["prazo"],
    )


def rodape(qtd_ok, qtd_erro, total):
    return "Cotacoes: %d  Erros: %d  Total: %s" % (qtd_ok, qtd_erro, fmt_moeda(total))


# ---------------------------------------------------------------------------
# Fechamento do dia (so o financeiro usa; NAO faz parte da cotacao)
# ---------------------------------------------------------------------------


def _zera_resumo():
    resumo = {}
    for z in sorted(frete_tab.TAB_PRECO.keys()):
        resumo[z] = {"qtd": 0, "peso": 0, "frete": 0, "seguro": 0}
    return resumo


def resumo_por_zona(resultados):
    # soma quantidade, peso taxavel, frete e seguro por zona
    resumo = _zera_resumo()
    for res in resultados:
        linha = resumo[res["zona"]]
        linha["qtd"] = linha["qtd"] + 1
        linha["peso"] = linha["peso"] + res["peso"]
        linha["frete"] = linha["frete"] + res["frete"]
        linha["seguro"] = linha["seguro"] + res["seguro"]
    return resumo


def resumo_por_servico(resultados):
    resumo = {}
    for letra in ("N", "E", "X"):
        resumo[letra] = 0
    for res in resultados:
        resumo[res["serv"]] = resumo[res["serv"]] + res["total"]
    return resumo


def fechamento(resultados):
    # Relatorio do financeiro, 40 colunas.
    # Zonas sem movimento nao aparecem; servicos aparecem sempre.
    linhas = []
    linhas.append("FECHAMENTO".center(40, "="))
    linhas.append("%-6s%4s%12s%18s" % ("zona", "qtd", "peso", "frete"))
    por_zona = resumo_por_zona(resultados)
    total_frete = 0
    total_seguro = 0
    for z in sorted(por_zona.keys()):
        linha = por_zona[z]
        if linha["qtd"] == 0:
            continue
        total_frete = total_frete + linha["frete"]
        total_seguro = total_seguro + linha["seguro"]
        linhas.append(
            "%-6d%4d%12s%18s"
            % (z, linha["qtd"], fmt_peso(linha["peso"]), fmt_moeda(linha["frete"]))
        )
    linhas.append("-" * 40)
    por_serv = resumo_por_servico(resultados)
    for letra in ("N", "E", "X"):
        linhas.append(
            "%-22s%18s" % (frete_tab.nome_servico(letra), fmt_moeda(por_serv[letra]))
        )
    linhas.append("-" * 40)
    linhas.append("%-22s%18s" % ("FRETE", fmt_moeda(total_frete)))
    linhas.append("%-22s%18s" % ("SEGURO", fmt_moeda(total_seguro)))
    linhas.append("%-22s%18s" % ("TOTAL", fmt_moeda(total_frete + total_seguro)))
    return "\n".join(linhas)


def ticket_medio(resultados):
    # media truncada do total; lista vazia da zero (nao estoura)
    if len(resultados) == 0:
        return 0
    soma = 0
    for res in resultados:
        soma = soma + res["total"]
    return soma // len(resultados)


def maior_cotacao(resultados):
    # devolve o resultado de maior total; empate fica com o PRIMEIRO
    maior = None
    for res in resultados:
        if maior is None or res["total"] > maior["total"]:
            maior = res
    return maior


def linhas_csv(resultados):
    # arquivao do dia: cabecalho + uma linha por cotacao + quebra final
    saida = ["num;cep;zona;serv;peso;vol;frete;seguro;total;prazo"]
    for res in resultados:
        saida.append(linha_csv(res))
    return "\n".join(saida) + "\n"
