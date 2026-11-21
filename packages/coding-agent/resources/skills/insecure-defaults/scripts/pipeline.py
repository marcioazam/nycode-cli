#!/usr/bin/env python3
"""Pipeline do /insecure-defaults-audit no pi: porte do workflows/audit.js (trailofbits/insecure-defaults 2.0.3).

O pi não tem a ferramenta Workflow do Claude Code. As partes que o script fazia sozinho (guardas, dedup, lotes,
contabilidade de cobertura) ficam aqui, determinísticas e testadas; os agentes rodam pelo `subagent` do pi, cada um
lendo o prompt que este script grava em <run>/prompts/. Fases:

  pipeline.py init <scope>      checa o corpus, cria o run e grava prompts/recon.md          -> {"run", "status"}
  pipeline.py sweeps <run>      lê recon.json, grava prompts/sweep-<categoria>.md (6)         -> {"status", "sweeps"}
  pipeline.py discover <run>    lê sweep-*.json, dedup, lotes, grava prompts/verify-*.md     -> {"status", "batches"}
  pipeline.py verify <run>      lê verdicts/*.json, cobertura, grava prompts/report.md       -> {"status", ...}
  pipeline.py finish <run>      confere report.md e devolve o resultado final               -> {"status", "report"}

Cada comando imprime uma linha JSON. "status" diferente de "ok" encerra a auditoria com aquele status (os mesmos do
audit.js: corpus-unreadable, recon-failed, scope-missing, search-failed, no-candidates, verify-failed, report-failed).
Testes: scripts/tests/test_pipeline.py.
"""
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
REFS = SKILL / 'references'
MAX_FINDINGS_PER_BATCH = 16

CATEGORIES = [
    {'id': 'fallback-secrets', 'title': 'Fallback secrets'},
    {'id': 'default-credentials', 'file': 'default-credential-rules', 'title': 'Default credentials'},
    {'id': 'fail-open-security', 'title': 'Fail-open security switches'},
    {'id': 'weak-crypto', 'title': 'Weak cryptographic defaults'},
    {'id': 'permissive-access', 'title': 'Permissive access defaults'},
    {'id': 'debug-features', 'title': 'Debug and introspection defaults'},
]
CATEGORY_IDS = [c['id'] for c in CATEGORIES]
SEED_FILES = {c['id']: c.get('file', c['id']) for c in CATEGORIES}  # file stem differs only where the id trips secret-name guards

RECON_FIELDS = ['scope_exists', 'languages', 'config_locations', 'deploy_manifests', 'exclude_paths']
SWEEP_CONTEXT = ['languages', 'frameworks', 'config_locations', 'config_accessors', 'deploy_manifests', 'exclude_paths']
VERIFY_CONTEXT = ['scope', 'exclude_paths', 'deploy_manifests']

RECON_SCHEMA = '''{
  "scope_exists": true,              // do teste no disco; false encerra a auditoria
  "languages": ["..."],
  "frameworks": [{"name": "...", "settings_paths": ["..."]}],
  "config_locations": ["..."],
  "config_accessors": [{"idiom": "get_config('X') ou settings.FOO", "where": "arquivo:linha",
                        "supplies_default": true}],   // true: o acessor devolve um padrão quando a chave falta
  "deploy_manifests": ["arquivos que fornecem variáveis de ambiente em produção"],
  "exclude_paths": ["testes, fixtures, exemplos, docs, vendorizado (nunca o próprio escopo)"]
}'''

CANDIDATES_SCHEMA = '''{
  "corpus_read": true,           // true só se você leu o .md da categoria
  "patterns_loaded": true,       // true só se você leu os seeds do .json
  "files_scanned": 0,            // quantos arquivos as buscas PERCORRERAM (com ou sem casamento); 0 = a busca não rodou
  "seed_patterns_run": ["os seeds do .json que você rodou, literais"],
  "derived_patterns": ["padrões que você escreveu para ESTA stack"],
  "candidates": [{"file": "caminho", "line": 1, "snippet": "...", "symbol": "...", "why_suspicious": "..."}]
}'''

VERDICTS_SCHEMA = '''{
  "verdicts": [{
    "file": "caminho", "line": 1, "refuted": true,
    "refuted_at_step": 1,                       // 1-5, ou null se confirmado
    "shape": "configurable | unconditional",
    "sink": "arquivo:linha onde o valor chega a uma decisão de segurança",
    "deployment_supplies_var": "always | sometimes | never | unknown",   // só configurable
    "severity": "CRITICAL | HIGH | MEDIUM | LOW",                        // todo confirmado
    "exploitation": "...", "rationale": "..."
  }]
}'''

JSON_RULE = ('Grave o resultado com a ferramenta `write` em `{out}` como JSON válido (sem comentários, sem texto fora do '
             'JSON) neste formato:\n\n```jsonc\n{schema}\n```\n\nEsse arquivo é o único que você escreve. Na resposta '
             'final, só o caminho do arquivo e uma linha de resumo.')


def emit(obj: dict) -> int:
    print(json.dumps(obj, ensure_ascii=False))
    return 0 if obj.get('status') in ('ok', 'findings', 'no-findings-confirmed') else 3


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def context_for(fields: list[str], source: dict) -> str:
    return '<context>\n' + json.dumps({k: source.get(k, []) or [] for k in fields}, indent=2, ensure_ascii=False) + '\n</context>'


def dir_of(f: str) -> str:
    i = f.rfind('/')
    return '.' if i == -1 else f[:i]


def corpus_problems() -> list[str]:
    """As três fontes de cada categoria precisam concordar (o seed-coverage.js do plugin, versão curta)."""
    problems = []
    for cat in CATEGORIES:
        data = load_json(REFS / f"{SEED_FILES[cat['id']]}.json")
        md = REFS / f"{cat['id']}.md"
        if not isinstance(data, dict):
            problems.append(f"{cat['id']}.json ausente ou inválido")
        else:
            if data.get('id') != cat['id'] or data.get('title') != cat['title']:
                problems.append(f"{cat['id']}.json: id/título não batem com a categoria")
            seeds = data.get('seeds')
            if not seeds or not all(isinstance(s, str) for s in seeds):
                problems.append(f"{cat['id']}.json sem seeds")
            elif any(re.search(r'\\[sdb]', s) for s in seeds):
                problems.append(f"{cat['id']}.json usa \\s, \\d ou \\b (não é POSIX ERE)")
        if not md.is_file():
            problems.append(f"{cat['id']}.md ausente")
        else:
            text = md.read_text(encoding='utf-8')
            if '**Report when:**' not in text or '**Skip when:**' not in text:
                problems.append(f"{cat['id']}.md sem as linhas Report when / Skip when")
    return problems


# ------------------------------------------------------------------ prompts (texto do audit.js, em português)

def recon_prompt(scope: str, out: Path) -> str:
    return f'''Você é a fase de reconhecimento (recon) de uma auditoria de padrões inseguros (insecure defaults) de `{scope}`.

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

''' + JSON_RULE.format(out=out, schema=RECON_SCHEMA)


def sweep_prompt(cat: dict, scope: str, context: str, out: Path) -> str:
    return f'''Você é a varredura **{cat['title']}** de uma auditoria de padrões inseguros de `{scope}`.

## Passo 0: carregue a definição da categoria

Leia os dois arquivos antes de tudo:

- `{REFS}/{SEED_FILES[cat['id']]}.json` traz os `seeds` a rodar.
- `{REFS}/{cat['id']}.md` traz **Report when** / **Skip when**, mais pares vulnerável/seguro em várias linguagens com o
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

''' + JSON_RULE.format(out=out, schema=CANDIDATES_SCHEMA)


def verify_prompt(batch: dict, context: str) -> str:
    by_file: dict[str, list] = {}
    for c in batch['candidates']:
        by_file.setdefault(c['file'], []).append(
            {k: c.get(k) for k in ('line', 'snippet', 'symbol', 'why_suspicious')})
    n_files = len(by_file)
    dirs = batch['dirs']
    where = f' em `{dirs[0]}`' if len(dirs) == 1 else f' em {len(dirs)} diretórios'
    same_dir = ('\n\nTodos estão num só diretório, então provavelmente compartilham imports, um módulo de config e as '
                'mesmas convenções de framework. Rastreie o primeiro e reaproveite o que aprendeu em vez de refazer por '
                'arquivo.') if len(dirs) == 1 else ''
    corpus = REFS / f"{batch['category']}.md"
    return f'''Você está refutando candidatos **{batch['category']}** em {n_files} arquivo{'s' if n_files != 1 else ''}{where}.{same_dir}

{context}

<candidates>
{json.dumps(by_file, indent=2, ensure_ascii=False)}
</candidates>

Todos os candidatos aqui são **{batch['category']}**, então um corpus cobre o lote. Leia `{corpus}` primeiro: ele traça
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
```'''


def report_prompt(scope: str, confirmed: list, refuted: list, coverage: dict, out: Path) -> str:
    keep = [{k: v for k, v in f.items() if k not in ('refuted', 'refuted_at_step')} for f in confirmed]
    ref = [{k: f.get(k) for k in ('category', 'file', 'line', 'refuted_at_step', 'rationale')} for f in refuted]
    return f'''Monte o relatório final de uma auditoria de padrões inseguros de `{scope}`.

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
escreve. Na resposta final, só o caminho do arquivo.'''


# ------------------------------------------------------------------ fases

def cmd_init(scope: str, base: str | None = None) -> dict:
    problems = corpus_problems()
    if problems:
        return {'status': 'corpus-unreadable', 'note': f'Corpus em {REFS} incompleto: ' + '; '.join(problems) +
                '. Nada foi auditado.', 'examples_dir': str(REFS)}
    scope = (scope or '.').strip() or '.'
    run = Path(tempfile.mkdtemp(prefix=f'insecure-defaults-{time.strftime("%Y%m%d-%H%M%S")}-', dir=base))
    (run / 'prompts').mkdir()
    (run / 'verdicts').mkdir()
    (run / 'state.json').write_text(json.dumps({'scope': scope, 'cwd': os.getcwd()}), encoding='utf-8')
    (run / 'prompts' / 'recon.md').write_text(recon_prompt(scope, run / 'recon.json'), encoding='utf-8')
    return {'status': 'ok', 'run': str(run), 'scope': scope, 'next': 'recon',
            'recon_prompt': str(run / 'prompts' / 'recon.md'), 'recon_out': str(run / 'recon.json')}


def state(run: Path) -> dict:
    data = load_json(run / 'state.json')
    if not isinstance(data, dict):
        raise ValueError(f'{run} não é um run do insecure-defaults (sem state.json)')
    return data


def cmd_sweeps(run: Path) -> dict:
    st = state(run)
    recon = load_json(run / 'recon.json')
    if not isinstance(recon, dict) or any(k not in recon for k in RECON_FIELDS):
        return {'status': 'recon-failed', 'note': 'O recon não devolveu um recon.json válido; sem perfil para as varreduras.'}
    if recon.get('scope_exists') is False:
        return {'status': 'scope-missing', 'note': f"`{st['scope']}` não existe no disco. Nada foi auditado."}
    profile = {**recon, 'scope': st['scope']}
    st['profile'] = profile
    (run / 'state.json').write_text(json.dumps(st, ensure_ascii=False), encoding='utf-8')
    ctx = context_for(SWEEP_CONTEXT, profile)
    sweeps = []
    for cat in CATEGORIES:
        prompt = run / 'prompts' / f"sweep-{cat['id']}.md"
        out = run / f"sweep-{cat['id']}.json"
        prompt.write_text(sweep_prompt(cat, st['scope'], ctx, out), encoding='utf-8')
        sweeps.append({'category': cat['id'], 'prompt': str(prompt), 'out': str(out)})
    log = (f"Recon: {', '.join(recon.get('languages') or []) or 'nenhuma linguagem identificada'} | "
           f"{len(recon.get('config_accessors') or [])} acessores de config | "
           f"{len(recon.get('deploy_manifests') or [])} manifestos de deploy")
    return {'status': 'ok', 'log': log, 'sweeps': sweeps}


def pack_batches(candidates: list[dict]) -> list[dict]:
    """Por categoria, até 16 por lote, diretórios inteiros sempre que couberem (first-fit em ordem lexicográfica)."""
    by_cat: dict[str, list] = {}
    for c in candidates:
        by_cat.setdefault(c['category'], []).append(c)
    batches = []
    for category, group in by_cat.items():
        by_dir: dict[str, list] = {}
        for c in group:
            by_dir.setdefault(dir_of(c['file']), []).append(c)
        dirs = sorted(by_dir.items())
        for _, items in dirs:
            items.sort(key=lambda c: (c['file'], c['line']))
        packed, current = [], []
        for _, items in dirs:
            if len(items) > MAX_FINDINGS_PER_BATCH:
                if current:
                    packed.append(current)
                    current = []
                for i in range(0, len(items), MAX_FINDINGS_PER_BATCH):
                    packed.append(items[i:i + MAX_FINDINGS_PER_BATCH])
                continue
            if len(current) + len(items) > MAX_FINDINGS_PER_BATCH:
                packed.append(current)
                current = []
            current.extend(items)
        if current:
            packed.append(current)
        for i, cands in enumerate(packed):
            label = f'{category}-{i + 1}' if len(packed) > 1 else category
            batches.append({'label': label, 'category': category, 'candidates': cands,
                            'dirs': sorted({dir_of(c['file']) for c in cands}), 'chunk': i + 1, 'chunks': len(packed)})
    return batches


def as_int(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def cmd_discover(run: Path) -> dict:
    st = state(run)
    if 'profile' not in st:
        return {'status': 'recon-failed', 'note': 'Rode `sweeps` antes de `discover`.'}
    sweeps = []
    for cid in CATEGORY_IDS:
        data = load_json(run / f'sweep-{cid}.json')
        if isinstance(data, dict):
            sweeps.append({**data, 'category': cid})
    corpus_failures = [s['category'] for s in sweeps if s.get('corpus_read') is False or s.get('patterns_loaded') is False]
    if corpus_failures:
        return {'status': 'corpus-unreadable', 'examples_dir': str(REFS), 'categories_affected': corpus_failures,
                'note': (f'{len(corpus_failures)}/{len(CATEGORIES)} varreduras não carregaram a definição da categoria de '
                         f"{REFS}: {', '.join(corpus_failures)}. Nada foi auditado; confira se a skill está completa.")}
    total = sum(as_int(s.get('files_scanned')) for s in sweeps)
    if not sweeps or total == 0:
        return {'status': 'search-failed',
                'note': (f'{len(sweeps)}/{len(CATEGORIES)} varreduras voltaram e varreram {total} arquivos no total. '
                         'Isso é falha de busca, NÃO auditoria limpa. Não relate o alvo como livre de padrões inseguros.'),
                'sweeps': [{'category': s['category'], 'files_scanned': as_int(s.get('files_scanned')),
                            'patterns_run': len(s.get('seed_patterns_run') or []) + len(s.get('derived_patterns') or [])}
                           for s in sweeps]}
    by_cat = {s['category']: s for s in sweeps}
    scanned_by_cat = {cid: as_int((by_cat.get(cid) or {}).get('files_scanned')) for cid in CATEGORY_IDS}
    unsearched = [cid for cid in CATEGORY_IDS if not scanned_by_cat[cid]]
    seen: dict[str, dict] = {}
    raw = 0
    for s in sweeps:
        for c in s.get('candidates') or []:
            if not isinstance(c, dict) or not c.get('file'):
                continue
            raw += 1
            c = {**c, 'line': as_int(c.get('line')), 'category': s['category']}
            seen.setdefault(f"{s['category']}:{c['file']}:{c['line']}", c)  # mesmo padrão-linha: o primeiro vale
    candidates = list(seen.values())
    seed_only = [s['category'] for s in sweeps if not s.get('derived_patterns')]
    st.update(sweeps_summary={'total_scanned': total, 'scanned_by_category': scanned_by_cat, 'unsearched': unsearched,
                              'raw': raw, 'seed_only': seed_only,
                              'categories_run': [s['category'] for s in sweeps],
                              'patterns_run': sum(len(s.get('seed_patterns_run') or []) + len(s.get('derived_patterns') or [])
                                                  for s in sweeps)},
              candidates=candidates)
    notes = []
    if unsearched:
        notes.append(f"{len(unsearched)}/{len(CATEGORIES)} varreduras não varreram arquivo nenhum: {', '.join(unsearched)}. "
                     'Essas categorias NÃO estão cobertas.')
    if seed_only:
        notes.append(f"{len(seed_only)}/{len(CATEGORIES)} varreduras só rodaram os seeds genéricos: {', '.join(seed_only)}.")
    log = f'Discover: {raw} candidatos brutos em {total} arquivos varridos -> {len(candidates)} locais únicos após o dedup'
    if not candidates:
        (run / 'state.json').write_text(json.dumps(st, ensure_ascii=False), encoding='utf-8')
        note = (f'{len(CATEGORIES) - len(unsearched)}/{len(CATEGORIES)} varreduras varreram {total} arquivos sem marcar '
                'candidato. Essas buscas rodaram, então é um negativo genuíno para elas e não uma falha, mas é ausência '
                'de casamento de padrão, não prova de ausência.')
        if unsearched:
            note += f" Não diz nada sobre {', '.join(unsearched)}: essas varreduras não varreram arquivo nenhum."
        return {'status': 'no-candidates', 'note': note, 'scanned': total, 'files_scanned_by_category': scanned_by_cat,
                'unsearched_categories': unsearched, 'log': log, 'notes': notes}
    batches = pack_batches(candidates)
    ctx = context_for(VERIFY_CONTEXT, st['profile'])
    out = []
    for b in batches:
        prompt = run / 'prompts' / f"verify-{b['label']}.md"
        prompt.write_text(verify_prompt(b, ctx), encoding='utf-8')
        out.append({'label': b['label'], 'category': b['category'], 'candidates': len(b['candidates']),
                    'prompt': str(prompt), 'verdict_out': str(run / 'verdicts' / f"{b['label']}.json")})
    st['batches'] = [{'label': b['label'], 'category': b['category']} for b in batches]
    (run / 'state.json').write_text(json.dumps(st, ensure_ascii=False), encoding='utf-8')
    single_dir = sum(1 for b in batches if len(b['dirs']) == 1)
    log += (f"; {len(batches)} lote(s) de verificação em {len({b['category'] for b in batches})} categoria(s), "
            f'{single_dir}/{len(batches)} num só diretório')
    return {'status': 'ok', 'log': log, 'notes': notes, 'batches': out}


def extract_json(text: str):
    """O último bloco ```json de uma resposta, ou o texto inteiro se ele já for JSON."""
    blocks = re.findall(r'```(?:json|jsonc)?\s*\n(.*?)```', text, flags=re.S)
    for candidate in [*reversed(blocks), text]:
        try:
            return json.loads(candidate)
        except ValueError:
            continue
    return None


def cmd_verify(run: Path) -> dict:
    st = state(run)
    if 'batches' not in st:
        return {'status': 'verify-failed', 'note': 'Rode `discover` antes de `verify`.'}
    verdicts, batches_verified = [], 0
    for b in st['batches']:
        path = run / 'verdicts' / f"{b['label']}.json"
        data = None
        if path.is_file():
            raw = path.read_text(encoding='utf-8')
            data = extract_json(raw)
        if isinstance(data, dict) and isinstance(data.get('verdicts'), list):
            batches_verified += 1
            for v in data['verdicts']:
                if isinstance(v, dict) and v.get('file'):
                    verdicts.append({**v, 'line': as_int(v.get('line')), 'category': b['category']})
    candidates = st['candidates']
    confirmed = [v for v in verdicts if v.get('refuted') is False]
    refuted = [v for v in verdicts if v.get('refuted') is not False]
    adjudicated = {f"{v['category']}:{v['file']}:{v['line']}" for v in verdicts}
    unadjudicated = [c for c in candidates if f"{c['category']}:{c['file']}:{c['line']}" not in adjudicated]
    sw = st['sweeps_summary']
    coverage = {
        'scope': st['scope'], 'files_scanned': sw['total_scanned'], 'categories_run': sw['categories_run'],
        'files_scanned_by_category': sw['scanned_by_category'], 'unsearched_categories': sw['unsearched'],
        'patterns_run': sw['patterns_run'], 'seed_only_sweeps': sw['seed_only'], 'raw_candidates': sw['raw'],
        'unique_candidates': len(candidates), 'files_with_candidates': len({c['file'] for c in candidates}),
        'batches_run': len(st['batches']), 'batches_verified': batches_verified,
        'unadjudicated': [f"{c['category']}:{c['file']}:{c['line']}" for c in unadjudicated],
    }
    result = {'coverage': coverage, 'findings': confirmed, 'refuted': refuted}
    (run / 'result.json').write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
    log = (f'Verify: {len(confirmed)} confirmados, {len(refuted)} refutados, {len(unadjudicated)} sem veredito em '
           f"{batches_verified}/{len(st['batches'])} lotes")
    if len(unadjudicated) == len(candidates):
        return {'status': 'verify-failed', 'log': log, 'coverage': coverage, 'candidates': coverage['unadjudicated'],
                'note': (f"{batches_verified}/{len(st['batches'])} lotes de verificação voltaram e nenhum dos "
                         f'{len(candidates)} candidatos foi julgado. Falha de verificação, NÃO auditoria limpa: rode de novo.')}
    (run / 'prompts' / 'report.md').write_text(
        report_prompt(st['scope'], confirmed, refuted, coverage, run / 'report.md'), encoding='utf-8')
    return {'status': 'ok', 'log': log, 'confirmed': len(confirmed), 'refuted': len(refuted),
            'unadjudicated': len(unadjudicated), 'report_prompt': str(run / 'prompts' / 'report.md'),
            'report_out': str(run / 'report.md')}


def cmd_finish(run: Path) -> dict:
    result = load_json(run / 'result.json')
    if not isinstance(result, dict):
        return {'status': 'verify-failed', 'note': 'Sem result.json: rode `verify` antes de `finish`.'}
    report = run / 'report.md'
    if not report.is_file() or not report.read_text(encoding='utf-8').strip():
        return {'status': 'report-failed', 'result': str(run / 'result.json'),
                'note': (f"A auditoria terminou e {len(result['findings'])} achado(s) sobreviveram à verificação, mas o "
                         'relatório não foi escrito. Apresente findings, refuted e coverage de result.json. Não rode a '
                         'auditoria de novo e não relate o alvo como limpo.')}
    return {'status': 'findings' if result['findings'] else 'no-findings-confirmed', 'report': str(report),
            'result': str(run / 'result.json'), 'coverage': result['coverage']}


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in ('init', 'sweeps', 'discover', 'verify', 'finish', 'check-corpus'):
        print(__doc__, file=sys.stderr)
        return 2
    cmd, rest = argv[0], argv[1:]
    try:
        if cmd == 'check-corpus':
            problems = corpus_problems()
            return emit({'status': 'ok' if not problems else 'corpus-unreadable', 'problems': problems,
                         'examples_dir': str(REFS)})
        if cmd == 'init':
            return emit(cmd_init(rest[0] if rest else '.'))
        if not rest:
            raise ValueError(f'uso: pipeline.py {cmd} <run>')
        run = Path(rest[0])
        return emit({'sweeps': cmd_sweeps, 'discover': cmd_discover, 'verify': cmd_verify, 'finish': cmd_finish}[cmd](run))
    except (ValueError, OSError, KeyError) as err:
        return emit({'status': 'error', 'note': str(err)})


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
