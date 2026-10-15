import os
import threading

from flask import Blueprint, jsonify, request

from ..config import BASE_DIR, CONFIG
from ..fns import api_calls_today, fetch_fns_data
from ..scheduler import shutdown_scheduler
from ..sqs import read_queue

bp = Blueprint("queue", __name__)


@bp.route("/api/shutdown", methods=["POST"])
def api_shutdown():
    if request.headers.get("X-Shutdown") != "1":
        return jsonify({"error": "forbidden"}), 403

    def _stop():
        shutdown_scheduler()
        try:
            (BASE_DIR / "run.pid").unlink()
        except Exception:
            pass
        os._exit(0)

    threading.Timer(0.5, _stop).start()
    return jsonify({"ok": True})


@bp.route("/api/read", methods=["POST"])
def api_read():
    return jsonify(read_queue())


@bp.route("/api/fetch-fns", methods=["POST"])
def api_fetch_fns():
    return jsonify(fetch_fns_data())


@bp.route("/api/fns-limit")
def api_fns_limit():
    cfg = CONFIG.get("proverkacheka", {})
    return jsonify({
        "used": api_calls_today(),
        "limit": int(cfg.get("daily_limit", 15)),
    })
