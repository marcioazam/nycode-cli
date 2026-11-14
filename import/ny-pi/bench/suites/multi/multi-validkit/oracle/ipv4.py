def parse_ipv4(s: str) -> int:
    parts = s.split(".")
    if len(parts) != 4:
        raise ValueError(s)
    n = 0
    for p in parts:
        if not (p.isascii() and p.isdigit()) or (len(p) > 1 and p[0] == "0"):
            raise ValueError(s)
        v = int(p)
        if v > 255:
            raise ValueError(s)
        n = n << 8 | v
    return n


def in_cidr(ip: str, cidr: str) -> bool:
    addr, sep, pre = cidr.partition("/")
    if not sep or not (pre.isascii() and pre.isdigit()) or int(pre) > 32:
        raise ValueError(cidr)
    p = int(pre)
    mask = (0xFFFFFFFF << (32 - p)) & 0xFFFFFFFF
    return parse_ipv4(ip) & mask == parse_ipv4(addr) & mask
