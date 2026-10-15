from flask import Blueprint, jsonify, request

from ..categories_util import cat_map, descendants, top, is_dup
from ..db import db

bp = Blueprint("categories", __name__)


@bp.route("/api/categories")
def api_categories_list():
    with db() as conn:
        cmap = cat_map(conn)
        counts = {
            r["metka_id"]: r["c"]
            for r in conn.execute(
                "SELECT metka_id, COUNT(*) AS c FROM comparison GROUP BY metka_id"
            ).fetchall()
        }

    kids = {}
    for c in cmap.values():
        kids.setdefault(c["parent_id"], []).append(c)

    def node(c):
        ch = sorted(kids.get(c["id"], []),
                    key=lambda x: (not x["is_folder"], x["name"].casefold()))
        return {
            "id": c["id"],
            "name": c["name"],
            "is_folder": bool(c["is_folder"]),
            "goods_count": 0 if c["is_folder"] else counts.get(c["id"], 0),
            "children": [node(x) for x in ch],
        }

    roots = sorted(kids.get(None, []), key=lambda x: x["name"].casefold())
    return jsonify({"items": [node(r) for r in roots]})


@bp.route("/api/categories", methods=["POST"])
def api_categories_create():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    parent_id = data.get("parent_id")
    is_folder = True if parent_id is None else bool(data.get("is_folder"))

    with db() as conn:
        cmap = cat_map(conn)
        if parent_id is not None:
            parent = cmap.get(parent_id)
            if parent is None:
                return jsonify({"error": "parent not found"}), 400
            if not parent["is_folder"]:
                return jsonify({"error": "parent must be a folder"}), 400
        if is_dup(cmap, parent_id, name):
            return jsonify({"error": "duplicate"}), 409
        cur = conn.execute(
            "INSERT INTO categories (parent_id, name, is_folder) VALUES (?, ?, ?)",
            (parent_id, name, 1 if is_folder else 0),
        )
        new_id = cur.lastrowid
    return jsonify({"ok": True, "id": new_id})


@bp.route("/api/categories/<int:cat_id>", methods=["PATCH"])
def api_categories_update(cat_id: int):
    data = request.get_json(silent=True) or {}
    with db() as conn:
        cmap = cat_map(conn)
        node = cmap.get(cat_id)
        if node is None:
            return jsonify({"error": "not found"}), 404

        name = node["name"]
        if "name" in data:
            name = (data.get("name") or "").strip()
            if not name:
                return jsonify({"error": "name required"}), 400

        new_parent = node["parent_id"]
        moving = "parent_id" in data and data["parent_id"] != node["parent_id"]
        if moving:
            new_parent = data["parent_id"]
            if new_parent is None:
                if not node["is_folder"]:
                    return jsonify({"error": "element cannot be top level"}), 400
            else:
                np_ = cmap.get(new_parent)
                if np_ is None:
                    return jsonify({"error": "parent not found"}), 400
                if not np_["is_folder"]:
                    return jsonify({"error": "parent must be a folder"}), 400
                if new_parent == cat_id or new_parent in descendants(cmap, cat_id):
                    return jsonify({"error": "cannot move into itself"}), 400

        if is_dup(cmap, new_parent, name, cat_id):
            return jsonify({"error": "duplicate"}), 409

        removed = 0
        if moving:
            sub = descendants(cmap, cat_id) | {cat_id}
            marks = ",".join("?" * len(sub))
            cmap2 = {k: dict(v) for k, v in cmap.items()}
            cmap2[cat_id]["parent_id"] = new_parent
            rows = conn.execute(
                f"SELECT id, category_id, metka_id FROM comparison "
                f"WHERE metka_id IN ({marks}) OR category_id IN ({marks})",
                list(sub) + list(sub)).fetchall()
            bad = [r["id"] for r in rows if not (
                cmap2[r["category_id"]]["parent_id"] is None
                and not cmap2[r["metka_id"]]["is_folder"]
                and top(cmap2, r["metka_id"]) == r["category_id"])]
            if bad and not data.get("force"):
                return jsonify({"error": "links_would_be_removed", "count": len(bad)}), 409
            if bad:
                conn.execute(
                    f"DELETE FROM comparison WHERE id IN ({','.join('?' * len(bad))})",
                    bad,
                )
                removed = len(bad)

        conn.execute("UPDATE categories SET name = ?, parent_id = ? WHERE id = ?",
                     (name, new_parent, cat_id))
    return jsonify({"ok": True, "id": cat_id, "name": name, "removed_links": removed})


@bp.route("/api/categories/<int:cat_id>", methods=["DELETE"])
def api_categories_delete(cat_id: int):
    with db() as conn:
        row = conn.execute("SELECT id FROM categories WHERE id = ?", (cat_id,)).fetchone()
        if row is None:
            return jsonify({"error": "not found"}), 404
        if conn.execute("SELECT 1 FROM categories WHERE parent_id = ? LIMIT 1", (cat_id,)).fetchone():
            return jsonify({"error": "not empty"}), 409
        conn.execute("DELETE FROM categories WHERE id = ?", (cat_id,))
    return jsonify({"ok": True})
