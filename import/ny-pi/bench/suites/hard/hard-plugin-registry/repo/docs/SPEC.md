# SPEC: registro de plugins por instância

Estado-alvo do docflow. Hoje plugins, plugins carregados e hooks vivem em dicionários globais de módulo
(`docflow/registry.py`, `docflow/hooks.py`). O alvo é a classe `docflow.registry.Registry`: cada instância tem os
seus plugins, os seus plugins carregados e os seus hooks. As funções globais antigas continuam existindo e delegam
a um registro default. Os plugins embutidos e todos os pontos de chamada migram.

Nesta especificação "nome" é sempre um nome de plugin; "registro" é uma instância de `Registry`.

## Exceções (`docflow.errors`)

| Classe | Bases | Situação |
|---|---|---|
| `DocflowError` | `Exception` | já existe |
| `PluginNotFoundError` | `DocflowError`, `KeyError` | já existe |
| `DuplicatePluginError` | `DocflowError`, `ValueError` | já existe |
| `PipelineError` | `DocflowError` | já existe |
| `InvalidPluginNameError` | `DocflowError`, `ValueError` | nova |
| `DependencyCycleError` | `DocflowError` | nova |
| `PluginInUseError` | `DocflowError` | nova |
| `PluginNotLoadedError` | `DocflowError` | nova |

O texto das mensagens é livre.

## Regras

### Registro e nomes

**R1. Instâncias isoladas.** `Registry(parent=None)`. Dois registros sem relação de parentesco não compartilham
nada: plugins, plugins carregados e hooks são de cada um. `parent`, quando dado, tem de ser um `Registry`; qualquer
outro valor levanta `TypeError`. A propriedade somente leitura `registry.parent` devolve o pai (ou `None`).

**R2. Normalização.** `docflow.naming.normalize_name(name) -> str`: o valor tem de ser `str`; tiram-se os espaços
das pontas, passa-se a minúsculas e cada `_` vira `-`. O resultado tem de casar por inteiro com
`[a-z][a-z0-9]*(-[a-z0-9]+)*` e ter no máximo 32 caracteres. Qualquer outro caso levanta
`InvalidPluginNameError`: valor que não é `str` (`None`, `3`, `b"x"`), `""`, `"   "`, `"9lives"`, `"a--b"`, `"-a"`,
`"a-"`, `"a b"`, `"a.b"`, `"café"`, 33 caracteres. Exemplo válido: `"  Word_Count "` vira `"word-count"`.

**R3. Normalização em toda entrada.** Todo método de `Registry` que recebe um nome (inclusive o `owner` de um
hook, quando não é `None`, e cada item de `requires`) aplica `normalize_name` antes de qualquer outra verificação;
nome inválido levanta `InvalidPluginNameError` (nunca `PluginNotFoundError`). Única exceção: `nome in registry`
devolve `False` para nome inválido ou valor que não é `str`, sem levantar.

**R4. `register`.** `registry.register(plugin_cls=None, *, name=None, priority=None, replace=False)`. Três formas:
`registry.register(Cls)`, `@registry.register` e `@registry.register(name=..., priority=...)`; nas três a classe
é devolvida sem alteração. O nome é `name` ou, na falta, `Cls.name`; a prioridade é `priority` ou, na falta,
`Cls.priority` (100 na classe base). O registro guarda nome e prioridade por conta própria e **não altera
atributos da classe**: a mesma classe pode estar em dois registros com nomes e prioridades diferentes.
Rejeições: `plugin_cls` que não é subclasse de `docflow.plugin.Plugin` levanta `TypeError`; prioridade que não
é `int` (ou que é `bool`) levanta `TypeError`. Prioridade negativa é válida.

**R5. Conflito de nomes.** Vale só para o próprio registro (um nome que existe apenas no pai pode ser registrado
no filho). Se o nome já está registrado no próprio registro:
a) com `replace=True`: a entrada passa a ter a nova classe e a nova prioridade e **conserva a posição original na
ordem de registro**; se o plugin está carregado neste registro, levanta `PluginInUseError` e nada muda;
b) sem `replace`, com a mesma classe (o mesmo objeto): não faz nada (classe, prioridade e posição ficam como
estavam) e não levanta;
c) sem `replace`, com outra classe: levanta `DuplicatePluginError` e nada muda.
`replace=True` com nome ainda não registrado é um registro comum.

**R6. Resolução.** `registry.get(name)` devolve a classe: primeiro o próprio registro, depois o pai, o avô e assim
por diante; o local vence o herdado. Nome em nenhum deles levanta `PluginNotFoundError`.
`registry.priority(name)` devolve a prioridade efetiva pela mesma resolução. `name in registry` segue a mesma
resolução (com a exceção de R3).

**R7. Listagem estável.** `registry.names(local=False)` devolve uma lista nova com os nomes visíveis (locais e
herdados; um nome sombreado aparece uma vez, com a entrada que vence). Ordem: prioridade efetiva crescente; em
empate, entradas de registros ancestrais antes das de descendentes (a raiz primeiro); no mesmo registro, ordem de
registro. `names(local=True)` lista só as entradas do próprio registro, pela mesma ordem. `iter(registry)` percorre
`names()` e `len(registry)` é `len(names())`.

**R8. `unregister`.** `registry.unregister(name)` remove a entrada do próprio registro. Nome que não está no
próprio registro (mesmo que exista no pai) levanta `PluginNotFoundError`. Plugin carregado neste registro levanta
`PluginInUseError` e nada muda. Removida uma entrada que sombreava o pai, a do pai volta a valer. Um nome removido
e registrado de novo entra no fim da ordem de registro.

### Carga e descarga

**R9. `load`.** `registry.load(name)` devolve a instância carregada. Se o nome já está carregado neste registro,
devolve a mesma instância sem chamar `setup()` de novo. Caso contrário resolve a classe (R6), cria a instância sem
argumentos, atribui `instancia.registry = registry` (o registro em que `load` foi chamado) e
`instancia.plugin_name = <nome normalizado>`, e só então chama `instancia.setup()` (sem argumentos). O estado de
carga é de cada registro: carregar no filho um plugin herdado do pai cria a instância no filho e não muda o pai.
`registry.loaded()` devolve uma lista nova com os nomes carregados neste registro, na ordem de carga;
`registry.is_loaded(name)` devolve `bool` e olha só o próprio registro.

**R10. Dependências.** `Cls.requires` é uma tupla de nomes. `load` carrega antes as dependências ainda não
carregadas, em profundidade e na ordem declarada, pelo mesmo registro (logo um plugin local vence o herdado também
como dependência). O `setup()` de uma dependência roda antes do de quem depende dela. A resolução termina **antes
de qualquer `setup()`**: dependência inexistente levanta `PluginNotFoundError` e ciclo (inclusive um plugin que
requer a si mesmo) levanta `DependencyCycleError`; nos dois casos nenhum `setup()` é chamado e nada fica carregado
por causa dessa chamada.

**R11. `setup()` que falha.** A exceção se propaga, o plugin não fica carregado e todos os hooks cujo dono é o
nome dele são removidos do registro. As dependências que já tinham sido carregadas nessa chamada continuam
carregadas.

**R12. Hooks.** `registry.add_hook(event, fn, owner=None, priority=100)`: `fn` que não é chamável levanta
`TypeError`; prioridade que não é `int` (ou que é `bool`) levanta `TypeError`; `event` é uma string usada como
está (não é normalizada). `registry.emit(event, *args, **kwargs)` chama os hooks do evento e devolve a lista dos
retornos na ordem das chamadas. Participam os hooks do próprio registro **e os dos ancestrais**. Ordem: prioridade
crescente; em empate, hooks de registros ancestrais antes dos de descendentes (a raiz primeiro); no mesmo
registro, ordem de inclusão. `emit` trabalha sobre um instantâneo: hooks incluídos ou removidos durante a emissão
não mudam a emissão em curso.

**R13. `remove_hooks`.** `registry.remove_hooks(owner)` remove os hooks desse dono no próprio registro (nunca nos
ancestrais), em todos os eventos, e devolve quantos removeu.

**R14. `unload`.** `registry.unload(name)`: nome não carregado neste registro levanta `PluginNotLoadedError`. Se
outro plugin carregado neste registro declara o nome em `requires`, levanta `PluginInUseError` e nada muda
(`teardown()` não é chamado). Caso contrário chama `instancia.teardown()`, remove os hooks cujo dono é o nome e
tira o plugin dos carregados. Se `teardown()` levantar, os hooks são removidos e o plugin fica descarregado do
mesmo jeito, e a exceção se propaga.

**R15. `unload_all`.** `registry.unload_all()` descarrega todos os plugins do registro na ordem inversa da de
carga e devolve a lista dos nomes na ordem em que foram descarregados. Se algum `teardown()` levantar, os demais
são descarregados mesmo assim e, ao final, a primeira exceção é relançada.

**R16. `clear`.** `registry.clear()` executa `unload_all()` e depois remove todas as entradas e todos os hooks do
próprio registro. O pai não é tocado.

### Compatibilidade

**R17. Registro default.** `docflow.registry.default_registry()` devolve sempre a mesma instância de `Registry`,
sem pai. As funções de módulo continuam existindo e delegam a ela: em `docflow.registry`,
`register(plugin_cls=None, *, name=None, priority=None, replace=False)`, `get(name)`, `names()`,
`unregister(name)`, `load(name)`, `unload(name)`, `loaded()` e `clear()`; em `docflow.hooks`,
`add_hook(event, fn, owner=None, priority=100)`, `emit(event, *args, **kwargs)` e `remove_hooks(owner)`. Elas
seguem as regras acima (por exemplo, `unload` de nome não carregado levanta `PluginNotLoadedError`).

**R18. Fim do estado global.** Os atributos de módulo `docflow.registry._PLUGINS`, `docflow.registry._LOADED` e
`docflow.hooks._HOOKS` deixam de existir.

### Plugins embutidos

**R19. Sem efeito na importação.** Importar `docflow` ou qualquer módulo de `docflow.plugins` não registra nada
em registro nenhum (nem no default). `docflow.plugins.install_builtins(registry)` registra os 14 plugins embutidos
no registro dado, na ordem da tabela; cada subpacote tem `install(registry)` para o seu grupo
(`docflow.plugins.text.install`, `docflow.plugins.markup.install`, `docflow.plugins.stats.install`,
`docflow.plugins.filters.install`). Chamar de novo sobre o mesmo registro não levanta e não muda nada (R5b).

| Ordem | Grupo | Nome | Tipo | Prioridade | `requires` |
|---|---|---|---|---|---|
| 1 | text | `lower` | transform | 50 | |
| 2 | text | `upper` | transform | 50 | |
| 3 | text | `title` | transform | 60 | |
| 4 | text | `strip` | transform | 10 | |
| 5 | text | `collapse` | transform | 20 | |
| 6 | text | `slugify` | transform | 65 | `lower`, `collapse` |
| 7 | markup | `strip-tags` | transform | 30 | |
| 8 | markup | `escape` | transform | 70 | |
| 9 | markup | `headings` | transform | 40 | |
| 10 | stats | `wordcount` | observer | 100 | |
| 11 | stats | `charcount` | observer | 100 | |
| 12 | stats | `audit` | observer | 200 | `wordcount` |
| 13 | filters | `redact-digits` | transform | 80 | |
| 14 | filters | `truncate` | transform | 90 | |

**R20. Embutidos usam o registro que os carregou.** Nenhum plugin embutido usa as funções globais: `slugify`
obtém `lower` e `collapse` por `self.registry`; `wordcount`, `charcount` e `audit` incluem os seus hooks em
`self.registry` com `owner=self.plugin_name`; `audit` lê o contador de `self.registry`. O comportamento de cada
plugin (o que `apply` devolve, os atributos `last`, `total` e `log`) não muda.

### Pontos de chamada

Em todos, `registry=None` significa o registro default.

**R21. Loader.** `docflow.core.loader.load_builtins(registry=None)` instala os embutidos no registro (R19) e pode
ser chamado várias vezes. `docflow.core.loader.load_plugins(names, registry=None)` carrega os nomes nesse registro
e devolve as instâncias na mesma ordem.

**R22. Pipeline e resolver.** `docflow.core.pipeline.Pipeline(stages, registry=None)` resolve e carrega os
estágios nesse registro; estágio que não é `transform` continua levantando `PipelineError`.
`docflow.core.resolver.resolve(name, registry=None)`, `by_kind(kind, registry=None)` (na ordem de `names()`) e
`describe(name, registry=None)` usam esse registro; em `describe`, `"name"` é o nome normalizado e `"priority"` é
a prioridade efetiva (R6).

**R23. App.** `docflow.app.App(registry=None)`; o registro da aplicação fica em `app.registry`.
Com `registry` dado: tem de ser um `Registry` (senão `TypeError`) e é usado como está; a `App` **não** instala os
embutidos nele. Sem `registry`: a `App` chama `load_builtins()` no registro default e cria um registro próprio,
`Registry(parent=default_registry())`; assim duas `App()` enxergam o que foi registrado globalmente, mas não
compartilham plugins carregados, hooks nem registros locais. `plugins()`, `enable(name)`, `disable(name)`,
`run(spec, text)` e `close()` operam sobre `app.registry`: `run` executa o pipeline nesse registro e emite
`before_run` e `after_run` nele; `close()` devolve o resultado de `app.registry.unload_all()`.

**R24. CLI.** `docflow.cli.main.run_cli(argv, registry=None)`: sem `registry` usa `App()`; com `registry` usa
`App(registry)`. `list` e `info` mostram a prioridade efetiva no registro da aplicação. Formatos e códigos de
saída não mudam (ver `README.md`); nome inválido é um erro do docflow (código 1).

## Preservado

A suíte `tests/` continua passando sem alteração.
