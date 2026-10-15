import sqlite3
import threading

import boto3
from botocore.config import Config as BotoConfig

from .config import CONFIG
from .db import db
from .parsing import parse_body, t_to_dt

_read_lock = threading.Lock()


def get_sqs_client():
    cfg = CONFIG["sqs"]
    return boto3.client(
        "sqs",
        endpoint_url=cfg["endpoint_url"],
        region_name=cfg.get("region", "ru-central1"),
        aws_access_key_id=cfg["aws_access_key_id"],
        aws_secret_access_key=cfg["aws_secret_access_key"],
        config=BotoConfig(retries={"max_attempts": 3}),
    )


def log_skipped(body: str, reason: str):
    with db() as conn:
        conn.execute("INSERT INTO skipped_messages (body, reason) VALUES (?, ?)", (body, reason))


def store_receipt(body: str, t_str: str, s_value) -> str:
    check_at = t_to_dt(t_str).isoformat(timespec="seconds")

    sum_val = None
    if s_value is not None:
        try:
            sum_val = float(s_value)
        except (TypeError, ValueError):
            sum_val = None

    with db() as conn:
        try:
            conn.execute(
                "INSERT INTO receipts (raw, check_at, sum) VALUES (?, ?, ?)",
                (body, check_at, sum_val),
            )
            return "inserted"
        except sqlite3.IntegrityError:
            return "duplicate"


def read_queue():
    with _read_lock:
        cfg = CONFIG["sqs"]
        client = get_sqs_client()
        queue_url = cfg["queue_url"]
        max_msgs = cfg.get("max_messages", 10)
        wait_first = cfg.get("wait_time_seconds", 20)
        wait_drain = cfg.get("drain_wait_seconds", 1)
        vis = cfg.get("visibility_timeout", 60)

        stats = {
            "read": 0, "saved": 0, "duplicate": 0,
            "skipped": 0, "deleted": 0, "errors": 0,
        }

        first = True
        while True:
            wait = wait_first if first else wait_drain
            first = False
            try:
                resp = client.receive_message(
                    QueueUrl=queue_url,
                    MaxNumberOfMessages=max_msgs,
                    WaitTimeSeconds=wait,
                    VisibilityTimeout=vis,
                )
            except Exception as e:
                stats["errors"] += 1
                stats["last_error"] = str(e)
                break

            messages = resp.get("Messages", [])
            if not messages:
                break

            for msg in messages:
                stats["read"] += 1
                body = msg.get("Body", "")

                ok, data, _err = parse_body(body)
                if ok:
                    try:
                        res = store_receipt(body, data["t"], data.get("s"))
                        stats["saved" if res == "inserted" else "duplicate"] += 1
                    except Exception as e:
                        stats["errors"] += 1
                        stats["last_error"] = str(e)
                else:
                    stats["skipped"] += 1
                    stats.setdefault("skipped_info", [])
                    if len(stats["skipped_info"]) < 3:
                        stats["skipped_info"].append(f"{_err}: {body[:60]}")
                    try:
                        log_skipped(body, _err)
                    except Exception as e:
                        stats["errors"] += 1
                        stats["last_error"] = str(e)
                        continue

                try:
                    client.delete_message(
                        QueueUrl=queue_url,
                        ReceiptHandle=msg["ReceiptHandle"],
                    )
                    stats["deleted"] += 1
                except Exception as e:
                    stats["errors"] += 1
                    stats["last_error"] = str(e)

        return stats
