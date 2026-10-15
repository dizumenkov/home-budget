import bisect
from datetime import datetime

from flask import Blueprint, jsonify, request

from ..categories_util import cat_map, descendants
from ..config import day_bound
from ..db import db
from ..periods_util import build_intervals, ALLOWED_INTERVALS

bp = Blueprint("analysis", __name__)


@bp.route("/api/analysis")
def api_analysis():
    date_from = (request.args.get("date_from") or "").strip()
    date_to = (request.args.get("date_to") or "").strip()
    category_id_raw = (request.args.get("category_id") or "").strip()
    include_unset = request.args.get("include_unset", "1") == "1"

    if not date_from or not date_to:
        return jsonify({"error": "date_from and date_to required"}), 400
    try:
        category_id = int(category_id_raw)
    except (TypeError, ValueError):
        return jsonify({"error": "category_id required"}), 400

    start_iso = day_bound(date_from)
    end_iso = day_bound(date_to, True)

    with db() as conn:
        cat = conn.execute(
            "SELECT id, name, parent_id FROM categories WHERE id = ?",
            (category_id,),
        ).fetchone()
        if cat is None or cat["parent_id"] is not None:
            return jsonify({"error": "category must be root (level 1)"}), 400

        cmap = cat_map(conn)
        metkas = sorted((c for c in cmap.values() if c["parent_id"] == category_id),
                        key=lambda c: (not c["is_folder"], c["name"].casefold()))
        branch_of = {}
        for d in metkas:
            branch_of[d["id"]] = d["id"]
            for x in descendants(cmap, d["id"]):
                branch_of[x] = d["id"]

        item_rows = conn.execute("""
            SELECT i.receipt_id, i.sum AS s, c.metka_id AS metka_id
            FROM items i
            JOIN receipts r ON r.id = i.receipt_id
            JOIN goods g    ON g.id = i.good_id
            LEFT JOIN comparison c
                   ON c.good_id = i.good_id AND c.category_id = ?
            WHERE r.check_at >= ? AND r.check_at <= ?
        """, (category_id, start_iso, end_iso)).fetchall()

        agg = {}
        for r in item_rows:
            key = branch_of.get(r["metka_id"]) if r["metka_id"] is not None else None
            a_ = agg.setdefault(key, [0.0, 0, set()])
            a_[0] += r["s"] or 0
            a_[1] += 1
            a_[2].add(r["receipt_id"])
        to_row = lambda v: {"total_sum": v[0], "items_count": v[1],
                            "receipts_count": len(v[2])}
        by_metka = {k: to_row(v) for k, v in agg.items() if k is not None}
        unset_row = to_row(agg[None]) if None in agg else None

        no_good_row = conn.execute("""
            SELECT COALESCE(SUM(i.sum), 0) AS total_sum,
                   COUNT(i.id)             AS items_count,
                   COUNT(DISTINCT i.receipt_id) AS receipts_count
            FROM items i
            JOIN receipts r ON r.id = i.receipt_id
            WHERE r.check_at >= ? AND r.check_at <= ?
              AND (i.good_id IS NULL
                   OR i.good_id NOT IN (SELECT id FROM goods))
        """, (start_iso, end_iso)).fetchone()

    items_out = []
    for m in metkas:
        r = by_metka.get(m["id"])
        items_out.append({
            "key": f"metka:{m['id']}",
            "metka_id": m["id"],
            "name": m["name"],
            "is_folder": bool(m["is_folder"]),
            "sum": float(r["total_sum"]) if r else 0.0,
            "items_count": int(r["items_count"]) if r else 0,
            "receipts_count": int(r["receipts_count"]) if r else 0,
        })

    if include_unset:
        if unset_row:
            items_out.append({
                "key": "unset",
                "metka_id": None,
                "name": "— не задано —",
                "sum": float(unset_row["total_sum"]),
                "items_count": int(unset_row["items_count"]),
                "receipts_count": int(unset_row["receipts_count"]),
            })
        if no_good_row and (no_good_row["items_count"] or 0) > 0:
            items_out.append({
                "key": "no_good",
                "metka_id": None,
                "name": "— без товара —",
                "sum": float(no_good_row["total_sum"]),
                "items_count": int(no_good_row["items_count"]),
                "receipts_count": int(no_good_row["receipts_count"]),
            })

    items_out = [x for x in items_out if x["sum"] > 0]

    items_out.sort(key=lambda x: x["sum"], reverse=True)
    total_sum = sum(x["sum"] for x in items_out)
    for x in items_out:
        x["percent"] = (x["sum"] / total_sum * 100.0) if total_sum > 0 else 0.0

    return jsonify({
        "category": {"id": cat["id"], "name": cat["name"]},
        "period": {"from": date_from, "to": date_to},
        "include_unset": include_unset,
        "total_sum": total_sum,
        "items": items_out,
    })


@bp.route("/api/analysis/expand")
def api_analysis_expand():
    date_from = (request.args.get("date_from") or "").strip()
    date_to = (request.args.get("date_to") or "").strip()
    category_id_raw = (request.args.get("category_id") or "").strip()
    folder_id_raw = (request.args.get("folder_id") or "").strip()

    if not date_from or not date_to:
        return jsonify({"error": "date_from and date_to required"}), 400
    try:
        category_id = int(category_id_raw)
        folder_id = int(folder_id_raw)
    except (TypeError, ValueError):
        return jsonify({"error": "category_id and folder_id required"}), 400

    start_iso = day_bound(date_from)
    end_iso = day_bound(date_to, True)

    with db() as conn:
        cmap = cat_map(conn)
        cat = cmap.get(category_id)
        if cat is None or cat["parent_id"] is not None:
            return jsonify({"error": "category must be root (level 1)"}), 400
        folder = cmap.get(folder_id)
        if folder is None:
            return jsonify({"error": "folder not found"}), 400
        if folder_id != category_id and folder_id not in descendants(cmap, category_id):
            return jsonify({"error": "folder not in category"}), 400
        if not folder["is_folder"]:
            return jsonify({"error": "not a folder"}), 400

        children = sorted(
            (c for c in cmap.values() if c["parent_id"] == folder_id),
            key=lambda c: (not c["is_folder"], c["name"].casefold()),
        )
        if not children:
            return jsonify({"folder": {"id": folder["id"], "name": folder["name"]},
                            "total_sum": 0.0, "items": []})

        branch_of = {}
        for ch in children:
            branch_of[ch["id"]] = ch["id"]
            for x in descendants(cmap, ch["id"]):
                branch_of[x] = ch["id"]

        item_rows = conn.execute("""
            SELECT i.receipt_id, i.sum AS s, c.metka_id AS metka_id
            FROM items i
            JOIN receipts r ON r.id = i.receipt_id
            JOIN goods g    ON g.id = i.good_id
            LEFT JOIN comparison c
                   ON c.good_id = i.good_id AND c.category_id = ?
            WHERE r.check_at >= ? AND r.check_at <= ?
        """, (category_id, start_iso, end_iso)).fetchall()

        agg = {}
        for r in item_rows:
            key = branch_of.get(r["metka_id"]) if r["metka_id"] is not None else None
            if key is None:
                continue
            a_ = agg.setdefault(key, [0.0, 0, set()])
            a_[0] += r["s"] or 0
            a_[1] += 1
            a_[2].add(r["receipt_id"])

    items_out = []
    for ch in children:
        v = agg.get(ch["id"])
        s = float(v[0]) if v else 0.0
        if s <= 0:
            continue
        items_out.append({
            "key": f"metka:{ch['id']}",
            "metka_id": ch["id"],
            "name": ch["name"],
            "is_folder": bool(ch["is_folder"]),
            "sum": s,
            "items_count": int(v[1]) if v else 0,
            "receipts_count": len(v[2]) if v else 0,
        })

    items_out.sort(key=lambda x: x["sum"], reverse=True)
    total_sum = sum(x["sum"] for x in items_out)
    for x in items_out:
        x["percent"] = (x["sum"] / total_sum * 100.0) if total_sum > 0 else 0.0

    return jsonify({
        "folder": {"id": folder["id"], "name": folder["name"]},
        "total_sum": total_sum,
        "items": items_out,
    })


@bp.route("/api/analysis/details")
def api_analysis_details():
    date_from = (request.args.get("date_from") or "").strip()
    date_to = (request.args.get("date_to") or "").strip()
    category_id_raw = (request.args.get("category_id") or "").strip()
    kind = (request.args.get("kind") or "").strip()
    metka_id_raw = (request.args.get("metka_id") or "").strip()

    if not date_from or not date_to:
        return jsonify({"error": "date_from and date_to required"}), 400
    try:
        category_id = int(category_id_raw)
    except (TypeError, ValueError):
        return jsonify({"error": "category_id required"}), 400
    if kind not in ("unset", "metka", "no_good"):
        return jsonify({"error": "bad kind"}), 400

    start_iso = day_bound(date_from)
    end_iso = day_bound(date_to, True)
    LIMIT = 100

    with db() as conn:
        cat = conn.execute(
            "SELECT id, name, parent_id FROM categories WHERE id = ?",
            (category_id,),
        ).fetchone()
        if cat is None or cat["parent_id"] is not None:
            return jsonify({"error": "category must be root (level 1)"}), 400

        title = "— не задано —"
        join_c = ""
        extra_where = ""
        base_params = []

        if kind == "unset":
            join_c = ("LEFT JOIN comparison c "
                      "ON c.good_id = i.good_id AND c.category_id = ?")
            base_params.append(category_id)
            extra_where = "AND c.id IS NULL"

        elif kind == "metka":
            try:
                metka_id = int(metka_id_raw)
            except (TypeError, ValueError):
                return jsonify({"error": "metka_id required"}), 400
            mrow = conn.execute(
                "SELECT id, name, parent_id FROM categories WHERE id = ?",
                (metka_id,),
            ).fetchone()
            cmap = cat_map(conn)
            if mrow is None or metka_id not in descendants(cmap, category_id):
                return jsonify({"error": "metka not in category"}), 400
            title = mrow["name"]
            join_c = ("JOIN comparison c "
                      "ON c.good_id = i.good_id AND c.category_id = ?")
            base_params.append(category_id)
            metka_ids = [metka_id] + sorted(descendants(cmap, metka_id))
            extra_where = "AND c.metka_id IN (" + ",".join("?" * len(metka_ids)) + ")"

        if kind == "no_good":
            return jsonify({
                "kind": kind, "title": "— без товара —",
                "total": 0, "items": [],
            })

        count_sql = f"""
            SELECT COUNT(DISTINCT g.id)
            FROM items i
            JOIN receipts r ON r.id = i.receipt_id
            JOIN goods g    ON g.id = i.good_id
            {join_c}
            WHERE r.check_at >= ? AND r.check_at <= ?
            {extra_where}
        """
        cnt_params = list(base_params) + [start_iso, end_iso]
        if kind == "metka":
            cnt_params.extend(metka_ids)
        total = conn.execute(count_sql, cnt_params).fetchone()[0]

        data_sql = f"""
            SELECT g.id AS good_id, g.name AS name
            FROM items i
            JOIN receipts r ON r.id = i.receipt_id
            JOIN goods g    ON g.id = i.good_id
            {join_c}
            WHERE r.check_at >= ? AND r.check_at <= ?
            {extra_where}
            GROUP BY g.id
            ORDER BY COALESCE(SUM(i.sum), 0) DESC, g.name ASC
            LIMIT ?
        """
        data_params = list(cnt_params) + [LIMIT]
        rows = conn.execute(data_sql, data_params).fetchall()

    return jsonify({
        "kind": kind,
        "title": title,
        "total": total,
        "items": [{"good_id": r["good_id"], "name": r["name"]} for r in rows],
    })


@bp.route("/api/analysis/periods")
def api_analysis_periods():
    category_id_raw = (request.args.get("category_id") or "").strip()
    date_from = (request.args.get("date_from") or "").strip()
    date_to = (request.args.get("date_to") or "").strip()
    interval = (request.args.get("interval") or "month").strip().lower()

    if not category_id_raw or not date_from or not date_to:
        return jsonify({"error": "category_id, date_from, date_to required"}), 400
    try:
        category_id = int(category_id_raw)
    except (TypeError, ValueError):
        return jsonify({"error": "bad category_id"}), 400
    if interval not in ALLOWED_INTERVALS:
        return jsonify({"error": "bad interval"}), 400

    try:
        intervals = build_intervals(date_from, date_to, interval)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if not intervals:
        return jsonify({"error": "empty interval list"}), 400
    if len(intervals) > 1000:
        return jsonify({
            "error": f"слишком много интервалов ({len(intervals)}); "
                     f"сократите период или возьмите более крупный шаг"
        }), 400

    M = len(intervals)
    outer_start = intervals[0]["start_iso"]
    outer_end = intervals[-1]["end_iso"]
    starts_dt = [datetime.fromisoformat(iv["start_iso"]) for iv in intervals]

    with db() as conn:
        cat = conn.execute(
            "SELECT id, name, parent_id FROM categories WHERE id = ?",
            (category_id,),
        ).fetchone()
        if cat is None or cat["parent_id"] is not None:
            return jsonify({"error": "category must be root (level 1)"}), 400

        cmap = cat_map(conn)
        top_ids = [c["id"] for c in cmap.values() if c["parent_id"] == category_id]

        all_in_cat = set()
        for top_id in top_ids:
            all_in_cat.add(top_id)
            all_in_cat |= descendants(cmap, top_id)

        rows = conn.execute("""
            SELECT r.check_at AS check_at,
                   i.sum AS s,
                   c.metka_id AS metka_id
            FROM items i
            JOIN receipts r ON r.id = i.receipt_id
            JOIN goods g    ON g.id = i.good_id
            LEFT JOIN comparison c
                   ON c.good_id = i.good_id AND c.category_id = ?
            WHERE r.check_at >= ? AND r.check_at <= ?
        """, (category_id, outer_start, outer_end)).fetchall()

        no_good_rows = conn.execute("""
            SELECT r.check_at AS check_at, i.sum AS s
            FROM items i
            JOIN receipts r ON r.id = i.receipt_id
            WHERE r.check_at >= ? AND r.check_at <= ?
              AND (i.good_id IS NULL
                   OR i.good_id NOT IN (SELECT id FROM goods))
        """, (outer_start, outer_end)).fetchall()

    def find_idx(check_at_str):
        try:
            dt = datetime.fromisoformat(check_at_str)
        except Exception:
            return None
        idx = bisect.bisect_right(starts_dt, dt) - 1
        if idx < 0: idx = 0
        if idx >= M: idx = M - 1
        return idx

    per_metka = {}
    unset_values = [0.0] * M

    for r in rows:
        idx = find_idx(r["check_at"])
        if idx is None:
            continue
        s = r["s"] or 0
        mid = r["metka_id"]
        if mid is None:
            unset_values[idx] += s
        elif mid in all_in_cat:
            arr = per_metka.setdefault(mid, [0.0] * M)
            arr[idx] += s

    no_good_values = [0.0] * M
    for r in no_good_rows:
        idx = find_idx(r["check_at"])
        if idx is None:
            continue
        no_good_values[idx] += r["s"] or 0

    def build_node(node_id):
        meta = cmap[node_id]
        own = per_metka.get(node_id, [0.0] * M)
        subtree = own.copy()
        children = []
        for c in cmap.values():
            if c["parent_id"] == node_id:
                cn = build_node(c["id"])
                for i in range(M):
                    subtree[i] += cn["values"][i]
                children.append(cn)
        children.sort(key=lambda c: (not c["is_folder"], c["name"].casefold()))
        return {
            "id": node_id,
            "name": meta["name"],
            "is_folder": bool(meta["is_folder"]),
            "values": [round(v, 2) for v in subtree],
            "total": round(sum(subtree), 2),
            "children": children,
        }

    def filter_zero(node):
        node["children"] = [filter_zero(c) for c in node["children"]]
        node["children"] = [c for c in node["children"] if c is not None]
        if node["total"] == 0 and not node["children"]:
            return None
        return node

    items = []
    for top_id in sorted(top_ids, key=lambda x: cmap[x]["name"].casefold()):
        node = filter_zero(build_node(top_id))
        if node is not None:
            items.append(node)

    if any(v > 0 for v in unset_values):
        items.append({
            "id": None, "kind": "unset",
            "name": "— не задано —",
            "is_folder": False,
            "values": [round(v, 2) for v in unset_values],
            "total": round(sum(unset_values), 2),
            "children": [],
        })
    if any(v > 0 for v in no_good_values):
        items.append({
            "id": None, "kind": "no_good",
            "name": "— без товара —",
            "is_folder": False,
            "values": [round(v, 2) for v in no_good_values],
            "total": round(sum(no_good_values), 2),
            "children": [],
        })

    totals = [0.0] * M
    for it in items:
        for i in range(M):
            totals[i] += it["values"][i]
    totals = [round(v, 2) for v in totals]
    grand_total = round(sum(totals), 2)

    return jsonify({
        "category": {"id": cat["id"], "name": cat["name"]},
        "period": {"from": date_from, "to": date_to},
        "interval": interval,
                "intervals": [
            {
                "key": iv["key"],
                "label": iv["label"],
                "start": iv["start_iso"][:10],
                "end":   iv["end_iso"][:10],
            }
            for iv in intervals
        ],
        "items": items,
        "totals": totals,
        "grand_total": grand_total,
    })


@bp.route("/api/analysis/compare")
def api_analysis_compare():
    category_id_raw = (request.args.get("category_id") or "").strip()
    p1_from = (request.args.get("p1_from") or "").strip()
    p1_to   = (request.args.get("p1_to")   or "").strip()
    p2_from = (request.args.get("p2_from") or "").strip()
    p2_to   = (request.args.get("p2_to")   or "").strip()
    include_unset = request.args.get("include_unset", "1") == "1"

    if not all([category_id_raw, p1_from, p1_to, p2_from, p2_to]):
        return jsonify({"error": "category_id, p1_from, p1_to, p2_from, p2_to required"}), 400
    try:
        category_id = int(category_id_raw)
    except (TypeError, ValueError):
        return jsonify({"error": "bad category_id"}), 400

    def collect(from_d, to_d):
        start_iso = day_bound(from_d)
        end_iso = day_bound(to_d, True)
        with db() as conn:
            cat = conn.execute(
                "SELECT id, name, parent_id FROM categories WHERE id = ?",
                (category_id,),
            ).fetchone()
            if cat is None or cat["parent_id"] is not None:
                raise ValueError("category must be root (level 1)")

            cmap = cat_map(conn)
            metkas = sorted((c for c in cmap.values() if c["parent_id"] == category_id),
                            key=lambda c: (not c["is_folder"], c["name"].casefold()))
            branch_of = {}
            for d in metkas:
                branch_of[d["id"]] = d["id"]
                for x in descendants(cmap, d["id"]):
                    branch_of[x] = d["id"]

            item_rows = conn.execute("""
                SELECT i.receipt_id, i.sum AS s, c.metka_id AS metka_id
                FROM items i
                JOIN receipts r ON r.id = i.receipt_id
                JOIN goods g    ON g.id = i.good_id
                LEFT JOIN comparison c
                       ON c.good_id = i.good_id AND c.category_id = ?
                WHERE r.check_at >= ? AND r.check_at <= ?
            """, (category_id, start_iso, end_iso)).fetchall()

            agg = {}
            for r in item_rows:
                key = branch_of.get(r["metka_id"]) if r["metka_id"] is not None else None
                a_ = agg.setdefault(key, [0.0, 0, set()])
                a_[0] += r["s"] or 0
                a_[1] += 1
                a_[2].add(r["receipt_id"])

            no_good_row = conn.execute("""
                SELECT COALESCE(SUM(i.sum), 0) AS total_sum,
                       COUNT(i.id)             AS items_count,
                       COUNT(DISTINCT i.receipt_id) AS receipts_count
                FROM items i
                JOIN receipts r ON r.id = i.receipt_id
                WHERE r.check_at >= ? AND r.check_at <= ?
                  AND (i.good_id IS NULL
                       OR i.good_id NOT IN (SELECT id FROM goods))
            """, (start_iso, end_iso)).fetchone()

        return cat, metkas, agg, no_good_row

    try:
        cat, metkas, agg1, no_good1 = collect(p1_from, p1_to)
        _,   _,       agg2, no_good2 = collect(p2_from, p2_to)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    items_map = {}
    for m in metkas:
        items_map[m["id"]] = {
            "key": f"metka:{m['id']}",
            "metka_id": m["id"],
            "name": m["name"],
            "is_folder": bool(m["is_folder"]),
            "sum1": 0.0, "sum2": 0.0,
            "items_count1": 0, "items_count2": 0,
            "receipts_count1": 0, "receipts_count2": 0,
        }

    for k, v in agg1.items():
        if k is None or k not in items_map: continue
        items_map[k]["sum1"] = float(v[0])
        items_map[k]["items_count1"] = int(v[1])
        items_map[k]["receipts_count1"] = len(v[2])
    for k, v in agg2.items():
        if k is None or k not in items_map: continue
        items_map[k]["sum2"] = float(v[0])
        items_map[k]["items_count2"] = int(v[1])
        items_map[k]["receipts_count2"] = len(v[2])

    items_out = list(items_map.values())

    unset_v1 = agg1.get(None)
    unset_v2 = agg2.get(None)
    if include_unset and (unset_v1 or unset_v2):
        items_out.append({
            "key": "unset", "metka_id": None,
            "name": "— не задано —", "is_folder": False,
            "sum1": float(unset_v1[0]) if unset_v1 else 0.0,
            "sum2": float(unset_v2[0]) if unset_v2 else 0.0,
            "items_count1": int(unset_v1[1]) if unset_v1 else 0,
            "items_count2": int(unset_v2[1]) if unset_v2 else 0,
            "receipts_count1": len(unset_v1[2]) if unset_v1 else 0,
            "receipts_count2": len(unset_v2[2]) if unset_v2 else 0,
        })

    if include_unset and (
        (no_good1 and no_good1["items_count"]) or
        (no_good2 and no_good2["items_count"])
    ):
        items_out.append({
            "key": "no_good", "metka_id": None,
            "name": "— без товара —", "is_folder": False,
            "sum1": float(no_good1["total_sum"]) if no_good1 else 0.0,
            "sum2": float(no_good2["total_sum"]) if no_good2 else 0.0,
            "items_count1": int(no_good1["items_count"]) if no_good1 else 0,
            "items_count2": int(no_good2["items_count"]) if no_good2 else 0,
            "receipts_count1": int(no_good1["receipts_count"]) if no_good1 else 0,
            "receipts_count2": int(no_good2["receipts_count"]) if no_good2 else 0,
        })

    items_out = [x for x in items_out if x["sum1"] > 0 or x["sum2"] > 0]

    for x in items_out:
        x["delta"] = x["sum2"] - x["sum1"]
        x["delta_pct"] = (x["delta"] / x["sum1"] * 100.0) if x["sum1"] > 0 else None

    items_out.sort(key=lambda x: x["sum2"], reverse=True)

    total1 = sum(x["sum1"] for x in items_out)
    total2 = sum(x["sum2"] for x in items_out)

    return jsonify({
        "category": {"id": cat["id"], "name": cat["name"]},
        "period1": {"from": p1_from, "to": p1_to},
        "period2": {"from": p2_from, "to": p2_to},
        "total1": total1,
        "total2": total2,
        "delta": total2 - total1,
        "delta_pct": ((total2 - total1) / total1 * 100.0) if total1 > 0 else None,
        "items": items_out,
    })