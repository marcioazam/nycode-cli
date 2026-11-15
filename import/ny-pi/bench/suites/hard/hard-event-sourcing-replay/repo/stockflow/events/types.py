"""Tipos de evento conhecidos."""

STOCK_RECEIVED = "stock_received"
STOCK_COUNTED = "stock_counted"
STOCK_ADJUSTED = "stock_adjusted"
STOCK_RESERVED = "stock_reserved"
STOCK_RELEASED = "stock_released"
STOCK_SHIPPED = "stock_shipped"

ORDER_PLACED = "order_placed"
ORDER_LINE_ADDED = "order_line_added"
ORDER_LINE_REMOVED = "order_line_removed"
ORDER_PAID = "order_paid"
ORDER_SHIPPED = "order_shipped"
ORDER_CANCELLED = "order_cancelled"

STOCK_TYPES = frozenset(
    {
        STOCK_RECEIVED,
        STOCK_COUNTED,
        STOCK_ADJUSTED,
        STOCK_RESERVED,
        STOCK_RELEASED,
        STOCK_SHIPPED,
    }
)

ORDER_TYPES = frozenset(
    {
        ORDER_PLACED,
        ORDER_LINE_ADDED,
        ORDER_LINE_REMOVED,
        ORDER_PAID,
        ORDER_SHIPPED,
        ORDER_CANCELLED,
    }
)

KNOWN_TYPES = STOCK_TYPES | ORDER_TYPES
