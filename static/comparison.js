"use strict";

/* comparison.js — логика страницы (авто-экстракция) */

"use strict";

const params = new URLSearchParams(location.search);
const goodId = parseInt(params.get("good_id"), 10);
const embedded = params.get("embedded") === "1";
const backMode = params.get("back") === "1";

const rowsEl = $("rows");
const statusEl = $("status");

const productsBlock = $("products-block");
const productsList = $("products-list");

const changeModal = $("change-modal");
const changeName = $("change-name");
const changeSelect = $("change-select");
let changeTarget = null;   // { id, name }

let goodsCache = null;
let catsCache = null;
let saveBusy = false;

function setStatus(m, kind) {
  statusEl.textContent = m || "";
  statusEl.className = kind || "";
}

// ---------- закрытие / уведомление родителя ----------
function closePage() {
  if (embedded && window.parent && window.parent !== window) {
    const type = backMode ? "back-to-list" : "close-comparison";
    window.parent.postMessage({ type }, "*");
    return;
  }
  window.close();
  setTimeout(() => {
    if (!window.closed) history.length > 1 ? history.back() : (location.href = "/");
  }, 50);
}

function notifyParentChanged() {
  if (embedded && window.parent && window.parent !== window) {
    window.parent.postMessage({ type: "products-changed" }, "*");
  }
}

if (embedded) {
  const navBack = $("nav-back");
  navBack.href = "javascript:void(0)";
  navBack.textContent = backMode ? "← к списку" : "← закрыть";
  navBack.addEventListener("click", (e) => { e.preventDefault(); closePage(); });
  $("btn-close").textContent = backMode ? "← К списку" : "Закрыть";
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!changeModal.hidden) {
    e.preventDefault();
    closeChangeModal();
    e.stopPropagation();
    return;
  }
  e.preventDefault();
  closePage();
});

$("btn-close").addEventListener("click", closePage);

// ---------- загрузка данных ----------
async function loadGood() {
  const r = await fetch(`/api/goods/${goodId}`);
  if (!r.ok) {
    $("good-name").textContent = "Товар не найден";
    return null;
  }
  const g = await r.json();
  $("good-name").innerHTML = "";
  const span = document.createElement("span");
  span.textContent = g.name;
  $("good-name").appendChild(span);
  return g;
}

async function loadCategories() {
  const r = await fetch("/api/categories");
  const d = await r.json();
  return d.items || [];
}

async function loadComparisons() {
  const r = await fetch(`/api/goods/${goodId}/comparisons`);
  const d = await r.json();
  const map = {};
  for (const c of (d.items || [])) map[c.category_id] = c.metka_id;
  return map;
}

async function loadAllGoods() {
  if (goodsCache) return goodsCache;
  const r = await fetch("/api/goods");
  const d = await r.json();
  goodsCache = d.items || [];
  return goodsCache;
}

async function loadProducts() {
  const r = await fetch(`/api/goods/${goodId}/products`);
  const d = await r.json();
  return d.items || [];
}

async function save(categoryId, metkaId) {
  if (saveBusy) return false;
  saveBusy = true;
  try {
    const r = await fetch(`/api/goods/${goodId}/comparisons/${categoryId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metka_id: metkaId }),
    });
    const d = await r.json();
    if (!r.ok) {
      setStatus("Ошибка: " + (d.error || r.status), "err");
      return false;
    }
    setStatus(metkaId == null ? "Снято" : "Сохранено");
    statusEl.classList.add("saved");
    setTimeout(() => { statusEl.classList.remove("saved"); }, 800);
    return true;
  } catch (e) {
    setStatus("Ошибка: " + e.message, "err");
    return false;
  } finally {
    saveBusy = false;
  }
}

// ---------- построение дерева ----------
function buildTreeMaps(cats) {
  const byId = {};
  const parentOf = {};
  (function walk(nodes, parentId) {
    for (const n of nodes) {
      byId[n.id] = n;
      parentOf[n.id] = parentId;
      walk(n.children || [], n.id);
    }
  })(cats, null);
  return { byId, parentOf };
}

function buildChosenPath(byId, parentOf, catId, metkaId) {
  if (metkaId == null) return [];
  if (!byId[metkaId]) return [];
  const path = [];
  let cur = metkaId;
  let safe = 0;
  while (cur != null && cur !== catId && safe < 100) {
    path.unshift(cur);
    cur = parentOf[cur];
    safe++;
  }
  return cur === catId ? path : [];
}

function collectPath(blockEl, parentOf, catId) {
  const sels = blockEl.querySelectorAll(".levels select");
  const path = [];
  let expectedParent = catId;
  for (const s of sels) {
    if (!s.value) break;
    const id = parseInt(s.value, 10);
    if (parentOf[id] !== expectedParent) break;
    path.push(id);
    expectedParent = id;
  }
  return path;
}

// ---------- рендер одного блока категории ----------
function renderBlock(blockEl, cat, byId, parentOf, chosenPath) {
  const levelsEl = blockEl.querySelector(".levels");
  levelsEl.innerHTML = "";

  const titleEl = blockEl.querySelector(".cat-title");
  if (titleEl) {
    titleEl.innerHTML = "";
    const nm = document.createElement("span");
    nm.textContent = cat.name;
    titleEl.appendChild(nm);
  }

  let parentId = cat.id;
  let depth = 0;
  let leafSelected = false;

  while (true) {
    const selectedId = chosenPath[depth] ?? null;
    const parentNode = byId[parentId];
    const children = parentNode ? (parentNode.children || []) : [];

    const level = document.createElement("div");
    level.className = "level";
    level.style.marginLeft = (depth * 20) + "px";

    const label = document.createElement("span");
    label.className = "lvl-label";
    label.textContent = depth === 0 ? "Выбор" : "Уточнить";
    level.appendChild(label);

    const sel = document.createElement("select");
    sel.dataset.depth = depth;

    const optNone = document.createElement("option");
    optNone.value = "";
    optNone.textContent = depth === 0 ? "— не задано —" : "— не выбрано —";
    sel.appendChild(optNone);

    if (!children.length) {
      optNone.textContent = depth === 0 ? "— нет меток —" : "— пусто —";
      sel.disabled = true;
    } else {
      for (const ch of children) {
        const opt = document.createElement("option");
        opt.value = ch.id;
        opt.textContent = (ch.is_folder ? "📁 " : "• ") + ch.name;
        sel.appendChild(opt);
      }
      if (selectedId != null && byId[selectedId]) {
        sel.value = String(selectedId);
      }
    }

    sel.addEventListener("change", () => {
      onLevelChange(blockEl, cat, byId, parentOf);
    });

    level.appendChild(sel);

    const mark = document.createElement("span");
    mark.className = "chosen-mark";
    level.appendChild(mark);

    levelsEl.appendChild(level);

    if (selectedId == null) break;
    const node = byId[selectedId];
    if (!node || !node.is_folder) {
      if (node) { mark.textContent = "✓"; leafSelected = true; }
      break;
    }
    if (depth > 50) break;
    parentId = selectedId;
    depth++;
  }

  if (leafSelected) {
    const last = levelsEl.querySelector(".level:last-child .chosen-mark");
    if (last) last.textContent = "✓";
  }
}

async function onLevelChange(blockEl, cat, byId, parentOf) {
  const path = collectPath(blockEl, parentOf, cat.id);
  let metkaId = null;
  if (path.length > 0) {
    const last = byId[path[path.length - 1]];
    if (last && !last.is_folder) metkaId = last.id;
  }
  const ok = await save(cat.id, metkaId);
  if (ok) {
    renderBlock(blockEl, cat, byId, parentOf, path);
    notifyParentChanged();
  }
}

async function renderCategories(chosen) {
  rowsEl.innerHTML = "";

  if (!catsCache) catsCache = await loadCategories();
  const cats = catsCache;

  if (!cats.length) {
    rowsEl.innerHTML = `
      <div class="empty">
        Категории не заданы.
        <a href="/categories" target="_blank" rel="noopener">
          Создать категории и метки
        </a>.
      </div>`;
    return;
  }

  const { byId, parentOf } = buildTreeMaps(cats);

  for (const cat of cats) {
    const block = document.createElement("div");
    block.className = "cat-block";

    const title = document.createElement("div");
    title.className = "cat-title";
    block.appendChild(title);

    const levels = document.createElement("div");
    levels.className = "levels";
    block.appendChild(levels);

    const initialPath = buildChosenPath(byId, parentOf, cat.id, chosen[cat.id]);
    renderBlock(block, cat, byId, parentOf, initialPath);

    rowsEl.appendChild(block);
  }
}

// ---------- блок привязанных products ----------
async function renderProducts() {
  let items = [];
  try {
    items = await loadProducts();
  } catch (e) {
    setStatus("Ошибка загрузки привязанных: " + e.message, "err");
    return;
  }

  if (!items.length) {
    productsBlock.hidden = true;
    productsList.innerHTML = "";
    return;
  }
  productsBlock.hidden = false;
  productsList.innerHTML = "";

  for (const p of items) {
    const li = document.createElement("li");

    const name = document.createElement("span");
    name.className = "product-name";
    name.textContent = p.name;
    li.appendChild(name);

    const actions = document.createElement("span");
    actions.className = "actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "sm";
    editBtn.textContent = "Изменить";
    editBtn.addEventListener("click", () => openChangeModal(p));
    actions.appendChild(editBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "del";
    delBtn.textContent = "Удалить";
    delBtn.addEventListener("click", () => removeProduct(p));
    actions.appendChild(delBtn);

    li.appendChild(actions);
    productsList.appendChild(li);
  }
}

async function removeProduct(p) {
  if (!confirm(`Удалить привязку «${p.name}»?\nСырое наименование станет «— не сопоставлено —».`)) return;
  try {
    const r = await fetch(`/api/products/${p.id}/good`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ good_id: 0 }),
    });
    const d = await r.json();
    if (!r.ok) { setStatus("Ошибка: " + (d.error || r.status), "err"); return; }
    setStatus(`Отвязано: «${p.name}»`);
    await renderProducts();
    notifyParentChanged();
  } catch (e) {
    setStatus("Ошибка: " + e.message, "err");
  }
}

// ---------- модалка смены продукта ----------
async function openChangeModal(p) {
  changeTarget = p;
  changeName.textContent = p.name;
  changeSelect.innerHTML = "";

  const goods = await loadAllGoods();
  for (const g of goods) {
    const o = document.createElement("option");
    o.value = g.id;
    o.textContent = g.name;
    changeSelect.appendChild(o);
  }
  changeSelect.value = String(goodId);

  changeModal.hidden = false;
}

function closeChangeModal() {
  changeModal.hidden = true;
  changeTarget = null;
}

$("change-backdrop").addEventListener("click", closeChangeModal);
$("change-cancel").addEventListener("click", closeChangeModal);

$("change-apply").addEventListener("click", async () => {
  if (!changeTarget) return;
  const newGoodId = parseInt(changeSelect.value, 10);
  if (!newGoodId || newGoodId === goodId) { closeChangeModal(); return; }
  try {
    const r = await fetch(`/api/products/${changeTarget.id}/good`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ good_id: newGoodId }),
    });
    const d = await r.json();
    if (!r.ok) { setStatus("Ошибка: " + (d.error || r.status), "err"); return; }
    setStatus(`Переназначено: «${changeTarget.name}»`);
    closeChangeModal();
    await renderProducts();
    notifyParentChanged();
  } catch (e) {
    setStatus("Ошибка: " + e.message, "err");
  }
});

// ---------- кнопки в панели ----------
$("btn-open-categories").addEventListener("click", () => {
  window.open("/categories", "_blank", "noopener");
});

$("btn-reload").addEventListener("click", async () => {
  setStatus("Обновление…");
  goodsCache = null;
  catsCache = null;
  await init();
  setStatus("");
});

// ---------- старт ----------
async function init() {
  if (!goodId || isNaN(goodId)) {
    $("good-name").textContent = "Не указан good_id";
    return;
  }

  const [, , chosen] = await Promise.all([
    loadGood(),
    (async () => { if (!catsCache) catsCache = await loadCategories(); })(),
    loadComparisons(),
  ]);

  await renderCategories(chosen);
  await renderProducts();
}

init();
