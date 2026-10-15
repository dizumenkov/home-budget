import re
from datetime import datetime

from .config import TZ

REQUIRED_KEYS = ("t", "s", "fn", "i", "fp", "n")
T_RE = re.compile(r"^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$")


def parse_body(body: str):
    if not body:
        return False, None, "empty body"
    data = {}
    for part in body.split("&"):
        if "=" not in part:
            return False, None, f"bad part {part!r}"
        k, v = part.split("=", 1)
        data[k] = v
    for k in REQUIRED_KEYS:
        if k not in data:
            return False, None, f"missing {k}"
    t = data["t"]
    if not T_RE.match(t):
        return False, None, f"bad t={t!r}"
    return True, data, None


def t_to_dt(t_str: str) -> datetime:
    y, mo, d, h, mi, sec = T_RE.match(t_str).groups()
    return datetime(int(y), int(mo), int(d), int(h), int(mi), int(sec or 0), tzinfo=TZ)
