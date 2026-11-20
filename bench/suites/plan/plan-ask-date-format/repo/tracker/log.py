from datetime import datetime


def stamp(now=None):
    return (now or datetime.now()).strftime("%Y-%m-%dT%H:%M:%S")


def entry(msg, now=None):
    return f"{stamp(now)} {msg}"
