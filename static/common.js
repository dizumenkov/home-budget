/* ============================================================
 * common.js — общие функции для страниц приложения
 *   • $ — доступ к элементу по id
 *   • escapeHtml / fmtSum / fmtCheckAt — форматирование
 *   • getCategories / getComparisons / getGoodsList — кэшируемые fetch
 *   • populateGoodsDatalist — заполнение datalist
 *   • showTip / hideTip / scheduleHideTip — всплывающая подсказка
 * ============================================================ */
"use strict";

/* ---------- DOM / форматирование ---------- */
function $(id) { return document.getElementById(id); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function fmtSum(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  return n.toFixed(2);
}
function fmtCheckAt(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const p2 = (n) => String(n).padStart(2, "0");
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ` +
         `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/* ---------- кэши данных ---------- */
const _categoriesCache = { data: null, promise: null };
const _comparisonsCache = new Map();
let _goodsListCache = null;

async function getCategories() {
  if (_categoriesCache.data) return _categoriesCache.data;
  if (!_categoriesCache.promise) {
    _categoriesCache.promise = fetch("/api/categories")
      .then(r => r.json())
      .then(d => { _categoriesCache.data = d.items || []; return _categoriesCache.data; })
      .catch(() => { _categoriesCache.promise = null; return []; });
  }
  return _categoriesCache.promise;
}
async function getComparisons(goodId) {
  if (_comparisonsCache.has(goodId)) return _comparisonsCache.get(goodId);
  const r = await fetch(`/api/goods/${goodId}/comparisons`);
  const d = await r.json();
  const map = {};
  for (const c of (d.items || [])) map[c.category_id] = c.metka_name;
  _comparisonsCache.set(goodId, map);
  return map;
}
async function getGoodsList() {
  if (_goodsListCache) return _goodsListCache;
  try {
    const r = await fetch("/api/goods");
    const d = await r.json();
    _goodsListCache = d.items || [];
  } catch (_) {
    _goodsListCache = [];
  }
  return _goodsListCache;
}
async function populateGoodsDatalist(datalistId) {
  datalistId = datalistId || "goods-datalist";
  const goods = await getGoodsList();
  const dl = document.getElementById(datalistId);
  if (!dl) return;
  dl.innerHTML = "";
  for (const g of goods) {
    const o = document.createElement("option");
    o.value = g.name;
    dl.appendChild(o);
  }
}

/* ---------- всплывающая подсказка ---------- */
let _tipEl = null;
let _tipHideTimer = null;

function _ensureTip() {
  if (!_tipEl) {
    _tipEl = document.createElement("div");
    _tipEl.className = "good-tip";
    _tipEl.hidden = true;
    document.body.appendChild(_tipEl);
  }
  return _tipEl;
}
function _positionTip(el, anchor) {
  const r = anchor.getBoundingClientRect();
  const tr = el.getBoundingClientRect();
  let top = r.bottom + 6;
  let left = r.left;
  if (left + tr.width > window.innerWidth - 8) left = window.innerWidth - tr.width - 8;
  if (left < 8) left = 8;
  if (top + tr.height > window.innerHeight - 8) top = r.top - tr.height - 6;
  if (top < 8) top = 8;
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}
function hideTip() {
  if (_tipHideTimer) { clearTimeout(_tipHideTimer); _tipHideTimer = null; }
  if (_tipEl) _tipEl.hidden = true;
}
function scheduleHideTip() {
  if (_tipHideTimer) clearTimeout(_tipHideTimer);
  _tipHideTimer = setTimeout(() => { if (_tipEl) _tipEl.hidden = true; }, 80);
}
async function showTip(goodId, goodName, anchor) {
  if (_tipHideTimer) { clearTimeout(_tipHideTimer); _tipHideTimer = null; }
  const el = _ensureTip();
  el.hidden = false;
  el.innerHTML = `<div class="tip-title">${escapeHtml(goodName || "")}</div>
                  <div class="empty-tip">Загрузка…</div>`;
  _positionTip(el, anchor);
  try {
    const [cats, chosen] = await Promise.all([
      getCategories(),
      getComparisons(goodId),
    ]);
    if (!cats.length) {
      el.innerHTML = `<div class="tip-title">${escapeHtml(goodName || "")}</div>
                      <div class="empty-tip">Категории не заданы</div>`;
    } else {
      const rows = cats.map(c => {
        const m = chosen[c.id];
        const val = m ? escapeHtml(m) : `<span class="none">— не задано —</span>`;
        return `<div class="row"><span class="cat">${escapeHtml(c.name)}:</span><span class="val">${val}</span></div>`;
      }).join("");
      el.innerHTML = `<div class="tip-title">${escapeHtml(goodName || "")}</div>${rows}`;
    }
    _positionTip(el, anchor);
  } catch (e) {
    el.innerHTML = `<div class="tip-title">${escapeHtml(goodName || "")}</div>
                    <div class="empty-tip">Ошибка загрузки</div>`;
  }
}

window.addEventListener("scroll", hideTip, true);
window.addEventListener("resize", hideTip);

/* ============================================================
 * Расширение common.js — общие утилиты страниц
 * ============================================================ */

/* ---------- форматирование ---------- */
function fmtMoney(v) {
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  return n.toLocaleString("ru-RU",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
}
function fmtPercent(v) {
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  return n.toFixed(1).replace(".", ",") + " %";
}
function fmtSignedMoney(v) {
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  if (n === 0) return "0,00 ₽";
  const arrow = n > 0 ? "▲" : "▼";
  const sign = n > 0 ? "+" : "−";
  return `${arrow} ${sign}${Math.abs(n).toLocaleString("ru-RU",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}
function fmtSignedPct(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!isFinite(n)) return "—";
  if (n === 0) return "0,0 %";
  const arrow = n > 0 ? "▲" : "▼";
  const sign = n > 0 ? "+" : "−";
  return `${arrow} ${sign}${Math.abs(n).toFixed(1).replace(".", ",")} %`;
}
function deltaClass(v) {
  if (v === null || v === undefined) return "delta-none";
  if (v > 0) return "delta-up";
  if (v < 0) return "delta-down";
  return "delta-none";
}

/* ---------- работа с датами ---------- */
function toIso(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function isoToday() { return toIso(new Date()); }
function isoAddDays(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toIso(d);
}

/* ---------- инициализация модалки на странице ----------
   Ожидает в HTML: #modal[hidden], #modal-backdrop, #modal-close, #modal-frame.
   Страница может определить хуки:
     window.onModalClosed(mode)
     window.onManualRefresh()
     window.onProductsChanged()
------------------------------------------------------------- */
function initModalBase() {
  const close = document.getElementById("modal-close");
  const backdrop = document.getElementById("modal-backdrop");
  const modalEl = () => document.getElementById("modal");
  const frameEl = () => document.getElementById("modal-frame");
  if (!modalEl()) return;

  let _modalMode = null;

  window.openModalUrl = function(src, mode, title) {
    hideTip();
    _modalMode = mode;
    const f = frameEl();
    f.removeAttribute("srcdoc");
    f.title = title || "";
    f.src = src;
    modalEl().hidden = false;
    document.body.style.overflow = "hidden";
  };
  window.openModalSrcdoc = function(html, mode, title) {
    hideTip();
    _modalMode = mode;
    const f = frameEl();
    f.title = title || "";
    f.removeAttribute("src");
    f.srcdoc = html;
    modalEl().hidden = false;
    document.body.style.overflow = "hidden";
  };
  window.closeModal = function() {
    const mode = _modalMode;
    modalEl().hidden = true;
    const f = frameEl();
    f.removeAttribute("srcdoc");
    f.src = "about:blank";
    document.body.style.overflow = "";
    _modalMode = null;
    if (typeof window.onModalClosed === "function") window.onModalClosed(mode);
  };

  if (close) close.addEventListener("click", window.closeModal);
  if (backdrop) backdrop.addEventListener("click", window.closeModal);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalEl().hidden) {
      window.closeModal();
      e.stopPropagation();
    }
  });

  window.addEventListener("message", (e) => {
    const d = e.data || {};
    if (d.type === "close-comparison") window.closeModal();
    else if (d.type === "close-manual") {
      window.closeModal();
      if (d.refresh && typeof window.onManualRefresh === "function") window.onManualRefresh();
    }
    else if (d.type === "products-changed"
             && typeof window.onProductsChanged === "function") {
      window.onProductsChanged();
    }
  });
}
