"""Projeções: reduzem os eventos de um agregado a um estado."""

from .base import Projection
from .registry import applicable_projections, default_projections

__all__ = ["Projection", "applicable_projections", "default_projections"]
