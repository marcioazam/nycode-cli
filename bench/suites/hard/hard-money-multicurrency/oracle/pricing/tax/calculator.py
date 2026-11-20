"""Tax on the discounted amount."""

from decimal import Decimal

from pricing.rounding import round_amount
from pricing.tax.exemptions import is_exempt
from pricing.tax.rates import rate_for_region


def compute_tax(
    taxable: Decimal,
    region: str,
    customer_type: str | None = None,
    currency: str = "USD",
) -> Decimal:
    """The region is validated even for exempt customers."""
    rate = rate_for_region(region)
    if is_exempt(customer_type):
        return round_amount(Decimal(0), currency)
    return round_amount(taxable * rate, currency)
