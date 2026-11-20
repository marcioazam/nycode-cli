"""Outcome of one (arm, scenario) run: did the harness finish, fail loudly, fail silently or hang."""

from __future__ import annotations

from dataclasses import asdict, dataclass

OK, FAILED, SILENT, HUNG = "ok", "failed", "silent", "hung"
TIMEOUT_S = 120.0


@dataclass(frozen=True)
class Outcome:
    """Metrics of one run. ``silent`` = exit 0 without the expected final text (the error was masked)."""

    arm: str
    scenario: str
    status: str
    rc: int | None
    requests: int
    seconds: float
    note: str = ""

    @property
    def success(self) -> bool:
        """The run ended with the expected text."""
        return self.status == OK

    @property
    def masked(self) -> bool:
        """Exit 0 but no final text: a silent failure."""
        return self.status == SILENT

    def as_dict(self) -> dict[str, object]:
        """JSON form with the derived flags."""
        return {**asdict(self), "success": self.success, "masked": self.masked}


def classify(
    rc: int | None, stdout: str, final: str, *, timed_out: bool = False
) -> str:
    """Status of a finished (or killed) process; the expected text wins over the exit code."""
    if timed_out:
        return HUNG
    if final in stdout:
        return OK
    return SILENT if rc == 0 else FAILED
