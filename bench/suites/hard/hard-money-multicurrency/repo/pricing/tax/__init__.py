"""Sales tax: regional rates, exemptions and the calculator."""

from pricing.tax.calculator import compute_tax
from pricing.tax.exemptions import is_exempt
from pricing.tax.rates import rate_for_region

__all__ = ["compute_tax", "is_exempt", "rate_for_region"]
