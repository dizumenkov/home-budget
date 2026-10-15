from flask import Blueprint, jsonify, request

from ..config import CODE_MANUAL, day_bound
from ..db import db

bp = Blueprint("receipts", __name__)


@bp.route("/api/receipts")
def api_receipts():
    try:
        page = max(1, int(request.args.get("page", 1)))
        per_page = min(200, max(1, int(request.args.get("per_page", 50))))
    except ValueError:
        return jsonify({"error": "bad page/per_page"}), 400

    sort_by = request.args.get("sort", "id")
    order = request.args.get("order", "desc").lower()
    if sort_by not in {"id", "check_at", "code", "sum", "user"}:
        sort_by = "id"
    if order not in {"asc", "desc"}:
        order = "desc"

    date_from = (request.args.get("date_from") or "").strip()
    date_to = (request.args.get("date_to") or "").strip()

    where, params = [], []
    if date_from:
        where.append("check_at >= ?")
        params.append(day_bound(date_from) if len(date_from) == 10 else date_from)
    if date_to:
        where.append("check_at <= ?")
        params.append(day_bound(date_to, True) if len(date_to) == 10 else date_to)

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    with db() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM receipts {where_sql}", params
        ).fetchone()[0]
        sum_total = conn.execute(
            f'SELECT COALESCE(SUM("sum"), 0) FROM receipts {where_sql}', params
        ).fetchone()[0]
        rows = conn.execute(
            f"""SELECT id, code, check_at,
                       "sum" AS sum,
                       "user" AS user,
                       raw,
                       CASE WHEN html IS NOT NULL AND html <> '' THEN 1 ELSE 0 END AS has_html,
                       EXISTS (
                           SELECT 1 FROM items i
                           WHERE i.receipt_id = receipts.id
                             AND (
                                 -- несвязанный товар (good_id = 0)
                                 i.good_id = 0
                                 OR (
                                     -- товар связан, но категорий заполнено меньше, чем всего
                                     i.good_id <> 0
                                     AND (SELECT COUNT(*) FROM categories WHERE parent_id IS NULL) > 0
                                     AND (SELECT COUNT(*) FROM comparison c WHERE c.good_id = i.good_id)
                                         < (SELECT COUNT(*) FROM categories WHERE parent_id IS NULL)
                                 )
                             )
                       ) AS has_problems
                FROM receipts
                {where_sql}
                ORDER BY "{sort_by}" {order}, id {order}
                LIMIT ? OFFSET ?""",
            params + [per_page, (page - 1) * per_page],
        ).fetchall()

    return jsonify({
        "items": [dict(r) for r in rows],
        "total": total,
        "sum_total": round(sum_total, 2),
        "page": page,
        "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    })


@bp.route("/api/receipts/<int:receipt_id>/items")
def api_items(receipt_id: int):
    with db() as conn:
        rows = conn.execute(
            """SELECT i.id,
                      i.product_id,
                      i.good_id,
                      p.name AS name,
                      g.name AS good_name,
                      i.price, i.quantity, i.sum,
                      (SELECT COUNT(*) FROM categories
                       WHERE parent_id IS NULL) AS comp_total,
                      (SELECT COUNT(*) FROM comparison c
                       WHERE c.good_id = i.good_id) AS comp_filled,
                      EXISTS (
                          SELECT 1 FROM comparison c
                          WHERE c.good_id = i.good_id
                      ) AS has_comp
               FROM items i
               JOIN products p ON p.id = i.product_id
               LEFT JOIN goods g ON g.id = i.good_id
               WHERE i.receipt_id = ?
               ORDER BY i.id""",
            (receipt_id,),
        ).fetchall()
    return jsonify({"items": [dict(r) for r in rows]})


@bp.route("/api/receipts/<int:receipt_id>/html")
def api_receipt_html(receipt_id: int):
    with db() as conn:
        row = conn.execute(
            "SELECT html FROM receipts WHERE id = ?", (receipt_id,)
        ).fetchone()
    if row is None:
        return "<!doctype html><meta charset='utf-8'><p>Чек не найден</p>", 404, \
               {"Content-Type": "text/html; charset=utf-8"}
    html = (row["html"] or "").strip()
    if not html:
        html = ("<!doctype html><meta charset='utf-8'>"
                "<body style='font:14px sans-serif;padding:24px;color:#6b7280'>"
                "<em>Данные ФНС (HTML) для этого чека отсутствуют</em></body>")
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


@bp.route("/api/receipts/<int:receipt_id>", methods=["GET"])
def api_receipt_get(receipt_id: int):
    with db() as conn:
        row = conn.execute(
            """SELECT id, raw, check_at, code, "sum" AS sum, user
               FROM receipts WHERE id = ?""",
            (receipt_id,),
        ).fetchone()
        if row is None:
            return jsonify({"error": "not found"}), 404
        if row["code"] != CODE_MANUAL:
            return jsonify({"error": "not a manual receipt"}), 400
        items = conn.execute(
            """SELECT i.id, i.product_id, i.good_id,
                      p.name AS name,
                      i.price, i.quantity, i.sum
               FROM items i
               JOIN products p ON p.id = i.product_id
               WHERE i.receipt_id = ?
               ORDER BY i.id""",
            (receipt_id,),
        ).fetchall()
    return jsonify({
        "receipt": dict(row),
        "items": [dict(r) for r in items],
    })


@bp.route("/api/receipts/<int:receipt_id>", methods=["DELETE"])
def api_delete_receipt(receipt_id: int):
    with db() as conn:
        row = conn.execute(
            "SELECT id FROM receipts WHERE id = ?", (receipt_id,)
        ).fetchone()
        if row is None:
            return jsonify({"error": "not found"}), 404
        conn.execute("DELETE FROM items WHERE receipt_id = ?", (receipt_id,))
        conn.execute("DELETE FROM receipts WHERE id = ?", (receipt_id,))
    return jsonify({"ok": True, "id": receipt_id})