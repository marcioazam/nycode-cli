from ingest.parser import parse_line
from ingest.validate import check


def load(lines):
    records, errors = [], []
    for no, line in enumerate(lines, 1):
        if not line.strip():
            continue
        rec = parse_line(line)
        if rec is None:
            errors.append(f"{no}: malformed")
            continue
        err = check(rec)
        if err:
            errors.append(f"{no}: {err}")
            continue
        records.append(rec)
    return records, errors
