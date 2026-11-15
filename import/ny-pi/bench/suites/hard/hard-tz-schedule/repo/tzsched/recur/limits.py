"""Limites de uma série: contagem e data final (inclusiva, data local)."""

from datetime import timedelta

from tzsched.model.series import Series


def within_limits(series: Series, n: int) -> bool:
    if series.count is not None and n >= series.count:
        return False
    if series.until is not None:
        local_day = series.start_local.date() + timedelta(days=series.every_days * n)
        return local_day <= series.until
    return True
