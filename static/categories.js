"use strict";

/* categories.js — логика страницы (авто-экстракция) */

"use strict";

const treeEl = $("tree");
const statusEl = $("status");
const emptyEl = $("empty-state");

let tree = [];
let flat = {};
const collapsed = new Set();
let firstLoad = true;  // при первом load() сворачиваем все папки

function setStatus(msg, kind) {
  statusEl.textContent = msg || "";
  statusEl.className = kind || "";
}

function errText(code) {
  return ({
    "name required": "Введите название",
    "parent not found": "Родительская папка не найдена",
    "parent must be a folder": "Внутрь можно добавлять только в папку",
    "duplicate": "Такое название уже есть на этом уровне",
    "not found": "Узел не найден",
    "not empty": "Сначала удалите всё вложенное",
    "cannot move into itself": "Нельзя переместить папку в себя или в свою подпапку",
    "element cannot be top level": "Элемент нельзя сделать категорией верхнего уровня",
    "links_would_be_removed": "Перемещение снимет привязки товаров",
  })[code] || code || "Ошибка";
}

async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await r.json(); } catch (_) {}
  return { ok: r.ok, status: r.status, data };
}

// ---------- загрузка ----------
async function load() {
  try {
    const r = await fetch("/api/categories");
    const d = await r.json();
    tree = d.items || [];
    flat = {};
    (function walk(nodes, parent_id) {
      for (const n of nodes) {
        flat[n.id] = { ...n, parent_id };
        walk(n.children || [], n.id);
      }
    })(tree, null);

    if (firstLoad) {
      firstLoad = false;
      (function collapseAll(nodes) {
        for (const n of nodes) {
          if (n.is_folder) collapsed.add(n.id);
          collapseAll(n.children || []);
        }
      })(tree);
    }

    render();
  } catch (e) {
    setStatus("Не удалось загрузить: " + e.message, "err");
  }
}

// ---------- рендер ----------
function countLeaves(node) {
  let n = 0;
  (function walk(x) {
    if (!x.is_folder) { n += 1; return; }
    for (const c of (x.children || [])) walk(c);
  })(node);
  return n;
}

function render() {
  treeEl.innerHTML = "";
  emptyEl.hidden = tree.length > 0;
  for (const node of tree) {
    treeEl.appendChild(renderNode(node));
  }
}

function renderNode(node) {
  const li = document.createElement("li");
  li.dataset.id = node.id;

  const row = document.createElement("div");
  row.className = "node-row" + (node.is_folder ? " folder-row" : "");

  if (node.is_folder) {
    const hasKids = (node.children || []).length > 0;
    const tg = document.createElement("button");
    tg.className = "toggle";
    tg.type = "button";
    tg.textContent = !hasKids ? "·" : (collapsed.has(node.id) ? "▶" : "▼");
    if (hasKids) {
      tg.title = "Свернуть / развернуть";
      tg.addEventListener("click", () => {
        if (collapsed.has(node.id)) collapsed.delete(node.id);
        else collapsed.add(node.id);
        render();
      });
    } else {
      tg.disabled = true;
    }
    row.appendChild(tg);
  } else {
    const sp = document.createElement("span");
    sp.className = "toggle";
    row.appendChild(sp);
  }

  const icon = document.createElement("span");
  icon.className = "icon";
  icon.textContent = node.is_folder ? "📁" : "•";
  row.appendChild(icon);

  const nameWrap = document.createElement("span");
  nameWrap.className = "name";
  const nameSpan = document.createElement("span");
  nameSpan.textContent = node.name;
  nameWrap.appendChild(nameSpan);
  row.appendChild(nameWrap);

  const meta = document.createElement("span");
  meta.className = "meta";
  if (node.is_folder) {
    const kids = (node.children || []).length;
    const leaves = countLeaves(node);
    meta.textContent = `${kids} эл. · ${leaves} мет.`;
  } else {
    const c = node.goods_count || 0;
    meta.textContent = c > 0 ? `товаров: ${c}` : "нет товаров";
  }
  row.appendChild(meta);

  const actions = document.createElement("span");
  actions.className = "row-actions";

  const editBtn = mkAct("✎", "Переименовать",
                        () => startRename(nameWrap, node, editBtn));
  actions.appendChild(editBtn);

  const moveBtn = mkAct("→", "Переместить",
                        () => startMove(li, node, moveBtn));
  actions.appendChild(moveBtn);

  const canDelete = !node.is_folder || (node.children || []).length === 0;
  const delBtn = mkAct("✕",
                       canDelete ? "Удалить" : "Сначала удалите вложенное",
                       () => removeNode(node), "danger");
  if (!canDelete) delBtn.disabled = true;
  actions.appendChild(delBtn);

  row.appendChild(actions);
  li.appendChild(row);

  if (node.is_folder && !collapsed.has(node.id)) {
    const ul = document.createElement("ul");
    for (const child of (node.children || [])) {
      ul.appendChild(renderNode(child));
    }
    li.appendChild(ul);

    const addPanel = document.createElement("div");
    addPanel.className = "add-panel";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = "новое в «" + node.name + "»";
    const btnFolder = document.createElement("button");
    btnFolder.textContent = "+ Папка";
    btnFolder.addEventListener("click", () => createNode(node.id, inp.value, true));
    const btnLeaf = document.createElement("button");
    btnLeaf.textContent = "+ Метка";
    btnLeaf.addEventListener("click", () => createNode(node.id, inp.value, false));
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); createNode(node.id, inp.value, false); }
    });
    addPanel.append(inp, btnFolder, btnLeaf);
    li.appendChild(addPanel);
  }

  return li;
}

function mkAct(text, title, handler, cls) {
  const b = document.createElement("button");
  b.className = "act" + (cls ? " " + cls : "");
  b.type = "button";
  b.textContent = text;
  b.title = title;
  b.addEventListener("click", handler);
  return b;
}

// ---------- действия ----------
async function createNode(parentId, name, isFolder) {
  name = (name || "").trim();
  if (!name) { setStatus("Введите название", "err"); return; }
  const { ok, data } = await api("POST", "/api/categories", {
    name, parent_id: parentId, is_folder: isFolder,
  });
  if (!ok) { setStatus(errText(data.error), "err"); return; }
  setStatus(`Добавлено: «${name}»`, "ok");
  if (parentId !== null) collapsed.delete(parentId);  // разворачиваем родителя
  await load();
}

function startRename(nameWrap, node, editBtn) {
  const nameSpan = nameWrap.querySelector("span");
  const oldName = node.name;
  const inp = document.createElement("input");
  inp.type = "text";
  inp.value = oldName;
  nameWrap.replaceChild(inp, nameSpan);
  inp.focus();
  inp.select();
  editBtn.disabled = true;

  const saveBtn = mkAct("✓", "Сохранить", () => finish(true));
  const cancelBtn = mkAct("✕", "Отмена", () => finish(false));
  editBtn.replaceWith(saveBtn);
  saveBtn.after(cancelBtn);

  let busy = false;
  async function finish(save) {
    if (busy) return;
    const newName = inp.value.trim();
    if (!save || newName === oldName) { await load(); return; }
    if (!newName) { inp.focus(); return; }
    busy = true;
    saveBtn.disabled = true;
    const { ok, data } = await api("PATCH",
      `/api/categories/${node.id}`, { name: newName });
    if (!ok) {
      setStatus(errText(data.error), "err");
      busy = false;
      saveBtn.disabled = false;
      inp.focus();
      return;
    }
    setStatus(`Переименовано: «${oldName}» → «${newName}»`, "ok");
    await load();
  }

  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    if (e.key === "Escape") { e.preventDefault(); finish(false); }
  });
  saveBtn.addEventListener("click", () => finish(true));
  cancelBtn.addEventListener("click", () => finish(false));
}

function startMove(li, node, moveBtn) {
  const banned = new Set();
  (function collect(n) {
    banned.add(n.id);
    for (const c of (n.children || [])) collect(c);
  })(node);

  const options = [];
  if (node.is_folder) options.push({ id: null, label: "— Верхний уровень —" });
  (function walk(nodes, prefix) {
    for (const n of nodes) {
      if (n.is_folder && !banned.has(n.id)) {
        options.push({ id: n.id, label: prefix + "📁 " + n.name });
        walk(n.children || [], prefix + "    ");
      }
    }
  })(tree, "");

  if (!options.length) {
    setStatus("Нет доступных папок для перемещения", "err");
    return;
  }

  const sel = document.createElement("select");
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.id === null ? "" : String(o.id);
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = node.parent_id === null ? "" : String(node.parent_id);

  const okBtn = mkAct("✓", "Переместить", () => doMove());
  const cancelBtn = mkAct("✕", "Отмена", () => load());

  const panel = document.createElement("div");
  panel.className = "move-inline";
  panel.append(sel, okBtn, cancelBtn);

  const children = Array.from(li.children).slice(1);
  li.innerHTML = "";
  li.appendChild(panel);
  for (const ch of children) li.appendChild(ch);

  async function doMove() {
    const parentId = sel.value === "" ? null : parseInt(sel.value, 10);
    let res = await api("PATCH", `/api/categories/${node.id}`, { parent_id: parentId });
    if (res.status === 409 && res.data.error === "links_would_be_removed") {
      if (!confirm(`Перемещение снимет привязки товаров: ${res.data.count}. Продолжить?`)) {
        await load();
        return;
      }
      res = await api("PATCH", `/api/categories/${node.id}`,
                      { parent_id: parentId, force: true });
    }
    if (!res.ok) {
      setStatus(errText(res.data.error), "err");
      await load();
      return;
    }
    setStatus(`Перемещено: «${node.name}»` +
              (res.data.removed_links ? `, снято привязок: ${res.data.removed_links}` : ""),
              "ok");
    if (parentId !== null) collapsed.delete(parentId);
    await load();
  }
}

async function removeNode(node) {
  const msg = node.is_folder
    ? `Удалить папку «${node.name}»?`
    : `Удалить метку «${node.name}»?\nВсе привязки товаров к ней будут сняты.`;
  if (!confirm(msg)) return;
  const { ok, data } = await api("DELETE", `/api/categories/${node.id}`);
  if (!ok) { setStatus(errText(data.error), "err"); return; }
  setStatus(`Удалено: «${node.name}»`, "ok");
  await load();
}

// ---------- создание корневой категории ----------
$("new-root-btn").addEventListener("click", async () => {
  const inp = $("new-root-name");
  const name = inp.value.trim();
  if (!name) { inp.focus(); return; }
  const { ok, data } = await api("POST", "/api/categories", { name });
  if (!ok) { setStatus(errText(data.error), "err"); return; }
  setStatus(`Категория «${name}» создана`, "ok");
  inp.value = "";
  await load();
});
$("new-root-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("new-root-btn").click();
});

// ---------- старт ----------
load();
