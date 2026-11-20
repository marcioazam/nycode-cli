"""Exception hierarchy of the pricing engine."""


class PricingError(Exception):
    """Base class of every error raised by the engine."""


class InvalidAmountError(PricingError, ValueError):
    """A monetary amount or percentage is malformed or out of range."""


class InvalidQuantityError(PricingError, ValueError):
    """A quantity is not a positive integer."""


class UnknownProductError(PricingError, KeyError):
    """A SKU is not in the catalog or in the cart."""


class UnknownRegionError(PricingError, KeyError):
    """A tax region has no configured rate."""
