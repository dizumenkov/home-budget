from flask import Blueprint, jsonify, request

from ..db import db, GOOD_UNDEFINED_ID

bp = Blueprint("goods", __name__)


# ---------------------------------------------------------------- goods

@bp.route("/api/goods")
def api_goods_list():
    include_zero = request.args.get("include_zero", "0") == "1"
    with db() as conn:
        if include_zero:
            rows = conn.execute(
                "SELECT id, name FROM goods ORDER BY id"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, name FROM goods WHERE id <> ? ORDER BY name",
                (GOOD_UNDEFINED_ID,),
            ).fetchall()
    return jsonify({"items": [dict(r) for r in rows]})


@bp.route("/api/goods", methods=["POST"])
def api_goods_create():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    with db() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO goods(name) VALUES (?)", (name,)
            )
        except Exception:
            return jsonify({"error": "duplicate"}), 409
        new_id = cur.lastrowid
    return jsonify({"ok": True, "id": new_id, "name": name})


@bp.route("/api/goods/<int:good_id>", methods=["PATCH"])
def api_goods_update(good_id: int):
    if good_id == GOOD_UNDEFINED_ID:
        return jsonify({"error": "cannot modify undefined"}), 400
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    with db() as conn:
        row = conn.execute("SELECT id FROM goods WHERE id = ?", (good_id,)).fetchone()
        if row is None:
            return jsonify({"error": "not found"}), 404
        try:
            conn.execute("UPDATE goods SET name = ? WHERE id = ?", (name, good_id))
        except Exception:
            return jsonify({"error": "duplicate"}), 409
    return jsonify({"ok": True, "id": good_id, "name": name})


@bp.route("/api/goods/<int:good_id>/delete", methods=["POST"])
def api_goods_delete(good_id: int):
    """Удаление good с опциональным переназначением products.

    Body: {"reassign_to": <int> | null}
      - null или 0 → products.good_id = 0 (обнуление, «— не определено —»);
      - int > 0    → products.good_id = reassign_to (должен существовать в goods).
    Триггер trg_products_update_good_id синхронно правит items.good_id.
    """
    if good_id == GOOD_UNDEFINED_ID:
        return jsonify({"error": "cannot delete undefined"}), 400

    data = request.get_json(silent=True) or {}
    reassign_raw = data.get("reassign_to", None)

    with db() as conn:
        row = conn.execute("SELECT id FROM goods WHERE id = ?", (good_id,)).fetchone()
        if row is None:
            return jsonify({"error": "not found"}), 404

        if reassign_raw is None:
            reassign_to = 0
        else:
            try:
                reassign_to = int(reassign_raw)
            except (TypeError, ValueError):
                return jsonify({"error": "bad reassign_to"}), 400

        if reassign_to == good_id:
            return jsonify({"error": "reassign_to equals deleted id"}), 400

        if reassign_to != 0:
            target = conn.execute(
                "SELECT id FROM goods WHERE id = ?", (reassign_to,)
            ).fetchone()
            if target is None:
                return jsonify({"error": "target not found"}), 404

        # 1) переназначаем связанные products (триггер обновит items.good_id)
        conn.execute(
            "UPDATE products SET good_id = ? WHERE good_id = ?",
            (reassign_to, good_id),
        )
        # 2) подстраховка: у любых items, у которых product_id пуст или
        #    триггер по какой-то причине не сработал
        conn.execute(
            "UPDATE items SET good_id = ? WHERE good_id = ?",
            (reassign_to, good_id),
        )
        # 3) удаляем good
        conn.execute("DELETE FROM goods WHERE id = ?", (good_id,))

    return jsonify({"ok": True, "id": good_id, "reassign_to": reassign_to})


@bp.route("/api/users")
def api_users_list():
    with db() as conn:
        rows = conn.execute(
            """SELECT DISTINCT user FROM receipts
               WHERE user IS NOT NULL AND user <> ''
               ORDER BY user"""
        ).fetchall()
    return jsonify({"items": [r["user"] for r in rows]})


# ---------------------------------------------------------------- products

@bp.route("/api/goods/<int:good_id>/products")
def api_good_products(good_id: int):
    with db() as conn:
        good = conn.execute(
            "SELECT id FROM goods WHERE id = ?", (good_id,)
        ).fetchone()
        if good is None:
            return jsonify({"error": "not found"}), 404
        rows = conn.execute(
            """SELECT id, name FROM products
               WHERE good_id = ?
               ORDER BY name""",
            (good_id,),
        ).fetchall()
    return jsonify({"items": [dict(r) for r in rows]})


@bp.route("/api/products")
def api_products_list():
    only_unmatched = request.args.get("unmatched", "1") == "1"
    with db() as conn:
        if only_unmatched:
            rows = conn.execute("""
                SELECT p.id, p.name, p.good_id, g.name AS good_name,
                       (SELECT COUNT(*) FROM items i WHERE i.product_id = p.id) AS items_count
                FROM products p
                LEFT JOIN goods g ON g.id = p.good_id
                WHERE p.good_id = 0
                ORDER BY p.name
            """).fetchall()
        else:
            rows = conn.execute("""
                SELECT p.id, p.name, p.good_id, g.name AS good_name,
                       (SELECT COUNT(*) FROM items i WHERE i.product_id = p.id) AS items_count
                FROM products p
                LEFT JOIN goods g ON g.id = p.good_id
                ORDER BY g.name IS NULL DESC, g.name, p.name
            """).fetchall()
    return jsonify({"items": [dict(r) for r in rows]})


@bp.route("/api/products/unmatched/count")
def api_products_unmatched_count():
    with db() as conn:
        n = conn.execute(
            "SELECT COUNT(*) FROM products WHERE good_id = 0"
        ).fetchone()[0]
    return jsonify({"count": int(n)})


@bp.route("/api/products/<int:product_id>/good", methods=["PUT"])
def api_product_set_good(product_id: int):
    data = request.get_json(silent=True) or {}
    good_id = data.get("good_id")
    if good_id is None:
        good_id = 0
    try:
        good_id = int(good_id)
    except (TypeError, ValueError):
        return jsonify({"error": "bad good_id"}), 400

    with db() as conn:
        prod = conn.execute(
            "SELECT id FROM products WHERE id = ?", (product_id,)
        ).fetchone()
        if prod is None:
            return jsonify({"error": "product not found"}), 404

        good = conn.execute(
            "SELECT id FROM goods WHERE id = ?", (good_id,)
        ).fetchone()
        if good is None:
            return jsonify({"error": "good not found"}), 404

        conn.execute(
            "UPDATE products SET good_id = ? WHERE id = ?",
            (good_id, product_id),
        )
    return jsonify({"ok": True})