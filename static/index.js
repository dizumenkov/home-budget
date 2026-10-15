/* ============================================================
 * index.js — логика главной страницы
 * Использует общие функции из common.js: $, escapeHtml, fmtSum,
 * fmtCheckAt, getCategories, getComparisons, getGoodsList,
 * populateGoodsDatalist, showTip, hideTip, scheduleHideTip.
 * ============================================================ */
"use strict";

const CODE_LABELS = {
  "null": "— не обработан",
  "0": "0 — чек некорректен",
  "1": "1 — данные получены",
  "2": "2 — данные пока не получены",
  "3": "3 — превышено кол-во запросов",
  "4": "4 — ожидание перед повтором",
  "5": "5 — прочее (не получены)",
  "100": "100 — ручной ввод"
};
const CODE_MANUAL = 100;

const state = {
  page: 1, per_page: 50, sort: "id", order: "desc",
  date_from: "", date_to: "", pages: 1, total: 0
};

const tbody = $("tbody");
const statusEl = $("status");

const modal = $("modal");
const modalFrame = $("modal-frame");

let modalMode = null;          // 'comparison' | 'manual' | 'raw' | 'html' | 'products' | 'product'
let comparisonContext = null;  // { receiptId, itemsRowEl, toggleBtn }
let productContext = null;     // { receiptId, itemsRowEl, toggleBtn }

/* ---------- открытие модалки ---------- */
function openModalUrl(src, mode, title) {
  hideTip();
  modalMode = mode;
  modalFrame.removeAttribute("srcdoc");
  modalFrame.title = title || "";
  modalFrame.src = src;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}
function openModalSrcdoc(html, mode, title) {
  hideTip();
  modalMode = mode;
  modalFrame.title = title || "";
  modalFrame.removeAttribute("src");
  modalFrame.srcdoc = html;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeModal() {
  modal.hidden = true;
  modalFrame.removeAttribute("srcdoc");
  modalFrame.src = "about:blank";
  document.body.style.overflow = "";

  if (modalMode === "comparison") {
    // сбрасываем кэш сравнений
    if (typeof _comparisonsCache !== "undefined") _comparisonsCache.clear();
    if (comparisonContext) {
      refreshItemsRow(comparisonContext);
      comparisonContext = null;
    }
  }
  if (modalMode === "product") {
    if (typeof _comparisonsCache !== "undefined") _comparisonsCache.clear();
    if (productContext) {
      refreshItemsRow(productContext);
      productContext = null;
    }
  }
  if (modalMode === "manual") load();
  if (modalMode === "products") load();
  modalMode = null;

  refreshProductsBadge();
}

function openComparison(goodId, receiptId, itemsRowEl, toggleBtn) {
  comparisonContext = { receiptId, itemsRowEl, toggleBtn };
  openModalUrl(`/comparison?good_id=${goodId}&embedded=1`,
               "comparison", "Соответствия товара");
}

function openManual(id) {
  const q = new URLSearchParams();
  q.set("embedded", "1");
  if (id) q.set("id", String(id));
  openModalUrl(`/manual?${q.toString()}`,
               "manual", id ? "Редактирование чека" : "Ручной ввод чека");
}

function openRaw(raw) {
  const safe = escapeHtml(raw || "");
  const html = `<!doctype html><meta charset="utf-8">
    <style>
      body { font: 14px/1.5 ui-monospace, Menlo, Consolas, monospace;
             background:#f8f9fb; margin: 0; padding: 24px; color: #1f2328; }
      .hint { color:#6b7280; font: 13px/1.4 -apple-system, Segoe UI, Roboto, sans-serif;
              margin-bottom: 12px; }
      .qr { white-space: pre-wrap; word-break: break-all;
            background:#fff; border:1px solid #dcdfe4; border-radius:8px;
            padding:14px; user-select:all; }
    </style>
    <div class="hint">Сырая строка QR (raw). Клик по блоку — выделить целиком.</div>
    <div class="qr" onclick="window.getSelection().selectAllChildren(this)">${safe}</div>`;
  openModalSrcdoc(html, "raw", "QR-строка");
}

function openHtml(receiptId) {
  openModalUrl(`/api/receipts/${receiptId}/html`, "html", "HTML-представление чека");
}

function openProductsMatch() {
  const html = `<!doctype html><meta charset="utf-8">
    <style>
      :root { --border:#dcdfe4; --muted:#6b7280; --accent:#ffcc00; --accent-dark:#e0b200; }
      body { font:14px/1.45 -apple-system, Segoe UI, Roboto, Arial, sans-serif;
             background:#f8f9fb; margin:0; padding:16px 20px; color:#1f2328; }
      h2 { margin:0 0 8px; font-size:16px; }
      .hint { color:var(--muted); font-size:13px; margin-bottom:10px; }
      table { width:100%; border-collapse:collapse; background:#fff;
              border:1px solid var(--border); border-radius:8px; overflow:hidden; }
      th,td { padding:8px 10px; text-align:left; border-bottom:1px solid var(--border);
              font-size:13px; }
      th { background:#fafbfc; }
      tr:last-child td { border-bottom:none; }
      select { padding:6px 10px; border:1px solid var(--border); border-radius:6px;
               font:inherit; background:#fff; min-width:220px; }
      .empty { text-align:center; color:var(--muted); padding:24px; font-style:italic; }
      .cnt { color:var(--muted); text-align:right; width:120px; }
      #status { margin-top:10px; color:var(--muted); font-size:13px; min-height:18px; }
      #status.ok { color:#1a7f37; }
    </style>
    <h2>Сопоставление сырых товаров со справочником</h2>
    <div class="hint">Выберите «good» для каждого неразмеченного сырого наименования. Изменения сохраняются сразу.</div>
    <table>
      <thead><tr><th>Сырое наименование</th><th class="cnt">Позиций</th><th>Соответствие</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <div id="status"></div>
    <script>
    const $ = (id) => document.getElementById(id);
    const rowsEl = $("rows");
    const statusEl = $("status");

    async function loadGoods() {
      const r = await fetch("/api/goods");
      const d = await r.json();
      return d.items || [];
    }
    async function loadProducts() {
      const r = await fetch("/api/products?unmatched=1");
      const d = await r.json();
      return d.items || [];
    }
    async function save(productId, goodId) {
      const r = await fetch("/api/products/" + productId + "/good", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ good_id: goodId }),
      });
      const d = await r.json();
      if (!r.ok) { statusEl.textContent = "Ошибка: " + (d.error || r.status);
                   statusEl.className = ""; return false; }
      statusEl.textContent = "Сохранено";
      statusEl.className = "ok";
      setTimeout(() => { statusEl.className = ""; }, 600);
      return true;
    }
    (async function init() {
      const [goods, products] = await Promise.all([loadGoods(), loadProducts()]);
      if (!products.length) {
        rowsEl.innerHTML = '<tr><td colspan="3" class="empty">Все сырые товары сопоставлены</td></tr>';
        return;
      }
      for (const p of products) {
        const tr = document.createElement("tr");
        const tdName = document.createElement("td");
        tdName.textContent = p.name;
        tr.appendChild(tdName);

        const tdCnt = document.createElement("td");
        tdCnt.className = "cnt";
        tdCnt.textContent = p.items_count;
        tr.appendChild(tdCnt);

        const tdSel = document.createElement("td");
        const sel = document.createElement("select");
        const optNone = document.createElement("option");
        optNone.value = "";
        optNone.textContent = "— не сопоставлено —";
        sel.appendChild(optNone);
        for (const g of goods) {
          const o = document.createElement("option");
          o.value = g.id;
          o.textContent = g.name;
          sel.appendChild(o);
        }
        if (p.good_id) sel.value = String(p.good_id);
        sel.addEventListener("change", async () => {
          const gid = sel.value === "" ? 0 : parseInt(sel.value, 10);
          const ok = await save(p.id, gid);
          if (ok && gid) {
            tr.remove();
            if (!rowsEl.children.length) {
              rowsEl.innerHTML = '<tr><td colspan="3" class="empty">Все сырые товары сопоставлены</td></tr>';
            }
          }
        });
        tdSel.appendChild(sel);
        tr.appendChild(tdSel);

        rowsEl.appendChild(tr);
      }
    })();
    </script>`;
  openModalSrcdoc(html, "products", "Сопоставление товаров");
}

function openProductLink(productId, productName, currentGoodId, receiptId, itemsRowEl, toggleBtn) {
  productContext = { receiptId, itemsRowEl, toggleBtn };

  const html = `<!doctype html><meta charset="utf-8">
    <style>
      :root { --border:#dcdfe4; --muted:#6b7280; --danger:#b42318; }
      * { box-sizing: border-box; }
      body { font:14px/1.45 -apple-system, Segoe UI, Roboto, Arial, sans-serif;
             background:#f8f9fb; margin:0; padding:20px 24px; color:#1f2328; }
      h2 { margin:0 0 8px; font-size:16px; }
      .hint { color:var(--muted); font-size:13px; margin-bottom:14px; }
      .name { font-size:15px; font-weight:600; margin-bottom:12px; }
      .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      input[type=text], select {
        padding:8px 12px; border:1px solid var(--border); border-radius:6px;
        font:inherit; background:#fff;
      }
      input[type=text] { flex:1 1 220px; min-width:180px; }
      select { flex:0 1 260px; min-width:180px; }
      input[type=text]:focus, select:focus {
        outline:2px solid #ffcc00; outline-offset:-1px;
      }
      button {
        background:#ffcc00; border:1px solid #e0b200; color:#1f2328;
        padding:8px 12px; border-radius:6px; cursor:pointer; font-weight:600;
      }
      button:hover { background:#e0b200; }
      button.clear {
        background:#fff; border-color:var(--border); font-weight:500;
      }
      button.clear:hover { background:#f0f1f3; }
      #status { margin-top:14px; color:var(--muted); font-size:13px; min-height:18px; }
      #status.ok { color:#1a7f37; }
      #status.err { color:var(--danger); }
      .caption { color:var(--muted); font-size:12px; margin:0 0 4px 0; }
    </style>
    <h2>Связывание сырого наименования с продуктом</h2>
    <div class="hint">Можно набрать название с клавиатуры или выбрать из списка. Изменения сохраняются сразу. Пустое значение = «— не сопоставлено —».</div>
    <div class="name">${escapeHtml(productName)}</div>

    <div class="caption">Ввод с клавиатуры:</div>
    <div class="row">
      <input type="text" id="inp" list="goods-datalist-local"
             placeholder="начните вводить…" autocomplete="off">
    </div>

    <div class="caption" style="margin-top:12px;">Или выберите из списка:</div>
    <div class="row">
      <select id="sel"><option value="">— не сопоставлено —</option></select>
      <button id="btn-clear" class="clear" type="button" title="Снять привязку">Снять</button>
    </div>

    <datalist id="goods-datalist-local"></datalist>
    <div id="status"></div>
    <script>
    const $ = (id) => document.getElementById(id);
    const inp = $("inp");
    const sel = $("sel");
    const dl = $("goods-datalist-local");
    const statusEl = $("status");

    let goods = [];
    let current = ${Number(currentGoodId) || 0};
    let busy = false;

    async function loadGoods() {
      const r = await fetch("/api/goods");
      const d = await r.json();
      goods = d.items || [];
    }

    function fillDatalist() {
      dl.innerHTML = "";
      for (const g of goods) {
        const o = document.createElement("option");
        o.value = g.name;
        dl.appendChild(o);
      }
    }

    function fillSelect() {
      sel.innerHTML = "";
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "— не сопоставлено —";
      sel.appendChild(none);
      for (const g of goods) {
        const o = document.createElement("option");
        o.value = String(g.id);
        o.textContent = g.name;
        sel.appendChild(o);
      }
      sel.value = current ? String(current) : "";
    }

    async function save(goodId) {
      const r = await fetch("/api/products/${productId}/good", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ good_id: goodId }),
      });
      const d = await r.json();
      if (!r.ok) {
        statusEl.textContent = "Ошибка: " + (d.error || r.status);
        statusEl.className = "err";
        return false;
      }
      statusEl.textContent = "Сохранено";
      statusEl.className = "ok";
      setTimeout(() => { statusEl.className = ""; }, 800);
      return true;
    }

    async function applyGoodId(newId) {
      if (busy) return;
      if (newId === current) return;
      busy = true;
      try {
        const ok = await save(newId);
        if (!ok) return;
        current = newId;
        const g = goods.find(x => x.id === current);
        inp.value = g ? g.name : "";
        sel.value = current ? String(current) : "";
      } finally {
        busy = false;
      }
    }

    async function applyFromInput() {
      const entered = inp.value.trim();
      if (!entered) { await applyGoodId(0); return; }
      const found = goods.find(g => g.name.toLowerCase() === entered.toLowerCase());
      if (!found) {
        statusEl.textContent = "«" + entered + "» не найден в справочнике";
        statusEl.className = "err";
        return;
      }
      await applyGoodId(found.id);
    }

    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); applyFromInput(); }
      else if (e.key === "Escape") {
        const g = goods.find(x => x.id === current);
        inp.value = g ? g.name : "";
      }
    });
    inp.addEventListener("change", applyFromInput);

    sel.addEventListener("change", () => {
      const v = sel.value === "" ? 0 : parseInt(sel.value, 10);
      applyGoodId(v);
    });

    $("btn-clear").addEventListener("click", async () => {
      if (current === 0) { statusEl.textContent = "Уже не сопоставлено"; return; }
      inp.value = "";
      await applyGoodId(0);
    });

    (async function init() {
      await loadGoods();
      fillDatalist();
      fillSelect();
      if (current) {
        const g = goods.find(x => x.id === current);
        if (g) inp.value = g.name;
      }
      inp.focus();
    })();
    </script>`;

  openModalSrcdoc(html, "product", "Связывание товара");
}

/* ---------- кнопки модалки ---------- */
$("modal-close").addEventListener("click", closeModal);
$("modal-backdrop").addEventListener("click", closeModal);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) {
    closeModal();
    e.stopPropagation();
  }
});

window.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "close-comparison") closeModal();
  else if (d.type === "close-manual") {
    closeModal();
    if (d.refresh) load();
  }
  else if (d.type === "products-changed") {
    if (comparisonContext) refreshItemsRow(comparisonContext);
  }
});

$("nav-manual").addEventListener("click", (e) => {
  e.preventDefault();
  openManual(null);
});

$("nav-products").addEventListener("click", (e) => {
  e.preventDefault();
  openProductsMatch();
});

/* ---------- форматирование статуса ---------- */
function codeLabel(code) {
  const k = (code === null || code === undefined) ? "null" : String(code);
  return CODE_LABELS[k] ?? `${code} — (неизвестно)`;
}
function codeBadge(code) {
  const cls = {1:"ok",100:"manual",0:"err",5:"err",2:"wait",3:"wait",4:"wait"}[code] || "none";
  const text = {1:"Данные получены",100:"Ручной ввод",0:"Некорректен",5:"Ошибка",
                2:"Ожидание",3:"Лимит запросов",4:"Ожидание"}[code]
               || (code == null ? "Не обработан" : "Код " + code);
  return `<span class="badge ${cls}" title="${codeLabel(code)}">${text}</span>`;
}

/* ---------- рендер главной таблицы ---------- */
function renderRows(items) {
  tbody.innerHTML = "";
  if (!items.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" class="empty">Нет данных</td>`;
    tbody.appendChild(tr);
    return;
  }
  for (const it of items) {
    const tr = document.createElement("tr");
    tr.classList.add("main-row");
    if (it.has_problems) tr.classList.add("row-problems");

    const isManual = (it.code === CODE_MANUAL);
    const editBtn = isManual
      ? `<button class="icon-btn edit edit-btn" data-id="${it.id}" title="Редактировать">✎</button>`
      : "";
    const htmlBtn = it.has_html
      ? `<button class="icon-btn view html-btn" data-id="${it.id}" title="Показать HTML ФНС">👁</button>`
      : "";
    const qrBtn = (it.raw && !isManual)
      ? `<button class="icon-btn qr qr-btn" data-id="${it.id}" title="Показать QR-строку">QR</button>`
      : "";

    tr.innerHTML = `
      <td class="expander">
        <button class="icon-btn items-btn" data-id="${it.id}" title="Показать позиции">▶</button>
      </td>
      <td class="code">${codeBadge(it.code)}</td>
      <td>${fmtCheckAt(it.check_at)}</td>
      <td class="sum">${fmtSum(it.sum)}</td>
      <td class="user"></td>
      <td class="actions">
        ${htmlBtn}
        ${qrBtn}
        ${editBtn}
        <button class="icon-btn del del-btn" data-id="${it.id}" title="Удалить чек">✕</button>
      </td>`;
    const userTd = tr.querySelector("td.user");
    userTd.textContent = it.user ?? "";
    if (it.user) userTd.title = it.user;
    tr.dataset.raw = it.raw || "";
    tbody.appendChild(tr);
  }
}

function renderHeaders() {
  document.querySelectorAll("th[data-sort]").forEach(th => {
    const key = th.dataset.sort;
    let arrow = "";
    if (state.sort === key) arrow = state.order === "asc" ? "▲" : "▼";
    const base = { code: "Статус", check_at: "Дата чека",
                   sum: "Сумма", user: "Продавец" }[key];
    th.innerHTML = `${base}<span class="arrow">${arrow}</span>`;
  });
}

function renderPager() {
  $("pageinfo").textContent =
    `Стр. ${state.page} из ${state.pages} · всего ${state.total ?? 0}`;
  $("sum-total").textContent = state.sum_total != null
    ? "Сумма по фильтру: " + fmtSum(state.sum_total) + " ₽" : "";
  $("prev").disabled = state.page <= 1;
  $("next").disabled = state.page >= state.pages;
}

/* ---------- загрузка таблицы ---------- */
async function load() {
  saveState();
  const p = new URLSearchParams({
    page: state.page, per_page: state.per_page,
    sort: state.sort, order: state.order,
    date_from: state.date_from, date_to: state.date_to
  });
  try {
    const r = await fetch("/api/receipts?" + p.toString());
    if (!r.ok) { statusEl.textContent = "Ошибка загрузки"; return; }
    const data = await r.json();
    state.pages = data.pages;
    state.total = data.total;
    state.page = data.page;
    state.sum_total = data.sum_total;
    renderRows(data.items); renderHeaders(); renderPager();
  } catch (e) {
    statusEl.textContent = "Ошибка загрузки: " + e.message;
  }
}

function setStatus(msg) { statusEl.textContent = msg || ""; }

/* ---------- чтение очереди + запрос ФНС ---------- */
async function readQueue() {
  const btn = $("btn-read");
  btn.disabled = true;
  const parts = [];
  setStatus("Чтение очереди…");
  try {
    const r = await fetch("/api/read", { method: "POST" });
    const s = await r.json();
    parts.push(`Очередь: прочитано ${s.read}, сохранено ${s.saved}, дубликатов ${s.duplicate}, ` +
      `пропущено ${s.skipped}${s.skipped_info ? " (" + s.skipped_info.join("; ") + ")" : ""}, ` +
      `ошибок ${s.errors}` + (s.last_error ? " — " + s.last_error : ""));
  } catch (e) {
    parts.push("Очередь: ошибка — " + e.message);
  }
  setStatus(parts.join(" · ") + " · запрос данных в ФНС…");
  try {
    const r = await fetch("/api/fetch-fns", { method: "POST" });
    const s = await r.json();
    if (s.skipped) parts.push(`ФНС пропущен: ${s.skipped}`);
    else {
      let m = `ФНС: ожидало ${s.pending ?? 0}, обработано ${s.processed ?? 0}, ` +
              `обновлено ${s.updated ?? 0}, ошибок ${s.errors ?? 0}`;
      if (s.limit_reached) m += " (достигнут суточный лимит)";
      if (s.last_error) m += " — " + s.last_error;
      parts.push(m);
    }
  } catch (e) {
    parts.push("ФНС: ошибка — " + e.message);
  } finally {
    setStatus(parts.join(" · "));
    btn.disabled = false;
    state.page = 1;
    await refreshLimit();
    await refreshProductsBadge();
    await load();
  }
}

async function refreshLimit() {
  try {
    const r = await fetch("/api/fns-limit");
    const d = await r.json();
    const el = $("fns-limit");
    const out = d.used >= d.limit;
    el.textContent = out
      ? `Суточный лимит ФНС исчерпан (${d.used}/${d.limit}) — данные по новым чекам будут запрошены позже`
      : "";
    el.style.color = out ? "#b42318" : "";
  } catch (_) {}
}

async function refreshProductsBadge() {
  try {
    const r = await fetch("/api/products/unmatched/count");
    const d = await r.json();
    const btn = document.getElementById("nav-products");
    if (!btn) return;
    btn.textContent = d.count > 0
      ? `Сопоставить товары (${d.count})`
      : "Сопоставить товары";
  } catch (_) {}
}

async function deleteReceipt(id) {
  if (!confirm(`Удалить чек?`)) return;
  try {
    const r = await fetch(`/api/receipts/${id}`, { method: "DELETE" });
    if (!r.ok) { setStatus(`Не удалось удалить чек`); return; }
    setStatus(`Чек удалён`);
  } catch (e) {
    setStatus("Ошибка: " + e.message);
  } finally {
    const rowsNow = tbody.querySelectorAll("tr.main-row").length;
    if (rowsNow <= 1 && state.page > 1) state.page--;
    await load();
  }
}

/* ---------- развёрнутый состав чека ---------- */
function buildItemsRowContent(receiptId, items, errMsg, itemsRowEl, toggleBtn) {
  const td = document.createElement("td");
  td.colSpan = 6;

  if (errMsg) {
    td.innerHTML = `<em style="color:#d33">Ошибка загрузки: ${errMsg}</em>`;
    return td;
  }
  if (!items.length) {
    td.innerHTML = `<em>Нет позиций (fnsData не получены)</em>`;
    return td;
  }

  td.innerHTML = `
    <table>
      <thead>
        <tr>
          <th style="width:26%">Продукт</th>
          <th style="width:34%">Наименование</th>
          <th style="width:12%" class="num">Цена</th>
          <th style="width:10%" class="num">Кол-во</th>
          <th style="width:18%" class="num">Сумма</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>`;

  const gbody = td.querySelector("tbody");
  const ctx = { receiptId, itemsRowEl, toggleBtn };

  for (const g of items) {
    const gtr = document.createElement("tr");

    const goodTd = document.createElement("td");

    if (g.good_id) {
      const total = g.comp_total || 0;
      const filled = g.comp_filled || 0;
      if (total > 0 && filled < total) {
        const badge = document.createElement("span");
        badge.className = "comp-badge";
        badge.textContent = `(${filled}/${total})`;
        badge.title = `Заполнено ${filled} из ${total} категорий`;
        goodTd.appendChild(badge);
      }

      const a = document.createElement("span");
      a.className = "link-good";
      a.textContent = g.good_name ?? "";
      a.title = "Клик — изменить соответствия; наведение — список категорий";

      a.addEventListener("click", () =>
        openComparison(g.good_id, receiptId, itemsRowEl, toggleBtn));
      a.addEventListener("mouseenter", () => showTip(g.good_id, g.good_name || g.name, a));
      a.addEventListener("mouseleave", scheduleHideTip);

      goodTd.appendChild(a);
    } else {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "product-input";
      inp.setAttribute("list", "goods-datalist");
      inp.placeholder = "начните вводить…";
      inp.dataset.productId = g.product_id;
      inp.title = "Введите название товара из справочника и нажмите Enter";

      let saving = false;
      const trySave = async () => {
        if (saving) return;
        const entered = inp.value.trim();
        if (!entered) return;

        const goods = await getGoodsList();
        const found = goods.find(x =>
          x.name.toLowerCase() === entered.toLowerCase());
        if (!found) {
          setStatus(`«${entered}» не найден в справочнике`);
          return;
        }

        saving = true;
        inp.disabled = true;
        try {
          const r = await fetch(`/api/products/${inp.dataset.productId}/good`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ good_id: found.id }),
          });
          const d = await r.json();
          if (!r.ok) {
            setStatus("Ошибка: " + (d.error || r.status));
            inp.disabled = false;
            return;
          }
          setStatus(`Сопоставлено: «${found.name}»`);
          await refreshProductsBadge();
          await refreshItemsRow(ctx);
        } catch (e) {
          setStatus("Ошибка: " + e.message);
          inp.disabled = false;
        } finally {
          saving = false;
        }
      };

      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); trySave(); }
      });
      inp.addEventListener("change", trySave);

      goodTd.appendChild(inp);
    }
    gtr.appendChild(goodTd);

    const nameTd = document.createElement("td");
    const rawName = g.name ?? "";
    const nameLink = document.createElement("span");
    nameLink.className = "link-good";
    nameLink.textContent = rawName;
    nameLink.title = "Клик — связать с продуктом справочника";
    nameLink.addEventListener("click", () =>
      openProductLink(g.product_id, rawName, g.good_id || 0,
                      receiptId, itemsRowEl, toggleBtn));
    nameTd.appendChild(nameLink);
    gtr.appendChild(nameTd);

    for (const v of [fmtSum(g.price), g.quantity ?? "", fmtSum(g.sum)]) {
      const c = document.createElement("td");
      c.className = "num";
      c.textContent = v;
      gtr.appendChild(c);
    }
    gbody.appendChild(gtr);
  }

  return td;
}

async function refreshItemsRow(ctx) {
  if (!ctx || !ctx.itemsRowEl || !ctx.itemsRowEl.parentNode) return;
  const { receiptId, itemsRowEl, toggleBtn } = ctx;

  let items = [];
  let errMsg = "";
  try {
    const r = await fetch(`/api/receipts/${receiptId}/items`);
    if (!r.ok) errMsg = `HTTP ${r.status} ${r.statusText}`;
    else { const d = await r.json(); items = d.items || []; }
  } catch (e) { errMsg = e.message; }

  itemsRowEl.innerHTML = "";
  itemsRowEl.appendChild(
    buildItemsRowContent(receiptId, items, errMsg, itemsRowEl, toggleBtn)
  );
}

/* ---------- клики по таблице ---------- */
tbody.addEventListener("click", async (e) => {
  const delBtn = e.target.closest(".del-btn");
  if (delBtn) { await deleteReceipt(delBtn.dataset.id); return; }

  const editBtn = e.target.closest(".edit-btn");
  if (editBtn) { openManual(editBtn.dataset.id); return; }

  const htmlBtn = e.target.closest(".html-btn");
  if (htmlBtn) { openHtml(htmlBtn.dataset.id); return; }

  const qrBtn = e.target.closest(".qr-btn");
  if (qrBtn) {
    const row = qrBtn.closest("tr");
    openRaw(row ? row.dataset.raw || "" : "");
    return;
  }

  const mainRow = e.target.closest("tr.main-row");
  const btn = e.target.closest(".items-btn")
    || (mainRow && mainRow.querySelector(".items-btn"));
  if (!btn) return;

  const id = btn.dataset.id;
  const tr = btn.closest("tr");
  const next = tr.nextElementSibling;
  if (next && next.classList.contains("items-row")) {
    next.remove(); btn.textContent = "▶"; return;
  }

  btn.textContent = "▼";
  let items = []; let errMsg = "";
  try {
    const r = await fetch(`/api/receipts/${id}/items`);
    if (!r.ok) errMsg = `HTTP ${r.status} ${r.statusText}`;
    else { const d = await r.json(); items = d.items || []; }
  } catch (e) { errMsg = e.message; }

  const row = document.createElement("tr");
  row.className = "items-row";
  row.appendChild(buildItemsRowContent(id, items, errMsg, row, btn));
  tr.parentNode.insertBefore(row, tr.nextSibling);
});

/* ---------- сортировка ---------- */
document.querySelectorAll("th[data-sort]").forEach(th => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (state.sort === key) state.order = state.order === "asc" ? "desc" : "asc";
    else { state.sort = key; state.order = (key === "check_at" || key === "sum") ? "desc" : "asc"; }
    state.page = 1; load();
  });
});

/* ---------- фильтр по датам ---------- */
const DATE_STORAGE_KEY = "fns-index";

function saveState() {
  try {
    localStorage.setItem(DATE_STORAGE_KEY, JSON.stringify({
      date_from: state.date_from,
      date_to: state.date_to,
      per_page: state.per_page,
    }));
  } catch (_) {}
}
try {
  const s = JSON.parse(localStorage.getItem(DATE_STORAGE_KEY) || "{}");
  state.date_from = s.date_from || "";
  state.date_to = s.date_to || "";
  state.per_page = s.per_page || 50;
  $("date_from").value = state.date_from;
  $("date_to").value = state.date_to;
  $("per_page").value = String(state.per_page);
} catch (_) {}

const applyDates = () => {
  state.date_from = $("date_from").value || "";
  state.date_to = $("date_to").value || "";
  state.page = 1;
  load();
};
$("date_from").addEventListener("change", applyDates);
$("date_to").addEventListener("change", applyDates);
document.querySelectorAll(".presets button").forEach(b => b.addEventListener("click", () => {
  const p2 = n => String(n).padStart(2, "0");
  const iso = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  $("date_from").value = iso(new Date(Date.now() - Number(b.dataset.days) * 86400000));
  $("date_to").value = iso(new Date());
  applyDates();
}));

/* ---------- кнопки управления ---------- */
$("btn-read").addEventListener("click", readQueue);

$("btn-apply").addEventListener("click", () => {
  state.date_from = $("date_from").value || "";
  state.date_to = $("date_to").value || "";
  state.page = 1; load();
});
$("btn-reset").addEventListener("click", () => {
  $("date_from").value = ""; $("date_to").value = "";
  state.date_from = state.date_to = "";
  state.page = 1; load();
});
$("prev").addEventListener("click", () => { if (state.page > 1) { state.page--; load(); } });
$("next").addEventListener("click", () => { if (state.page < state.pages) { state.page++; load(); } });
$("per_page").addEventListener("change", (e) => {
  state.per_page = parseInt(e.target.value, 10); state.page = 1; load();
});

$("btn-quit").addEventListener("click", async () => {
  if (!confirm("Остановить сервис и закрыть страницу?")) return;
  try {
    await fetch("/api/shutdown", { method: "POST", headers: { "X-Shutdown": "1" } });
  } catch (_) {}
  window.close();
  setTimeout(() => {
    document.body.innerHTML = '<div style="padding:60px 20px;text-align:center;font-size:18px">' +
      'Сервис остановлен. Эту вкладку можно закрыть.</div>';
  }, 300);
});

/* ---------- старт ---------- */
populateGoodsDatalist();
refreshProductsBadge();
refreshLimit();
load();
