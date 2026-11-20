"""Resumo tipado."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Summary:
    total: int
    by_status: dict
    by_priority: dict
    open_by_tier: dict

    def to_dict(self):
        return {
            "total": self.total,
            "by_status": dict(self.by_status),
            "by_priority": dict(self.by_priority),
            "open_by_tier": dict(self.open_by_tier),
        }
