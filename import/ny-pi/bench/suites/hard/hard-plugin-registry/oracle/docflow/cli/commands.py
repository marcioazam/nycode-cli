"""Comandos da CLI. Cada um devolve o texto de saída."""

from docflow.app import App
from docflow.cli.formatting import format_info, format_row
from docflow.core import resolver


def cmd_list(app):
    """Uma linha por plugin disponível."""
    registry = app.registry
    rows = []
    for name in app.plugins():
        rows.append(format_row(name, registry.priority(name), registry.get(name).kind))
    return "\n".join(rows)


def cmd_info(app, name):
    """Detalhes de um plugin."""
    return format_info(resolver.describe(name, app.registry))


def cmd_run(app, spec, text):
    """Resultado do pipeline."""
    return app.run(spec, text)


def make_app(registry=None):
    """Aplicação usada pela CLI."""
    return App(registry)
