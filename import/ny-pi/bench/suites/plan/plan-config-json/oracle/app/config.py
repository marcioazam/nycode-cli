import configparser
import json


def _need(ok, msg):
    if not ok:
        raise ValueError(msg)


def _check(host, port, debug):
    _need(isinstance(host, str), "host must be a string")
    _need(
        isinstance(port, int) and not isinstance(port, bool) and 1 <= port <= 65535,
        "port must be an integer in 1..65535",
    )
    _need(isinstance(debug, bool), "debug must be a boolean")
    return {"host": host, "port": port, "debug": debug}


def _load_ini(path):
    cp = configparser.ConfigParser()
    if not cp.read(path):
        raise FileNotFoundError(path)
    return _check(
        cp.get("server", "host", fallback="localhost"),
        cp.getint("server", "port", fallback=8080),
        cp.getboolean("server", "debug", fallback=False),
    )


def _load_json(path):
    with open(path) as f:
        data = json.load(f)
    _need(isinstance(data, dict), "config must be an object")
    s = data.get("server", {})
    _need(isinstance(s, dict), "server must be an object")
    return _check(
        s.get("host", "localhost"), s.get("port", 8080), s.get("debug", False)
    )


def load(path):
    return _load_json(path) if path.endswith(".json") else _load_ini(path)
