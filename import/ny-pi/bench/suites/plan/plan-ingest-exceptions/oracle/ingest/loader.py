from ingest.errors import IngestError
from ingest.parser import parse_line
from ingest.validate import check


def load(lines, strict=False):
    records, errors = [], []
    for no, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            records.append(check(parse_line(line)))
        except IngestError as e:
            if strict:
                raise type(e)(f"{no}: {e}") from None
            errors.append(f"{no}: {e}")
    return records, errors
