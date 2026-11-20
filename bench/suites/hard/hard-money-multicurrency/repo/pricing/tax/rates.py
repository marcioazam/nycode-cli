"""Regional tax rates."""

from decimal import Decimal

from pricing import config
from pricing.errors import UnknownRegionError


def rate_for_region(region: str) -> Decimal:
    try:
        return config.TAX_RATES[region]
    except KeyError:
        raise UnknownRegionError(region) from None
