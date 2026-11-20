"""Relatórios calculados sobre o estado reconstruído."""

from ..replay.full import replay_all


def low_stock(store, threshold, projections=None):
    """SKUs (sem o prefixo "sku:") com disponível < threshold, ordenados."""
    result = []
    for aggregate_id, state in replay_all(store, projections).items():
        levels = state.get("levels")
        if levels is None:
            continue
        if levels["on_hand"] - levels["reserved"] < threshold:
            result.append(aggregate_id.split(":", 1)[1])
    return sorted(result)


def order_summary(store, projections=None):
    """Quantidade de pedidos por status: {status: n}."""
    summary = {}
    for state in replay_all(store, projections).values():
        status = state.get("status")
        if status is None:
            continue
        summary[status["status"]] = summary.get(status["status"], 0) + 1
    return summary
