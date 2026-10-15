from apscheduler.schedulers.background import BackgroundScheduler

from .config import CONFIG
from .sqs import read_queue
from .fns import fetch_fns_data

_scheduler = None


def start_scheduler():
    global _scheduler
    sch_cfg = CONFIG.get("scheduler", {})
    if not sch_cfg.get("enabled"):
        return None
    interval = int(sch_cfg.get("interval_seconds", 60))
    sch = BackgroundScheduler(daemon=True)
    sch.add_job(read_queue, "interval", seconds=interval,
                id="read_queue", max_instances=1, coalesce=True,
                misfire_grace_time=interval)

    fns_cfg = CONFIG.get("proverkacheka", {})
    if fns_cfg.get("enabled"):
        fns_interval = int(fns_cfg.get("interval_seconds", 300))
        sch.add_job(fetch_fns_data, "interval", seconds=fns_interval,
                    id="fetch_fns_data", max_instances=1, coalesce=True,
                    misfire_grace_time=fns_interval)

    sch.start()
    _scheduler = sch
    return sch


def shutdown_scheduler():
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            pass
        _scheduler = None
