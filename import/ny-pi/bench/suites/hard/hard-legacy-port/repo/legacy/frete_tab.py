# ruff: noqa: UP031, PLC0206  (estilo antigo de propósito: é o código legado a portar)
# frete_tab.py - tabelas de frete e consulta de zona (v2.3)
#
# ATENCAO: nao mexer nas tabelas sem falar com o comercial.
#
# Historico:
#   v1.0  tabela unica de preco
#   v2.0  zonas por faixa de CEP
#   v2.1  zona 0 (entrega local) pelo prefixo da origem
#   v2.3  excecoes por prefixo de 2 digitos
#
# Todos os valores em centavos, todos os pesos em gramas.

# CEP do deposito, ja sem tracos.
ORIGEM = "01310100"

# zona pelo PRIMEIRO digito do CEP de destino
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

# excecoes: os DOIS primeiros digitos mandam no primeiro digito
# (regioes de dificil acesso e um bolsao barato perto da capital)
ZONA_EXCECAO = {
    "08": 2,
    "29": 3,
    "68": 5,
    "69": 5,
    "79": 5,
}

# zona -> (ate 1 kg, ate 5 kg, ate 10 kg, por kg adicional acima de 10 kg)
TAB_PRECO = {
    0: (800, 1200, 1800, 150),
    1: (1500, 2200, 3100, 250),
    2: (1900, 2900, 4200, 350),
    3: (2400, 3800, 5600, 480),
    4: (3100, 4900, 7300, 620),
    5: (4500, 7200, 10900, 950),
}

# zona -> prazo do servico normal, em dias uteis
TAB_PRAZO = {0: 1, 1: 2, 2: 4, 3: 6, 4: 9, 5: 14}

# servico -> multiplicador em por cento
MULT_SERVICO = {"N": 100, "E": 150, "X": 220}

NOME_SERVICO = {"N": "NORMAL", "E": "EXPRESSO", "X": "EXTREMO"}

PESO_MAX = 30000  # gramas, por pedido (30 kg exatos ainda passam)
PISO = 1200  # frete minimo
COMBUSTIVEL_PCT = 5  # so nas zonas 3, 4 e 5
ZONA_COMBUSTIVEL = 3
VOLUMES_LIVRES = 10
TAXA_VOLUME = 200  # por volume alem do decimo
SEGURO_FRANQUIA = 50000
ZONA_SEM_EXTREMO = 5
ZONA_MAX_GRATIS = 2


def limpa_cep(cep):
    # Aceita '01310-100', '01310 100', '01.310-100', ' 01310100 '.
    # Tira so espaco, traco e ponto; qualquer outra coisa invalida.
    # Devolve '' quando o CEP nao presta (quem chama traduz para codigo 2).
    if cep is None:
        return ""
    s = str(cep)
    for ch in (" ", "-", "."):
        s = s.replace(ch, "")
    if len(s) != 8:
        return ""
    for ch in s:
        if ch not in "0123456789":
            return ""
    # o terminal antigo mandava 00000-000 quando o operador pulava o campo
    if s == "00000000":
        return ""
    return s


def zona_do_cep(cep8):
    # cep8 ja passou por limpa_cep.
    # Ordem importa: primeiro o prefixo local (3 digitos iguais aos da
    # origem), depois a excecao de 2 digitos, por ultimo o primeiro digito.
    if cep8[:3] == ORIGEM[:3]:
        return 0
    dois = cep8[:2]
    if dois in ZONA_EXCECAO:
        return ZONA_EXCECAO[dois]
    return ZONA_POR_DIGITO[cep8[0]]


def faixa_de_peso(peso_g):
    # 0 = ate 1 kg, 1 = ate 5 kg, 2 = ate 10 kg, 3 = acima
    # os limites pertencem a faixa de baixo (1000 g ainda e "ate 1 kg")
    if peso_g <= 1000:
        return 0
    if peso_g <= 5000:
        return 1
    if peso_g <= 10000:
        return 2
    return 3


def preco_base(zona, peso_g):
    linha = TAB_PRECO[zona]
    faixa = faixa_de_peso(peso_g)
    if faixa < 3:
        return linha[faixa]
    # acima de 10 kg: preco dos 10 kg mais um adicional por kg COMECADO
    # (10,1 kg paga 1 kg adicional inteiro)
    excedente = peso_g - 10000
    kgs = excedente // 1000
    if excedente % 1000:
        kgs = kgs + 1
    return linha[2] + kgs * linha[3]


def prazo_base(zona):
    return TAB_PRAZO[zona]


def nome_servico(letra):
    return NOME_SERVICO[letra]


def dump_tabela():
    # usado so pelo pessoal do comercial para conferir a tabela impressa
    linhas = []
    zonas = sorted(TAB_PRECO.keys())
    for z in zonas:
        t = TAB_PRECO[z]
        linhas.append(
            "zona %d: %6d %6d %6d +%d/kg  prazo %d"
            % (z, t[0], t[1], t[2], t[3], TAB_PRAZO[z])
        )
    return "\n".join(linhas)


def zonas_atendidas():
    return sorted(TAB_PRECO.keys())


def servicos_da_zona(zona):
    # letras de servico que a zona aceita, na ordem do cardapio
    letras = ["N", "E"]
    if zona != ZONA_SEM_EXTREMO:
        letras.append("X")
    return letras


def confere_tabelas():
    # sanidade rodada na subida do sistema; devolve lista de problemas
    problemas = []
    for z in TAB_PRECO:
        t = TAB_PRECO[z]
        if len(t) != 4:
            problemas.append("zona %d: linha de preco com %d colunas" % (z, len(t)))
            continue
        if not (t[0] <= t[1] <= t[2]):
            problemas.append("zona %d: precos fora de ordem" % z)
        if z not in TAB_PRAZO:
            problemas.append("zona %d: sem prazo" % z)
    for dig in "0123456789":
        if dig not in ZONA_POR_DIGITO:
            problemas.append("digito %s sem zona" % dig)
    for pref in ZONA_EXCECAO:
        if ZONA_EXCECAO[pref] not in TAB_PRECO:
            problemas.append("excecao %s aponta para zona inexistente" % pref)
    return problemas
