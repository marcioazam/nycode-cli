"""Canonical names shared by the reader and the validator."""

COLUMNS = (
    "order_id",
    "date",
    "region",
    "product",
    "quantity",
    "unit_price",
    "discount_pct",
)

OPTIONAL_COLUMNS = ("status",)

REGIONS = ("NORTH", "SOUTH", "EAST", "WEST")

STATUSES = ("paid", "refunded", "cancelled")
