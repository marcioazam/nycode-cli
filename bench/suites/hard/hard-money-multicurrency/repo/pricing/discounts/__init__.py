"""Discount rules and the engine that combines them."""

from pricing.discounts.base import Discount
from pricing.discounts.engine import total_discount
from pricing.discounts.fixed import FixedOff
from pricing.discounts.percent import PercentOff
from pricing.discounts.threshold import SpendThreshold

__all__ = ["Discount", "FixedOff", "PercentOff", "SpendThreshold", "total_discount"]
