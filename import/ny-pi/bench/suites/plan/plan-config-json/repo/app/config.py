import configparser


def load(path):
    cp = configparser.ConfigParser()
    if not cp.read(path):
        raise FileNotFoundError(path)
    return {
        "host": cp.get("server", "host", fallback="localhost"),
        "port": cp.getint("server", "port", fallback=8080),
        "debug": cp.getboolean("server", "debug", fallback=False),
    }
