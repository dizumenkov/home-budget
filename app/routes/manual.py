from datetime import datetime

from flask import Blueprint, jsonify, request

from ..config import CODE_MANUAL, TZ
from ..db import db

bp = Blueprint("manual", __name__)


def _parse_check_at(raw: str):
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("check_at required")
    if len(raw) == 16 and "T" in raw:
        dt = datetime.strptime(raw, "%Y-%m-%dT%H:%M")
        return dt.replace(tzinfo=TZ)
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return dt


def _parse_items(raw_items):
    parsed = []
    for it in (raw_items or []):
        name = (it.get("name") or "").strip()
        if not name:
            raise ValueError("item name required")
        try:
            price = float(it.get("price") or 0)
            quantity = float(it.get("quantity") or 1)
            summ = float(it.get("sum") or 0)
        except (TypeError, ValueError):
            raise ValueError("bad item numbers")
        if quantity <= 0:
            quantity = 1.0
            if price > 0:
                summ = round(price * quantity, 2)
        if summ <= 0:
            raise ValueError("item sum must be > 0")
        price = round(price, 2)
        summ = round(summ, 2)
        parsed.append({
            "name": name, "price": price,
            "quantity": quantity, "sum": summ,
        })
    if not parsed:
        raise ValueError("items required")
    return parsed


def _write_items(conn, receipt_id: int, parsed):
    for it in parsed:
        conn.execute(
            "INSERT OR IGNORE INTO products(name, good_id) VALUES (?, 0)",
            (it["name"],),
        )
        prod_row = conn.execute(
            "SELECT id, good_id FROM products WHERE name = ?", (it["name"],)
        ).fetchone()
        product_id = prod_row["id"]
        good_id = prod_row["good_id"] or 0
        conn.execute(
            """INSERT INTO items
                   (receipt_id, product_id, good_id, price, quantity, sum)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (receipt_id, product_id, good_id,
             it["price"], it["quantity"], it["sum"]),
        )


@bp.route("/api/receipts/manual", methods=["POST"])
def api_manual_create():
    data = request.get_json(silent=True) or {}
    try:
        dt = _parse_check_at(data.get("check_at"))
        parsed = _parse_items(data.get("items"))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    user = (data.get("user") or "").strip() or None
    check_at_iso = dt.isoformat(timespec="seconds")
    total_sum = round(sum(it["sum"] for it in parsed), 2)

    with db() as conn:
        base_raw = f"manual:{int(dt.timestamp())}"
        raw = base_raw
        suffix = 0
        while conn.execute(
            "SELECT 1 FROM receipts WHERE raw = ?", (raw,)
        ).fetchone():
            suffix += 1
            raw = f"{base_raw}:{suffix}"

        cur = conn.execute(
            """INSERT INTO receipts (raw, check_at, code, "sum", user)
               VALUES (?, ?, ?, ?, ?)""",
            (raw, check_at_iso, CODE_MANUAL, total_sum, user),
        )
        receipt_id = cur.lastrowid
        _write_items(conn, receipt_id, parsed)

    return jsonify({"ok": True, "id": receipt_id, "sum": total_sum})


@bp.route("/api/receipts/<int:receipt_id>/manual", methods=["PUT"])
def api_manual_update(receipt_id: int):
    data = request.get_json(silent=True) or {}
    try:
        dt = _parse_check_at(data.get("check_at"))
        parsed = _parse_items(data.get("items"))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    user = (data.get("user") or "").strip() or None
    check_at_iso = dt.isoformat(timespec="seconds")
    total_sum = round(sum(it["sum"] for it in parsed), 2)

    with db() as conn:
        row = conn.execute(
            "SELECT id, code FROM receipts WHERE id = ?", (receipt_id,)
        ).fetchone()
        if row is None:
            return jsonify({"error": "not found"}), 404
        if row["code"] != CODE_MANUAL:
            return jsonify({"error": "not a manual receipt"}), 400

        conn.execute(
            """UPDATE receipts SET check_at = ?, "sum" = ?, user = ?
               WHERE id = ?""",
            (check_at_iso, total_sum, user, receipt_id),
        )
        conn.execute("DELETE FROM items WHERE receipt_id = ?", (receipt_id,))
        _write_items(conn, receipt_id, parsed)

    return jsonify({"ok": True, "id": receipt_id, "sum": total_sum})