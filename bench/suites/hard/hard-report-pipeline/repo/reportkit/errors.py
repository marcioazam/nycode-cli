"""Exception hierarchy of the pipeline (SPEC section 1)."""


class ReportError(Exception):
    """Base class of every error the pipeline raises on purpose."""


class ReadError(ReportError):
    """The CSV text cannot be split into rows (stage 1)."""


class ValidationError(ReportError):
    """One or more rows break the validation rules (stage 2)."""

    def __init__(self, errors):
        self.errors = list(errors)
        super().__init__("\n".join(self.errors))


class ExportError(ReportError):
    """The requested output cannot be produced (stage 5)."""
