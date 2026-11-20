class IngestError(ValueError):
    pass


class ParseError(IngestError):
    pass


class ValidationError(IngestError):
    pass
