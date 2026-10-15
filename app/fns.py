import json
import threading

import requests

from .config import CONFIG, CODE_MANUAL
from .db import db

_fns_lock = threading.Lock()


def api_calls_today() -> int:
    with db() as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM api_calls WHERE called_at >= datetime('now', '-1 day')"
        ).fetchone()
    return row[0]


def api_calls_register():
    with db() as conn:
        conn.execute("INSERT INTO api_calls (called_at) VALUES (datetime('now'))")


def extract_fns_data(resp_json: dict):
    fns_data_text = json.dumps(resp_json, ensure_ascii=False)

    data = resp_json.get("data") or {}
    html = data.get("html")

    inner = data.get("json")
    if isinstance(inner, str):
        try:
            inner = json.loads(inner)
        except Exception:
            inner = None

    items = []
    user = None
    if isinstance(inner, dict):
        items = inner.get("items") or []
        user = inner.get("user")

    return fns_data_text, html, items, user


def fetch_fns_data():
    cfg = CONFIG.get("proverkacheka", {})
    if not cfg.get("enabled"):
        return {"skipped": "disabled"}

    token = cfg.get("token", "").strip()
    if not token or token.startswith("ВАШ_"):
        return {"skipped": "no token"}

    daily_limit = int(cfg.get("daily_limit", 15))

    with _fns_lock:
        with db() as conn:
            rows = conn.execute("""
                SELECT id, raw
                FROM receipts
                WHERE code IS NULL OR code NOT IN (0, 1, 5, ?)
                ORDER BY id ASC
            """, (CODE_MANUAL,)).fetchall()

        if not rows:
            return {"pending": 0, "processed": 0}

        stats = {"pending": len(rows), "processed": 0,
                 "updated": 0, "errors": 0, "limit_reached": False}

        url = cfg.get("url", "https://proverkacheka.com/api/v1/check/get")

        for row in rows:
            if api_calls_today() >= daily_limit:
                stats["limit_reached"] = True
                break

            receipt_id = row["id"]
            raw = row["raw"]

            try:
                api_calls_register()
                r = requests.post(
                    url,
                    data={"token": token, "qrraw": raw},
                    timeout=30,
                )
                r.raise_for_status()
                resp_json = r.json()
            except Exception as e:
                stats["errors"] += 1
                stats["last_error"] = str(e)
                continue

            code = resp_json.get("code")
            stats["processed"] += 1

            if code == 1:
                fns_data_text, html, items, user = extract_fns_data(resp_json)
                with db() as conn:
                    conn.execute(
                        """UPDATE receipts
                           SET code = ?, fnsData = ?, html = ?, user = ?
                           WHERE id = ?""",
                        (code, fns_data_text, html, user, receipt_id),
                    )
                    conn.execute(
                        "DELETE FROM items WHERE receipt_id = ?",
                        (receipt_id,),
                    )

                    for it in items:
                        name = it.get("name")
                        price = it.get("price")
                        quantity = it.get("quantity")
                        summ = it.get("sum")

                        if not name:
                            continue

                        price = (price / 100.0) if price is not None else None
                        summ = (summ / 100.0) if summ is not None else None
                        quantity = quantity if quantity is not None else 0

                        # справочник сырых имён
                        conn.execute(
                            "INSERT OR IGNORE INTO products(name, good_id) VALUES (?, 0)",
                            (name,),
                        )
                        prod_row = conn.execute(
                            "SELECT id, good_id FROM products WHERE name = ?", (name,)
                        ).fetchone()
                        product_id = prod_row["id"]
                        good_id = prod_row["good_id"] or 0

                        existing = conn.execute(
                            """SELECT id FROM items
                               WHERE receipt_id = ? AND product_id IS ? AND price IS ?""",
                            (receipt_id, product_id, price),
                        ).fetchone()

                        if existing is not None:
                            conn.execute(
                                """UPDATE items
                                   SET quantity = COALESCE(quantity, 0) + ?,
                                       sum      = COALESCE(sum, 0)      + ?
                                   WHERE id = ?""",
                                (quantity,
                                 summ if summ is not None else 0,
                                 existing["id"]),
                            )
                        else:
                            conn.execute(
                                """INSERT INTO items
                                       (receipt_id, product_id, good_id, price, quantity, sum)
                                   VALUES (?, ?, ?, ?, ?, ?)""",
                                (receipt_id, product_id, good_id, price, quantity, summ),
                            )
                stats["updated"] += 1
            else:
                with db() as conn:
                    conn.execute(
                        "UPDATE receipts SET code = ? WHERE id = ?",
                        (code, receipt_id),
                    )

        return stats