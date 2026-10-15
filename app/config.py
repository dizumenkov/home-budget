import json
import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = Path(os.environ.get("CONFIG_PATH", BASE_DIR / "config.json"))
EXAMPLE_PATH = BASE_DIR / "config.example.json"

# ---- выбор источника конфига ----
if CONFIG_PATH.exists():
    CONFIG_EXISTS = True
    _read_path = CONFIG_PATH
elif EXAMPLE_PATH.exists():
    CONFIG_EXISTS = False
    _read_path = EXAMPLE_PATH
    print(
        f"[config] {CONFIG_PATH.name} не найден — читаю {EXAMPLE_PATH.name}. "
        f"Откройте /settings и нажмите «Сохранить», чтобы создать {CONFIG_PATH.name}.",
        file=sys.stderr,
    )
else:
    raise SystemExit(
        f"[config] Не найден ни {CONFIG_PATH.name}, ни {EXAMPLE_PATH.name}.\n"
        f"         Создайте {EXAMPLE_PATH.name} в {BASE_DIR}."
    )

try:
    with open(_read_path, encoding="utf-8") as f:
        CONFIG = json.load(f)
except json.JSONDecodeError as e:
    raise SystemExit(f"[config] {_read_path}: некорректный JSON — {e}")

_db_cfg = CONFIG.get("database") or {}
_db_path_str = _db_cfg.get("path") or "receipts.db"
DB_PATH = Path(_db_path_str)
if not DB_PATH.is_absolute():
    DB_PATH = BASE_DIR / DB_PATH

try:
    TZ = ZoneInfo(CONFIG.get("timezone", "Europe/Moscow"))
except Exception:
    TZ = ZoneInfo("Europe/Moscow")

CODE_MANUAL = 100  # ручной ввод — запрос в ФНС не выполняется

# Настройки логирования читаются run.sh и run.py.
LOGGING = CONFIG.get("logging", {}) or {}


def day_bound(d: str, end: bool = False) -> str:
    """'YYYY-MM-DD' -> граница дня в часовом поясе из config.json."""
    try:
        dt = datetime.strptime(d, "%Y-%m-%d")
    except ValueError:
        return d
    dt = dt.replace(hour=23, minute=59, second=59, tzinfo=TZ) if end else dt.replace(tzinfo=TZ)
    return dt.isoformat(timespec="seconds")