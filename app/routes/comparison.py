from flask import Blueprint, jsonify, request

from ..categories_util import cat_map, top
from ..db import db

bp = Blueprint("comparison", __name__)


@bp.route("/api/goods/<int:good_id>")
def api_good(good_id: int):
    with db() as conn:
        row = conn.execute(
            "SELECT id, name FROM goods WHERE id = ?", (good_id,)
        ).fetchone()
    if row is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(dict(row))


@bp.route("/api/goods/<int:good_id>/comparisons")
def api_good_comparisons(good_id: int):
    with db() as conn:
        rows = conn.execute("""
            SELECT c.id,
                   c.category_id,
                   c.metka_id,
                   cat.name AS category_name,
                   m.name   AS metka_name
            FROM comparison c
            JOIN categories cat ON cat.id = c.category_id
            JOIN categories m   ON m.id   = c.metka_id
            WHERE c.good_id = ?
        """, (good_id,)).fetchall()
    return jsonify({"items": [dict(r) for r in rows]})


@bp.route("/api/goods/<int:good_id>/comparisons/<int:category_id>",
          methods=["PUT"])
def api_set_comparison(good_id: int, category_id: int):
    data = request.get_json(silent=True) or {}
    metka_id = data.get("metka_id")

    with db() as conn:
        good = conn.execute(
            "SELECT id FROM goods WHERE id = ?", (good_id,)
        ).fetchone()
        if good is None:
            return jsonify({"error": "good not found"}), 404

        cat = conn.execute(
            "SELECT id, parent_id FROM categories WHERE id = ?", (category_id,)
        ).fetchone()
        if cat is None or cat["parent_id"] is not None:
            return jsonify({"error": "category must be root (level 1)"}), 400

        if metka_id is None:
            conn.execute(
                """DELETE FROM comparison
                   WHERE good_id = ? AND category_id = ?""",
                (good_id, category_id),
            )
            return jsonify({"ok": True, "removed": True})

        cmap = cat_map(conn)
        metka = cmap.get(metka_id)
        if metka is None or metka["is_folder"] or top(cmap, metka_id) != category_id:
            return jsonify({"error": "metka must be an element inside category"}), 400

        conn.execute("""
            INSERT INTO comparison (good_id, category_id, metka_id)
            VALUES (?, ?, ?)
            ON CONFLICT(good_id, category_id)
            DO UPDATE SET metka_id = excluded.metka_id
        """, (good_id, category_id, metka_id))

    return jsonify({"ok": True})