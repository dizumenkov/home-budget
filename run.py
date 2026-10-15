import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from app import create_app
from app.config import BASE_DIR, CONFIG, LOGGING


def setup_logging():
    """Если в config.json logging.enabled = true, пишем stdout/stderr
    (включая werkzeug) в файл с ротацией. Иначе — как есть, в консоль."""
    if not LOGGING.get("enabled"):
        return
    path = Path(LOGGING.get("path", "run.log"))
    if not path.is_absolute():
        path = BASE_DIR / path
    path.parent.mkdir(parents=True, exist_ok=True)

    handler = RotatingFileHandler(
        path, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    fmt = logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s")
    handler.setFormatter(fmt)

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers[:] = [handler]

    # перенаправляем print и werkzeug
    sys.stdout = open(path, "a", encoding="utf-8", buffering=1)
    sys.stderr = sys.stdout


app = create_app()


if __name__ == "__main__":
    setup_logging()
    srv = CONFIG.get("server", {})
    app.run(
        host=srv.get("host", "127.0.0.1"),
        port=int(srv.get("port", 5000)),
        debug=False,
        use_reloader=False,
    )