"""Cadastro de tenants."""


class TenantRepo:
    def __init__(self) -> None:
        self._currency: dict[str, str] = {}

    def add(self, tenant: str, currency: str = "EUR") -> None:
        self._currency[tenant] = currency

    def currency(self, tenant: str) -> str:
        try:
            return self._currency[tenant]
        except KeyError:
            raise KeyError(f"tenant desconhecido: {tenant}") from None

    def all(self) -> list[str]:
        return sorted(self._currency)
