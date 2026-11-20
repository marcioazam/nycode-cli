# frete_calc.py - calculo da cotacao de frete
#
# Uso:
#     cod, res = calcula({'cep': '04567-000', 'serv': 'E', 'cupom': '',
#                         'itens': [(1200, 30, 20, 10, 2, 15000)]})
#     if cod == OK: ... res['total'] ...
#
# Cada item e uma tupla (peso_g, comp_cm, larg_cm, alt_cm, qtd, valor_cent).
# Os terminais mandavam tudo como texto, por isso _num().
#
# O modulo guarda estado global (ULTIMA, ACUMULADO, CONTADOR) porque o
# fechamento do dia lia direto daqui. Chamar zera() na virada do dia.

from legacy import frete_tab

OK = 0
ERR_VAZIO = 1
ERR_CEP = 2
ERR_ITEM = 3
ERR_SERVICO = 4
ERR_PESO = 5

ULTIMA = None
ACUMULADO = 0
CONTADOR = 0


def zera():
    global ULTIMA, ACUMULADO, CONTADOR
    ULTIMA = None
    ACUMULADO = 0
    CONTADOR = 0


def _num(v):
    # '12', ' 12 ' ou 12; lixo vira -1 (que os testes de faixa rejeitam)
    try:
        return int(str(v).strip())
    except ValueError:
        return -1


def _pct(valor, pct):
    # porcentagem com arredondamento comercial: meio centavo sobe
    # (valores aqui nunca sao negativos)
    return int(valor * pct / 100.0 + 0.5)


def _pesa_itens(itens):
    # Devolve (codigo, peso_g, volumes, valor_declarado).
    #
    # - qtd 0: a linha e pulada ANTES de qualquer validacao (o terminal
    #   mandava linhas zeradas para campos em branco);
    # - qtd negativa, peso <= 0 ou dimensao negativa: codigo 3 na hora,
    #   no primeiro item ruim;
    # - peso cubado em gramas = comp * larg * alt / 6, truncado
    #   (e o cm3/6000 em kg); vale o MAIOR entre real e cubado, item a
    #   item, e so entao multiplica pela quantidade;
    # - dimensao 0 e aceita (envelope): cubado 0.
    peso = 0
    volumes = 0
    valor = 0
    for it in itens:
        q = _num(it[4])
        if q == 0:
            continue
        p = _num(it[0])
        c = _num(it[1])
        l = _num(it[2])
        a = _num(it[3])
        if len(it) > 5:
            v = _num(it[5])
        else:
            v = 0
        if q < 0 or p <= 0:
            return (ERR_ITEM, 0, 0, 0)
        if c < 0 or l < 0 or a < 0:
            return (ERR_ITEM, 0, 0, 0)
        cubado = (c * l * a) // 6
        p = max(p, cubado)
        peso = peso + p * q
        volumes = volumes + q
        valor = valor + v * q
    if volumes == 0:
        # so descobre que esta vazio depois de olhar tudo
        return (ERR_VAZIO, 0, 0, 0)
    return (OK, peso, volumes, valor)


def _servico(serv, avisos):
    # So a PRIMEIRA letra conta ('expresso' -> E, 'xpto' -> X).
    # Vazio vira N sem reclamar; letra desconhecida vira N com aviso
    # (o aviso leva o texto como veio, so sem os espacos das pontas).
    if serv is None:
        return "N"
    s = str(serv).strip()
    if s == "":
        return "N"
    letra = s[0].upper()
    if letra not in frete_tab.MULT_SERVICO:
        avisos.append("servico desconhecido: " + s)
        return "N"
    return letra


def _cupom(cupom, frete, serv, zona, avisos):
    # FRETE10: 10% de desconto no frete (meio centavo sobe no desconto).
    #          O piso NAO e reaplicado depois do desconto.
    # GRATIS:  frete zero, mas so no servico N e ate a zona 2; fora disso
    #          o cupom e ignorado SEM aviso (decisao do comercial).
    # outro:   ignorado COM aviso, cupom em maiusculas.
    if cupom is None:
        return frete
    c = str(cupom).strip().upper()
    if c == "":
        return frete
    if c == "FRETE10":
        return frete - _pct(frete, 10)
    if c == "GRATIS":
        if serv == "N" and zona <= frete_tab.ZONA_MAX_GRATIS:
            return 0
        return frete
    avisos.append("cupom desconhecido: " + c)
    return frete


def _prazo(zona, serv, peso):
    # zona 0 e sempre 1 dia, nao importa o resto
    if zona == 0:
        return 1
    p = frete_tab.prazo_base(zona)
    if serv == "E":
        p = (p + 1) // 2  # metade, arredondando para cima
    elif serv == "X":
        p = 1
    if peso > 10000:
        p = p + 1  # carga pesada sai no dia seguinte (ate no X)
    return p


def calcula(pedido):
    # Devolve (codigo, resultado). resultado e None quando codigo != OK.
    #
    # ORDEM DAS CONFERENCIAS (nao mudar, o atendimento decorou):
    #   itens (3, depois 1) -> CEP (2) -> peso (5) -> servico (4)
    global ULTIMA, ACUMULADO, CONTADOR
    avisos = []

    cod, peso, volumes, valor = _pesa_itens(pedido.get("itens") or [])
    if cod != OK:
        return (cod, None)

    cep = frete_tab.limpa_cep(pedido.get("cep"))
    if cep == "":
        return (ERR_CEP, None)

    # peso taxavel: sobe para a proxima centena de grama, no total do pedido
    resto = peso % 100
    if resto:
        peso = peso + (100 - resto)
    if peso > frete_tab.PESO_MAX:
        return (ERR_PESO, None)

    zona = frete_tab.zona_do_cep(cep)
    serv = _servico(pedido.get("serv"), avisos)
    if serv == "X" and zona == frete_tab.ZONA_SEM_EXTREMO:
        return (ERR_SERVICO, None)

    base = frete_tab.preco_base(zona, peso)
    # combustivel entra na base, ANTES do multiplicador do servico
    if zona >= frete_tab.ZONA_COMBUSTIVEL:
        base = base + _pct(base, frete_tab.COMBUSTIVEL_PCT)
    frete = _pct(base, frete_tab.MULT_SERVICO[serv])

    # manuseio: depois do multiplicador, antes do piso
    if volumes > frete_tab.VOLUMES_LIVRES:
        frete = frete + frete_tab.TAXA_VOLUME * (volumes - frete_tab.VOLUMES_LIVRES)

    frete = max(frete, frete_tab.PISO)

    # cupom vem depois do piso; aviso de cupom vem depois do de servico
    frete = _cupom(pedido.get("cupom"), frete, serv, zona, avisos)

    # seguro: 1% do que passar da franquia, centavos quebrados jogados fora.
    # Cupom nenhum mexe no seguro.
    seguro = 0
    if valor > frete_tab.SEGURO_FRANQUIA:
        seguro = (valor - frete_tab.SEGURO_FRANQUIA) // 100

    total = frete + seguro

    # numeracao so anda quando a cotacao deu certo
    CONTADOR = CONTADOR + 1
    ACUMULADO = ACUMULADO + total
    res = {
        "num": CONTADOR,
        "cep": cep,
        "zona": zona,
        "serv": serv,
        "peso": peso,
        "vol": volumes,
        "frete": frete,
        "seguro": seguro,
        "total": total,
        "prazo": _prazo(zona, serv, peso),
        "avisos": avisos,
    }
    ULTIMA = res
    return (OK, res)


def calcula_varios(pedidos):
    # atalho do fechamento: devolve (lista de resultados, lista de codigos
    # de erro na ordem em que apareceram)
    bons = []
    ruins = []
    for p in pedidos:
        cod, res = calcula(p)
        if cod == OK:
            bons.append(res)
        else:
            ruins.append(cod)
    return (bons, ruins)
