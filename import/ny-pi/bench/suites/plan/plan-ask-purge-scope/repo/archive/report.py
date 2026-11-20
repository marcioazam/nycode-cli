TABLES = ("orders", "audit_log", "sessions")


def count(con, table):
    if table not in TABLES:  # identifiers cannot be bound as SQL parameters
        raise ValueError(f"unknown table: {table}")
    return con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]  # nosemgrep
