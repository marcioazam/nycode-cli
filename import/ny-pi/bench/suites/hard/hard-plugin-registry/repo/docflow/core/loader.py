"""Carga dos plugins embutidos e de listas de plugins."""

import importlib

from docflow import registry
from docflow.plugins import GROUPS


def builtin_modules():
    """Caminhos de todos os módulos de plugins embutidos."""
    modules = []
    for group in GROUPS:
        package = importlib.import_module(f"docflow.plugins.{group}")  # nosemgrep
        modules.extend(package.MODULES)
    return modules


def load_builtins():
    """Importa os módulos embutidos; o decorador de cada um registra o plugin."""
    for module in builtin_modules():
        importlib.import_module(module)  # nosemgrep


def load_plugins(names):
    """Carrega os plugins pedidos e devolve as instâncias, na mesma ordem."""
    return [registry.load(name) for name in names]
