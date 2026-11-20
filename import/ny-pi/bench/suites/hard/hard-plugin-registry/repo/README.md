# docflow

Pequeno framework de pipeline de texto baseado em plugins (Python 3, só biblioteca padrão).

```python
from docflow import App

app = App()
app.run("strip-tags | collapse | title", "<i>big</i>   news")   # "Big News"
```

## Organização

| Caminho | Papel |
|---|---|
| `docflow/plugin.py` | classe base `Plugin` (`name`, `kind`, `priority`, `requires`, `setup`, `teardown`, `apply`) |
| `docflow/registry.py` | registro de plugins (`register`, `get`, `names`, `unregister`, `load`, `unload`, `loaded`, `clear`) |
| `docflow/hooks.py` | hooks de evento (`add_hook`, `emit`, `remove_hooks`) |
| `docflow/naming.py` | `normalize_name` |
| `docflow/errors.py` | exceções |
| `docflow/app.py` | fachada `App` (`plugins`, `enable`, `disable`, `run`, `close`) |
| `docflow/core/` | `Document`, `parse_spec`, `Pipeline`, `resolver`, `loader` |
| `docflow/cli/` | linha de comando |
| `docflow/plugins/` | plugins embutidos: `text`, `markup`, `stats`, `filters` |

## Plugins

Um plugin é uma subclasse de `Plugin`. `kind` é `"transform"` (entra em pipelines, implementa `apply`) ou
`"observer"` (só reage a hooks). `App.run` emite os eventos `before_run` (texto de entrada) e `after_run`
(texto final).

```python
from docflow import registry
from docflow.plugin import Plugin

@registry.register
class Exclaim(Plugin):
    name = "exclaim"

    def apply(self, text):
        return text + "!"
```

## CLI

`run_cli(argv)` em `docflow/cli/main.py` devolve `(código, texto)`:

- `list`: uma linha por plugin, `nome<TAB>prioridade<TAB>tipo`, na ordem de `names()`;
- `info <nome>`: quatro linhas, `name: …`, `kind: …`, `priority: …`, `requires: a, b` (ou `requires: -`);
- `run <spec> <texto>`: o resultado do pipeline;
- erro do docflow: código 1 e texto começando por `error:` seguido de um espaço; uso incorreto ou comando desconhecido: código 2.

## Estado atual e mudança planejada

Hoje o registro e os hooks são globais de módulo. A troca por registros por instância está especificada em
`docs/SPEC.md`.

## Testes

```bash
python3 -m pytest -q -p no:cacheprovider tests
```
