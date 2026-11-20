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


class UnknownCurrencyError(PricingError):
    """A currency code is not in the supported table."""


class CurrencyMismatchError(PricingError):
    """Amounts of different currencies were combined without conversion."""


class InvalidRateError(PricingError, ValueError):
    """An exchange rate is not positive or relates a currency to itself."""


class RateNotFoundError(PricingError):
    """No exchange rate is known for the pair on the requested date."""


class MissingRuleError(PricingError):
    """No shipping rule is configured for the currency."""
