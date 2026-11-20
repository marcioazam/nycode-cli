"""Comandos da CLI. Cada um devolve o texto de saída."""

from docflow import registry
from docflow.app import App
from docflow.cli.formatting import format_info, format_row
from docflow.core import resolver


def cmd_list(app):
    """Uma linha por plugin disponível."""
    rows = []
    for name in app.plugins():
        cls = registry.get(name)
        rows.append(format_row(name, cls.priority, cls.kind))
    return "\n".join(rows)


def cmd_info(app, name):
    """Detalhes de um plugin."""
    return format_info(resolver.describe(name))


def cmd_run(app, spec, text):
    """Resultado do pipeline."""
    return app.run(spec, text)


def make_app():
    """Aplicação usada pela CLI."""
    return App()
