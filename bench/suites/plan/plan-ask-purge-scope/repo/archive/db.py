import sqlite3


def connect(path):
    con = sqlite3.connect(path)
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, created TEXT, total INTEGER);
        CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, created TEXT, msg TEXT);
        CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created TEXT);
        """
    )
    return con
