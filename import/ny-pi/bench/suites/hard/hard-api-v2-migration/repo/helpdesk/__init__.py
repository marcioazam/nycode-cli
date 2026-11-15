"""helpdesk: tickets de suporte com validação, roteamento, busca e relatórios."""

from helpdesk.desk import Desk
from helpdesk.errors import HelpdeskError, NotFoundError, ValidationError

__all__ = ["Desk", "HelpdeskError", "NotFoundError", "ValidationError"]
