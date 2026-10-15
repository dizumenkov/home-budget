def cat_map(conn):
    return {r["id"]: dict(r) for r in conn.execute(
        "SELECT id, parent_id, name, is_folder FROM categories")}


def descendants(cmap, node_id):
    out, stack = set(), [node_id]
    while stack:
        cur = stack.pop()
        for cid, c in cmap.items():
            if c["parent_id"] == cur and cid not in out:
                out.add(cid)
                stack.append(cid)
    return out


def top(cmap, node_id):
    cur = node_id
    while cmap[cur]["parent_id"] is not None:
        cur = cmap[cur]["parent_id"]
    return cur


def is_dup(cmap, parent_id, name, exclude_id=None):
    return any(c["parent_id"] == parent_id and c["id"] != exclude_id
               and c["name"].casefold() == name.casefold() for c in cmap.values())
