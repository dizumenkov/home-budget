import json
import os
import shutil
import sys
import threading
from datetime import datetime
from zoneinfo import ZoneInfo

from flask import Blueprint, jsonify, request

from ..config import BASE_DIR, CONFIG_PATH, EXAMPLE_PATH
from ..scheduler import shutdown_scheduler

bp = Blueprint("settings", __name__)


# ---------------------------------------------------------------- GET

@bp.route("/api/config", methods=["GET"])
def api_config_get():
    path = CONFIG_PATH if CONFIG_PATH.exists() else EXAMPLE_PATH
    if not path.exists():
        return jsonify({"error": "no config file"}), 500
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({
        "config": data,
        "source": path.name,
        "config_exists": CONFIG_PATH.exists(),
    })


# ---------------------------------------------------------------- validation

def _validate(cfg: dict):
    server = cfg.get("server") or {}
    try:
        port = int(server.get("port", 5000))
        if not (1 <= port <= 65535):
            return "server.port вне диапазона 1–65535"
    except (TypeError, ValueError):
        return "server.port должен быть числом"

    p = cfg.get("proverkacheka") or {}
    try:
        dl = int(p.get("daily_limit", 15))
        if dl < 1:
            return "proverkacheka.daily_limit должен быть >= 1"
    except (TypeError, ValueError):
        return "proverkacheka.daily_limit должен быть числом"

    tz = cfg.get("timezone") or "Europe/Moscow"
    try:
        ZoneInfo(tz)
    except Exception:
        return f"timezone: неизвестная IANA-зона «{tz}»"

    sqs = cfg.get("sqs") or {}
    if not (sqs.get("queue_url") or "").strip():
        return "sqs.queue_url не может быть пустым"

    return None


# ---------------------------------------------------------------- POST save

@bp.route("/api/config", methods=["POST"])
def api_config_save():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "bad request"}), 400

    err = _validate(data)
    if err:
        return jsonify({"error": err}), 400

    # бэкап с меткой времени
    if CONFIG_PATH.exists():
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        bak = CONFIG_PATH.with_name(f"{CONFIG_PATH.name}.{ts}.bak")
        try:
            shutil.copy2(CONFIG_PATH, bak)
        except Exception as e:
            return jsonify({"error": f"не удалось создать бэкап: {e}"}), 500

    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"ok": True, "path": str(CONFIG_PATH)})


# ---------------------------------------------------------------- POST restart

@bp.route("/api/restart", methods=["POST"])
def api_restart():
    if request.headers.get("X-Restart") != "1":
        return jsonify({"error": "forbidden"}), 403

    def _do_restart():
        # корректно гасим планировщик
        try:
            shutdown_scheduler()
        except Exception:
            pass
        # чистим pid-файл, чтобы run.sh не путался
        try:
            (BASE_DIR / "run.pid").unlink()
        except Exception:
            pass
        # заменяем текущий процесс на свежий run.py
        try:
            os.execv(sys.executable, [sys.executable, str(BASE_DIR / "run.py")])
        except Exception:
            os._exit(0)

    threading.Timer(0.7, _do_restart).start()
    return jsonify({"ok": True})