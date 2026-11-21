"""Categorias, esquemas JSON e textos dos prompts do pipeline.py (texto do audit.js, em português)."""

import json
from pathlib import Path
from typing import Any

SKILL = Path(__file__).resolve().parents[1]
REFS = SKILL / "references"

CATEGORIES = [
    {"id": "fallback-secrets", "title": "Fallback secrets"},
    {
        "id": "default-credentials",
        "file": "default-credential-rules",
        "title": "Default credentials",
    },
    {"id": "fail-open-security", "title": "Fail-open security switches"},
    {"id": "weak-crypto", "title": "Weak cryptographic defaults"},
    {"id": "permissive-access", "title": "Permissive access defaults"},
    {"id": "debug-features", "title": "Debug and introspection defaults"},
]
CATEGORY_IDS = [c["id"] for c in CATEGORIES]
SEED_FILES = {
    c["id"]: c.get("file", c["id"]) for c in CATEGORIES
}  # file stem differs only where the id trips secret-name guards


RECON_SCHEMA = """{
  "scope_exists": true,              // do teste no disco; false encerra a auditoria
  "languages": ["..."],
  "frameworks": [{"name": "...", "settings_paths": ["..."]}],
  "config_locations": ["..."],
  "config_accessors": [{"idiom": "get_config('X') ou settings.FOO", "where": "arquivo:linha",
                        "supplies_default": true}],   // true: o acessor devolve um padrão quando a chave falta
  "deploy_manifests": ["arquivos que fornecem variáveis de ambiente em produção"],
  "exclude_paths": ["testes, fixtures, exemplos, docs, vendorizado (nunca o próprio escopo)"]
}"""

CANDIDATES_SCHEMA = """{
  "corpus_read": true,           // true só se você leu o .md da categoria
  "patterns_loaded": true,       // true só se você leu os seeds do .json
  "files_scanned": 0,            // quantos arquivos as buscas PERCORRERAM (com ou sem casamento); 0 = a busca não rodou
  "seed_patterns_run": ["os seeds do .json que você rodou, literais"],
  "derived_patterns": ["padrões que você escreveu para ESTA stack"],
  "candidates": [{"file": "caminho", "line": 1, "snippet": "...", "symbol": "...", "why_suspicious": "..."}]
}"""

VERDICTS_SCHEMA = """{
  "verdicts": [{
    "file": "caminho", "line": 1, "refuted": true,
    "refuted_at_step": 1,                       // 1-5, ou null se confirmado
    "shape": "configurable | unconditional",
    "sink": "arquivo:linha onde o valor chega a uma decisão de segurança",
    "deployment_supplies_var": "always | sometimes | never | unknown",   // só configurable
    "severity": "CRITICAL | HIGH | MEDIUM | LOW",                        // todo confirmado
    "exploitation": "...", "rationale": "..."
  }]
}"""

JSON_RULE = (
    "Grave o resultado com a ferramenta `write` em `{out}` como JSON válido (sem comentários, sem texto fora do "
    "JSON) neste formato:\n\n```jsonc\n{schema}\n```\n\nEsse arquivo é o único que você escreve. Na resposta "
    "final, só o caminho do arquivo e uma linha de resumo."
)


def recon_prompt(scope: str, out: Path) -> str:
    return f"""Você é a fase de reconhecimento (recon) de uma auditoria de padrões inseguros (insecure defaults) de `{scope}`.

Relate só o que observou. Lista vazia é resposta válida; lista chutada não é.

**1. Confira que o escopo existe.**

    test -e '{scope}' && echo present

Preencha `scope_exists` por esse teste, não pelo formato do caminho. Caminho inexistente encerra a auditoria em vez de
varrer nada e parecer limpo.

**2. Faça o perfil do alvo** para as varreduras por categoria se adaptarem a ele. Um arquivo único é perfilado junto com
a maquinaria de configuração de que depende (imports, o wrapper de config que chama, o módulo de settings que lê), não
o repositório inteiro:

- Linguagens presentes, com as extensões a buscar.
- Frameworks web/app e os caminhos concretos dos módulos de settings: Django `settings.py`, Rails
  `config/environments/*.rb`, Spring `application*.yml`, bootstrap do Express, flags do Go em `main.go`.
- Onde a configuração vive: diretórios de config, arquivos `.env*`, as funções que este código usa para ler variáveis
  de ambiente (um wrapper local `get_config()` importa mais que `os.environ` cru).
- **Manifestos de deploy que fornecem variáveis em produção**: Dockerfile, `docker-compose*.yml`, manifests Kubernetes,
  values do Helm, Terraform, workflows de CI, units systemd, Procfile. Essa lista decide se um fallback é alcançável em
  produção; seja minucioso.
- Caminhos a **excluir** por não serem produção: testes e fixtures, `*.example` / `*.template` / `*.sample`, docs,
  dependências vendorizadas, código gerado, saída de build. **Nunca exclua `{scope}` nem nada dentro dele.** Quem chamou
  apontou para lá, então é o alvo, por mais que pareça teste; excluí-lo varreria nada e daria resultado limpo. As
  exclusões descrevem o que pular *fora* do escopo pedido.

Use só leitura e busca (`bash` com `test`, `ls`, `grep -rE`, `find`; `read`). Não altere nada no alvo.

""" + JSON_RULE.format(out=out, schema=RECON_SCHEMA)


def sweep_prompt(cat: dict[str, Any], scope: str, context: str, out: Path) -> str:
    return f"""Você é a varredura **{cat["title"]}** de uma auditoria de padrões inseguros de `{scope}`.

## Passo 0: carregue a definição da categoria

Leia os dois arquivos antes de tudo:

- `{REFS}/{SEED_FILES[cat["id"]]}.json` traz os `seeds` a rodar.
- `{REFS}/{cat["id"]}.md` traz **Report when** / **Skip when**, mais pares vulnerável/seguro em várias linguagens com o
  motivo de cada lado. Cobre **só a sua categoria**. Essas duas linhas são a regra do que conta como candidato; aplique-as
  ao pé da letra e use a seção **SECURE** para descartar candidatos em vez de registrá-los.

Preencha `patterns_loaded` e `corpus_read` conforme leu cada um de fato. Se algum faltar ou não puder ser lido, marque
`false` e **pare sem varrer**: os seeds dizem o que procurar e o corpus diz o que descartar; chutar qualquer um dos dois
produz ruído que parece achado.

{context}

**Alvo da busca: `{scope}`.** Busque recursivamente; `grep -rE` cobre diretório e arquivo único. Só linhas **dentro de
`{scope}`** são candidatas, embora você possa ler imports e os helpers de config que ele chama para preencher `symbol`.

Quem chamou nomeou esse caminho, então ele nunca está fora do escopo: relate candidatos nele mesmo sob um diretório de
testes ou exemplos, anotando o local em `why_suspicious` para o verificador pesar. Pule o que `exclude_paths` do recon
lista, mas mantenha um caminho que pareça alcançável em produção apesar do nome suspeito e diga por quê em
`why_suspicious`.

## Passo 1: derive os padrões para *esta* stack

Os seeds do `.json` são um **piso, não a busca**: escritos sem conhecer este projeto, perdem o idioma que domina aqui.
Antes de buscar, escreva os padrões da sua categoria para a stack do perfil acima, a partir de:

- **`config_accessors`**: os wrappers do próprio projeto. Um código que lê tudo por `get_setting("X", "default")` quase
  não casa `os.environ.get` cru, e os achados reais estão nas chamadas desse wrapper. `supplies_default: true` marca onde
  mora o fail-open.
- **`frameworks`**: as chaves de settings que o framework usa para a *sua* categoria (Django `SECRET_KEY`/`DEBUG`,
  Spring `server.ssl.*`/`management.endpoints.*`, Rails `force_ssl`/`secret_key_base`).
- **`languages`**: formas por linguagem, como `System.getProperty(k, d)`, `ENV.fetch`, `flag.String`, `${{VAR:-default}}`.
- **`config_locations` e `deploy_manifests`**: o mesmo bug em sintaxe de config, como um `default =` num `variable {{}}`
  do HCL, um literal em `values.yaml`, uma linha `ENV` num Dockerfile. Nenhum seed em forma de código acha isso.

Mantenha os padrões POSIX ERE: `[[:space:]]` e `[0-9]`, nunca `\\s`, `\\d` ou `\\b`. Alguns `grep` deixam de casar esses
sem avisar, e um padrão que não casa nada parece exatamente um resultado limpo.

## Passo 2: rode e colete

Rode também os seeds do `.json`, relatando-os em `seed_patterns_run` e os seus em `derived_patterns`. Manter os dois
separados é o ponto: `derived_patterns` vazio diz que esta varredura só procurou idiomas genéricos, o que vira lacuna de
cobertura no relatório.

**Colete candidatos, não os julgue.** Não gaste turnos verificando se o app quebra sem a config; um verificador separado
faz isso com o arquivo inteiro em contexto. Leia o bastante em volta de cada casamento para preencher `snippet` e
`symbol` e siga. Coletar demais é barato aqui; perder uma linha não é.

Muitos achados reais **não envolvem configuração nenhuma**: credencial fixa no código, primitiva fraca, ACL pública,
stack trace escrito numa resposta. Registre esses, e não pule um candidato por não haver variável de ambiente ou
fallback à vista.

Relate `files_scanned`: quantos arquivos as suas buscas **percorreram**, tenham casado ou não (o universo pesquisado;
conte com `grep -rlE '' <alvo> | wc -l` restrito às extensões e exclusões que você usou, ou com `find`). Não é o
número de arquivos com casamento: uma varredura que rodou e não achou nada relata os arquivos percorridos e
`candidates: []`. 0 significa que a busca não rodou (alvo vazio, padrão inválido) e nunca pode virar resultado limpo.

Use só leitura e busca (`grep -rE`, `find`, `read`); não altere nada no alvo.

""" + JSON_RULE.format(out=out, schema=CANDIDATES_SCHEMA)


def verify_prompt(batch: dict[str, Any], context: str) -> str:
    by_file: dict[str, list[Any]] = {}
    for c in batch["candidates"]:
        by_file.setdefault(c["file"], []).append(
            {k: c.get(k) for k in ("line", "snippet", "symbol", "why_suspicious")}
        )
    n_files = len(by_file)
    dirs = batch["dirs"]
    where = f" em `{dirs[0]}`" if len(dirs) == 1 else f" em {len(dirs)} diretórios"
    same_dir = (
        (
            "\n\nTodos estão num só diretório, então provavelmente compartilham imports, um módulo de config e as "
            "mesmas convenções de framework. Rastreie o primeiro e reaproveite o que aprendeu em vez de refazer por "
            "arquivo."
        )
        if len(dirs) == 1
        else ""
    )
    corpus = REFS / f"{batch['category']}.md"
    return f"""Você está refutando candidatos **{batch["category"]}** em {n_files} arquivo{"s" if n_files != 1 else ""}{where}.{same_dir}

{context}

<candidates>
{json.dumps(by_file, indent=2, ensure_ascii=False)}
</candidates>

Todos os candidatos aqui são **{batch["category"]}**, então um corpus cobre o lote. Leia `{corpus}` primeiro: ele traça
a linha entre relatar e pular nesta categoria, com pares vulnerável/seguro. O corpus de nenhuma outra categoria importa.

**Sua resposta padrão é `refuted: true`.** Uma varredura por padrão produziu isto; a maioria dos casamentos não é
vulnerabilidade. Confirme um só quando puder citar o código que o torna explorável.

Trabalhe um arquivo por vez: leia-o e julgue todos os candidatos dele antes de seguir. Para cada candidato percorra os
passos **em ordem e pare no primeiro que o refuta**, registrando qual em `refuted_at_step`:

1. **O arquivo é alcançável em produção?** Caminho em `exclude_paths`, código morto, ramo só tomado sob flag de dev,
   script que nunca é empacotado -> refutado.
2. **O valor inseguro é o que roda de fato?** A pergunta depende da forma do candidato; classifique primeiro:
   - **Configurable**: o valor vem de uma leitura de config com fallback. Rastreie o que acontece quando a config falta.
     Qualquer coisa que pare o processo (leitura que levanta erro, validador de startup, schema que rejeita ausência) é
     **fail-secure -> refutado**. Subir e seguir com o literal é fail-open; continue.
   - **Unconditional**: não há configuração no caminho; o valor inseguro está escrito no código. **Este passo não pode
     refutar um candidato unconditional**: o valor inseguro é o único valor. Registre a forma e vá ao passo 3.

   **Não** refute um unconditional por "nenhuma configuração encontrada", nem o registre como `trace incomplete` por
   isso. Cerca de metade do que esta auditoria existe para achar não tem fallback de config. A seção **VULNERABLE** do
   seu corpus mostra as formas que esta categoria toma na prática.
3. **O valor é inseguro de fato?** A linha **Skip when** é a regra, e a seção **SECURE** mostra um casamento benigno.
   Para um configurable o estado inseguro precisa ser o estado *sem configuração*; para um unconditional, julgue o valor
   como está escrito.
4. **O valor chega a uma decisão de segurança?** Rastreie até o sink e cite `arquivo:linha`: assinatura, criptografia,
   autenticação, autorização, comparação de credencial, verificação de transporte. Um valor de config lido e nunca
   consultado num ponto de controle -> refutado.
5. **O deploy sempre fornece a variável?** Só para configurable; unconditional não tem variável e nada no deploy o
   mitiga. Confira cada manifesto em `deploy_manifests` e diga qual caso vale em `deployment_supplies_var`. **Nenhum
   valor aqui refuta nada**, só move a severidade:
   - `always` (todo manifesto define): o defeito no código continua, mas é bem menos explorável. Confirme com
     severidade menor.
   - `never`: o caso CRITICAL. Produção roda com o fallback.
   - `sometimes` (alguns definem, outros não): trate como alcançável com severidade cheia e nomeie os manifestos que
     deixam sem definir, que são os deploys expostos.
   - `unknown`: você olhou e não conseguiu estabelecer. Trate como alcançável e diga no `rationale` quais manifestos não
     resolveu. Não use para dizer que pulou o passo.

Siga imports e chamadores aonde o rastreio levar, mas só os pares `file`/`line` listados acima entram na saída. Não
cace candidatos novos: seis varreduras já buscaram, e o que você achar agora pularia o dedup e chegaria sem verificação.

Devolva um veredito para **cada** candidato listado, refutações incluídas: um omitido vira "não verificado" e lacuna de
cobertura, pior que uma refutação com motivo. Se não conseguir completar um rastreio, devolva `refuted: true` com
`rationale` `"trace incomplete: <o que bloqueou>"`.

Dê `severity` a todo candidato confirmado, de CRITICAL a LOW, pela evidência. Não segure confirmações de baixa
severidade: o filtro é depois, e um achado que você deixa de relatar ninguém consegue revisar.

Cite `arquivo:linha` em toda afirmação. Revisão somente leitura: não altere nenhum arquivo.

Termine a resposta com **um único** bloco ```json contendo exatamente este formato (sem comentários) e nada depois dele:

```jsonc
{VERDICTS_SCHEMA}
```"""


def report_prompt(
    scope: str,
    confirmed: list[Any],
    refuted: list[Any],
    coverage: dict[str, Any],
    out: Path,
) -> str:
    keep = [
        {k: v for k, v in f.items() if k not in ("refuted", "refuted_at_step")}
        for f in confirmed
    ]
    ref = [
        {
            k: f.get(k)
            for k in ("category", "file", "line", "refuted_at_step", "rationale")
        }
        for f in refuted
    ]
    return f"""Monte o relatório final de uma auditoria de padrões inseguros de `{scope}`.

<confirmed_findings>
{json.dumps(keep, indent=2, ensure_ascii=False)}
</confirmed_findings>

<refuted>
{json.dumps(ref, indent=2, ensure_ascii=False)}
</refuted>

<coverage>
{json.dumps(coverage, indent=2, ensure_ascii=False)}
</coverage>

Escreva markdown, em português. Não rejulgue os vereditos: os verificadores tinham o contexto dos arquivos e você não.
Seu trabalho é apresentação, agrupamento e contabilidade honesta da cobertura.

O tamanho segue a evidência. A seção de um achado vai até onde o rastreio precisa: cite o que o estabelece e siga. Não
repita no resumo o que a seção do achado já diz, não estique uma seção para igualar outra e não acrescente seções além
das cinco abaixo.

Estrutura:

1. **Resumo**: contagem por severidade e uma frase sobre a exposição real deste código. Separe os achados configurable
   (um fallback que o deploy pode ou não sobrescrever) dos unconditional (inseguros como escritos, nada a configurar);
   pedem correções diferentes e têm urgência diferente.
2. **Achados**, por severidade, uma seção cada, neste formato:

       Achado: <título>
       Local: <arquivo>:<linha>
       Padrão: <a linha ofensiva>

       Verificação: <o que o rastreio estabeleceu, com o sink em arquivo:linha>
       Impacto em produção: <configurable: se o deploy fornece a variável, pelos manifestos conferidos; unconditional:
       diga isso claramente, porque nenhuma configuração mitiga>
       Exploração: <o ataque concreto, ou "não explorável como configurado" com o motivo>

   Quando vários achados têm a mesma causa (um módulo de config, um wrapper), agrupe sob essa causa e liste os locais em
   vez de repetir a análise.
3. **Correção**: agrupada por correção, não por achado. `env['X']` no lugar de `env.get('X', default)`, um validador de
   startup, um backend de segredos. Nomeie os arquivos a mudar.
4. **Cobertura e limites**: obrigatória e direta. Diga o `scope`, arquivos varridos, categorias rodadas, quantos padrões
   distintos rodaram (`patterns_run`; um número perto da contagem de seeds significa que as varreduras mal se adaptaram
   à stack) e candidatos achados versus refutados. Todo arquivo com candidato foi verificado, então estas são as
   lacunas, cada uma dita explicitamente quando não vazia:
   - `unsearched_categories`: essas categorias varreram 0 arquivos (veja `files_scanned_by_category`), então a busca não
     rodou. Aparecem em `categories_run` porque a varredura voltou, não porque buscou. Liste-as sob "**Não buscado**" e
     diga que a auditoria não cobre nada nelas. Nunca as apresente como limpas.
   - `unadjudicated`: candidatos entregues a um verificador que voltou sem veredito, listados como
     `categoria:arquivo:linha`. Ponha sob "**Não verificado**" e diga que podem conter achados reais.
   - `batches_verified` abaixo de `batches_run`: um lote de verificação morreu, levando até 16 candidatos. Diga a
     diferença; os candidatos afetados estão em `unadjudicated`.
   - `seed_only_sweeps`: essas categorias rodaram só os seeds genéricos e não derivaram nada para a stack, então a
     cobertura delas é mais fina. Nomeie-as.

   Um leitor não pode confundir uma execução parcial com uma completa.
5. **Candidatos refutados**: uma tabela compacta (local, passo, motivo em uma linha). É a trilha de auditoria de por que
   um casamento foi descartado, e é o que torna a execução revisável.

Grave o markdown com a ferramenta `write` em `{out}` (só o relatório, nada mais). Esse é o único arquivo que você
escreve. Na resposta final, só o caminho do arquivo."""
