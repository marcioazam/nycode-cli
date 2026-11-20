"""Reconstrução do estado a partir do log."""

from .full import fold_events, initial_state, replay_aggregate, replay_all

__all__ = ["fold_events", "initial_state", "replay_aggregate", "replay_all"]
