"""Imports a bench/harbor agent module against stubbed harbor modules; nothing leaks into sys.modules."""

import importlib
import sys
import types
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest

from bench.tests.helpers import BENCH


@contextmanager
def import_agent(pi_base: type, *names: str) -> Iterator[list[Any]]:
    """Yield the modules `names` of bench/harbor, imported with harbor's Pi agent replaced by `pi_base`."""
    with pytest.MonkeyPatch.context() as mp:
        for n in (
            "harbor",
            "harbor.agents",
            "harbor.agents.installed",
            "harbor.environments",
        ):
            mp.setitem(sys.modules, n, types.ModuleType(n))
        stubs: dict[str, dict[str, Any]] = {
            "harbor.agents.installed.pi": {"Pi": pi_base},
            "harbor.agents.installed.node_install": {
                "nvm_node_install_snippet": lambda: "NVM"
            },
            "harbor.environments.base": {"BaseEnvironment": object},
        }
        for n, attrs in stubs.items():
            m = types.ModuleType(n)
            m.__dict__.update(attrs)
            mp.setitem(sys.modules, n, m)
        mp.syspath_prepend(str(BENCH / "harbor"))
        for n in names:
            sys.modules.pop(n, None)
        try:
            yield [importlib.import_module(n) for n in names]
        finally:
            for n in names:
                sys.modules.pop(n, None)
