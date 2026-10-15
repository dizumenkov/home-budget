/* analysis.js — логика страницы «Анализ» */
"use strict";

const PALETTE = [
  "#4e79a7","#f28e2b","#e15759","#76b7b2","#59a14f",
  "#edc948","#b07aa1","#ff9da7","#9c755f","#bab0ac",
  "#8c6d31","#6b9bd1","#a05195","#d45087","#f95d6a"
];
const COLOR_UNSET = "#9aa0a6";
const COLOR_NO_GOOD = "#5c636b";

const PctMode = { TOTAL: "total", GROUP: "group" };

const state = {
  chart: null,
  data: null,
  filter: { date_from: "", date_to: "", category_id: "" },
  pctMode: PctMode.TOTAL,
};

function colorFor(key, idx) {
  if (key === "unset") return COLOR_UNSET;
  if (key === "no_good") return COLOR_NO_GOOD;
  return PALETTE[idx % PALETTE.length];
}
function depthBg(depth) {
  const d = Math.max(1, depth);
  const hue = Math.max(10, 48 - (d - 1) * 5);
  const sat = Math.min(100, 90 + (d - 1) * 2);
  const light = Math.max(45, 82 - (d - 1) * 7);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

/* расчет процента по выбранному режиму */
function computePercent(it) {
  if (state.pctMode === PctMode.TOTAL) {
    const base = (state.data && state.data.total_sum) || 0;
    return base > 0 ? (Number(it.sum) / base * 100) : 0;
  }
  // "от группы" — сервер уже посчитал percent относительно родителя
  return Number(it.percent) || 0;
}

/* ---------- treemap ---------- */
function computeTreemap(items, x, y, w, h, out) {
  if (!items.length) return;
  if (items.length === 1) { out.push({ item: items[0], x, y, w, h }); return; }
  const total = items.reduce((s, it) => s + it.sum, 0);
  if (total <= 0) return;
  const half = total / 2;
  let acc = 0, splitIdx = 0;
  for (let i = 0; i < items.length; i++) {
    acc += items[i].sum;
    if (acc >= half) { splitIdx = i + 1; break; }
  }
  if (splitIdx <= 0) splitIdx = 1;
  if (splitIdx >= items.length) splitIdx = items.length - 1;
  const first = items.slice(0, splitIdx);
  const second = items.slice(splitIdx);
  const ratio = first.reduce((s, it) => s + it.sum, 0) / total;
  if (w >= h) {
    const w1 = w * ratio;
    computeTreemap(first, x, y, w1, h, out);
    computeTreemap(second, x + w1, y, w - w1, h, out);
  } else {
    const h1 = h * ratio;
    computeTreemap(first, x, y, w, h1, out);
    computeTreemap(second, x, y + h1, w, h - h1, out);
  }
}
function truncateText(s, n) {
  s = s || "";
  if (n < 4) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
function renderTreemapSvg(items) {
  const svgWrap = $("chart-svg");
  svgWrap.innerHTML = "";
  const W = svgWrap.clientWidth || 800;
  const H = svgWrap.clientHeight || 420;
  if (!items.length || W <= 0 || H <= 0) return;

  const colorMap = new Map();
  items.forEach((it, i) => colorMap.set(it.key, colorFor(it.key, i)));

  const sorted = items.slice().sort((a, b) => b.sum - a.sum);
  const rects = [];
  computeTreemap(sorted, 0, 0, W, H, rects);

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  const tip = $("svg-tip");

  for (const r of rects) {
    if (r.w < 2 || r.h < 2) continue;
    const g = document.createElementNS(ns, "g");
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", r.x + 1);
    rect.setAttribute("y", r.y + 1);
    rect.setAttribute("width", Math.max(0, r.w - 2));
    rect.setAttribute("height", Math.max(0, r.h - 2));
    rect.setAttribute("fill", colorMap.get(r.item.key) || "#cccccc");
    rect.setAttribute("rx", 3);
    rect.setAttribute("ry", 3);
    rect.setAttribute("class", "treemap-rect" +
      (r.item.key === "no_good" ? " no-action" : ""));

    if (r.item.key !== "no_good") {
      rect.addEventListener("click", () => {
        if (r.item.key === "unset") openGoodsList("unset", null, "— не задано —");
        else if (r.item.key.startsWith("metka:"))
          openGoodsList("metka", r.item.metka_id, r.item.name);
      });
    }
    rect.addEventListener("mousemove", (e) => {
      const wr = svgWrap.getBoundingClientRect();
      tip.hidden = false;
      tip.textContent = `${r.item.name}: ${fmtMoney(r.item.sum)} · ${fmtPercent(r.item.percent)}`;
      tip.style.left = (e.clientX - wr.left) + "px";
      tip.style.top = (e.clientY - wr.top) + "px";
    });
    rect.addEventListener("mouseleave", () => { tip.hidden = true; });
    g.appendChild(rect);

    const showName = r.w > 60 && r.h > 28;
    const showPct = r.w > 42 && r.h > 16;
    if (showName) {
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", r.x + r.w / 2);
      t.setAttribute("y", r.y + r.h / 2 - (showPct ? 6 : 0));
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("dominant-baseline", "middle");
      t.setAttribute("font-size", "12");
      t.setAttribute("font-weight", "600");
      t.setAttribute("fill", "#1f2328");
      t.setAttribute("pointer-events", "none");
      t.textContent = truncateText(r.item.name, Math.floor(r.w / 7));
      g.appendChild(t);
    }
    if (showPct) {
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", r.x + r.w / 2);
      t.setAttribute("y", r.y + r.h / 2 + (showName ? 8 : 0));
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("dominant-baseline", "middle");
      t.setAttribute("font-size", "10");
      t.setAttribute("fill", "#3a4148");
      t.setAttribute("pointer-events", "none");
      t.textContent = fmtPercent(r.item.percent);
      g.appendChild(t);
    }
    svg.appendChild(g);
  }
  svgWrap.appendChild(svg);
}

/* ---------- модалка со списком товаров ---------- */
function openModalList() {
  const modal = $("modal");
  const list = $("modal-list");
  const frame = $("modal-frame");
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  list.hidden = false;
  frame.hidden = true;
  frame.src = "about:blank";
}
function backToList() {
  const list = $("modal-list");
  const frame = $("modal-frame");
  frame.src = "about:blank";
  frame.hidden = true;
  list.hidden = false;
}
function showComparisonInModal(goodId) {
  const list = $("modal-list");
  const frame = $("modal-frame");
  list.hidden = true;
  frame.hidden = false;
  frame.src = `/comparison?good_id=${goodId}&embedded=1&back=1`;
}
async function openGoodsList(kind, metkaId, title) {
  openModalList();
  $("modal-list-title").textContent = title;
  $("modal-list-sub").textContent = "Загрузка…";
  const items = $("modal-list-items");
  items.innerHTML = "";

  const p = new URLSearchParams({
    kind: kind,
    date_from: state.filter.date_from,
    date_to: state.filter.date_to,
    category_id: state.filter.category_id,
  });
  if (metkaId != null) p.set("metka_id", String(metkaId));

  try {
    const r = await fetch("/api/analysis/details?" + p.toString());
    const d = await r.json();
    if (!r.ok) { $("modal-list-sub").textContent = "Ошибка: " + (d.error || r.status); return; }
    if (!d.items.length) {
      $("modal-list-sub").textContent = "Нет товаров";
      const li = document.createElement("li");
      li.className = "modal-list-empty";
      li.textContent = "За выбранный период товаров нет";
      items.appendChild(li);
      return;
    }
    const more = d.total > d.items.length
      ? ` · показаны первые ${d.items.length} из ${d.total}` : "";
    $("modal-list-sub").textContent = `Товаров: ${d.total}${more}`;
    for (const it of d.items) {
      const li = document.createElement("li");
      li.textContent = it.name;
      li.addEventListener("click", () => showComparisonInModal(it.good_id));
      items.appendChild(li);
    }
  } catch (e) {
    $("modal-list-sub").textContent = "Ошибка: " + e.message;
  }
}

/* ---------- категории ---------- */
async function loadCategories() {
  const r = await fetch("/api/categories");
  const d = await r.json();
  const sel = $("category");
  const prev = sel.value;
  sel.innerHTML = `<option value="">— выберите —</option>`;
  for (const c of (d.items || [])) {
    const o = document.createElement("option");
    o.value = c.id; o.textContent = c.name;
    sel.appendChild(o);
  }
  if (prev) sel.value = prev;
}

/* ---------- сборка ---------- */
async function build() {
  const df = $("date_from").value, dt = $("date_to").value;
  const cat = $("category").value;
  const includeUnset = $("include_unset").checked ? "1" : "0";
  if (!df || !dt) { $("status").textContent = "Укажите обе даты"; return; }
  if (!cat) { $("status").textContent = "Выберите категорию"; return; }

  $("status").textContent = "Загрузка…";
  $("btn-build").disabled = true;
  try {
    const p = new URLSearchParams({
      date_from: df, date_to: dt,
      category_id: cat, include_unset: includeUnset,
    });
    const r = await fetch("/api/analysis?" + p.toString());
    const d = await r.json();
    if (!r.ok) { $("status").textContent = "Ошибка: " + (d.error || r.status); return; }
    state.data = d;
    state.filter = { date_from: df, date_to: dt, category_id: cat };
    render(d);
    $("status").textContent = d.items.length
      ? `Секторов: ${d.items.length} · всего: ${fmtMoney(d.total_sum)}`
      : "Нет размеченных товаров за период";
  } catch (e) {
    $("status").textContent = "Ошибка: " + e.message;
  } finally {
    $("btn-build").disabled = false;
  }
}

function render(d) {
  $("result-card").hidden = false;
  $("table-card").hidden = false;
  $("cat-name").textContent = d.category.name;
  $("total-sum").textContent = fmtMoney(d.total_sum);
  renderChart(d);
  renderTable(d);
}

function renderChart(d) {
  const type = $("chart_type").value;
  const wrap = $("chart-wrap"), svgWrap = $("chart-svg"),
        tip = $("svg-tip"), canvas = $("chart");

  if (type === "none") {
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    wrap.hidden = true; $("chart-empty").hidden = true; tip.hidden = true;
    return;
  }
  wrap.hidden = false;
  const isEmpty = d.items.length === 0;
  $("chart-empty").hidden = !isEmpty;
  if (isEmpty) {
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    canvas.style.display = "none"; svgWrap.hidden = true; svgWrap.innerHTML = "";
    tip.hidden = true; return;
  }
  if (type === "treemap") {
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    canvas.style.display = "none"; svgWrap.hidden = false;
    renderTreemapSvg(d.items); return;
  }
  canvas.style.display = ""; svgWrap.hidden = true; svgWrap.innerHTML = "";
  tip.hidden = true;
  if (state.chart) { state.chart.destroy(); state.chart = null; }

  const labels = d.items.map(x => x.name);
  const values = d.items.map(x => x.sum);
  const colors = d.items.map((x, i) => colorFor(x.key, i));
  const isBar = type === "bar";
  state.chart = new Chart(canvas.getContext("2d"), {
    type: type,
    data: { labels, datasets: [{ data: values, backgroundColor: colors,
      borderColor: "#ffffff", borderWidth: isBar ? 0 : 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: !isBar, position: "right" },
        tooltip: { callbacks: { label: (c) => {
          const it = d.items[c.dataIndex];
          return `${it.name}: ${fmtMoney(it.sum)} · ${fmtPercent(it.percent)}`;
        } } }
      },
      scales: isBar ? {
        y: { beginAtZero: true,
          ticks: { callback: v => Number(v).toLocaleString("ru-RU") } },
        x: { ticks: { autoSkip: false, maxRotation: 45, minRotation: 0 } }
      } : {}
    }
  });
}

function buildRow(it, idx, depth) {
  const tr = document.createElement("tr");
  tr.dataset.depth = String(depth);

  const isFolder = it.is_folder && it.key.startsWith("metka:");
  const isLeafMetka = !isFolder && it.key.startsWith("metka:");
  const isUnset = it.key === "unset";
  const isNoGood = it.key === "no_good";
  const isAccent = isUnset || isNoGood;

  const color = colorFor(it.key, idx);
  const indent = depth > 0 ? depth * 20 : 0;

  const td = document.createElement("td");
  td.style.paddingLeft = `${10 + indent}px`;
  if (isFolder) {
    const tg = document.createElement("span");
    tg.className = "expander-toggle";
    tg.textContent = "▶";
    td.appendChild(tg);
  } else if (depth > 0) {
    const sp = document.createElement("span");
    sp.className = "expander-toggle";
    sp.style.visibility = "hidden";
    sp.textContent = "·";
    td.appendChild(sp);
  }
  const sw = document.createElement("span");
  sw.className = "swatch";
  sw.style.background = color;
  td.appendChild(sw);
  const nm = document.createElement("span");
  nm.textContent = it.name;
  if (isFolder) nm.className = "folder-name";
  td.appendChild(nm);
  tr.appendChild(td);

  const sumTd = document.createElement("td");
  sumTd.className = "num"; sumTd.textContent = fmtMoney(it.sum);
  tr.appendChild(sumTd);

  const pctTd = document.createElement("td");
  pctTd.className = "num";
  pctTd.textContent = fmtPercent(computePercent(it));
  tr.appendChild(pctTd);

  const posTd = document.createElement("td");
  posTd.className = "num"; posTd.textContent = it.items_count;
  tr.appendChild(posTd);
  const rcpTd = document.createElement("td");
  rcpTd.className = "num"; rcpTd.textContent = it.receipts_count;
  tr.appendChild(rcpTd);

  if (depth > 0) {
    const bg = depthBg(depth);
    Array.from(tr.children).forEach(c => { c.style.background = bg; });
  }
  if (isAccent) tr.classList.add("row-accent");

  if (isFolder) {
    const tg = td.querySelector(".expander-toggle");
    tg.addEventListener("click", (e) => {
      e.stopPropagation(); toggleFolderRow(tr, it, depth);
    });
    tr.classList.add("clickable");
    tr.title = "Клик по ▶ — раскрыть расшифровку; клик по строке — список товаров";
    tr.addEventListener("click", () => openGoodsList("metka", it.metka_id, it.name));
  } else if (isLeafMetka || isUnset) {
    tr.classList.add("clickable");
    tr.title = "Показать товары";
    tr.addEventListener("click", () => {
      if (isUnset) openGoodsList("unset", null, "— не задано —");
      else openGoodsList("metka", it.metka_id, it.name);
    });
  }

  return tr;
}

async function toggleFolderRow(tr, it, depth) {
  const tg = tr.querySelector(".expander-toggle");
  if (tr.dataset.expanded === "1") {
    let next = tr.nextSibling;
    while (next && next.dataset && Number(next.dataset.depth) > depth) {
      const rm = next; next = next.nextSibling; rm.remove();
    }
    tr.dataset.expanded = ""; tg.textContent = "▶"; return;
  }
  tg.textContent = "▼";
  tr.dataset.expanded = "1";
  const p = new URLSearchParams({
    date_from: state.filter.date_from, date_to: state.filter.date_to,
    category_id: state.filter.category_id, folder_id: it.metka_id,
  });
  try {
    const r = await fetch("/api/analysis/expand?" + p.toString());
    const d = await r.json();
    if (!r.ok) {
      $("status").textContent = "Ошибка: " + (d.error || r.status);
      tg.textContent = "▶"; tr.dataset.expanded = ""; return;
    }
    let insertAfter = tr;
    if (!d.items.length) {
      const etr = document.createElement("tr");
      etr.dataset.depth = String(depth + 1);
      const etd = document.createElement("td");
      etd.colSpan = 5;
      etd.className = "empty";
      etd.style.paddingLeft = `${30 + (depth + 1) * 20}px`;
      etd.textContent = "нет данных по вложенным";
      etd.style.background = depthBg(depth + 1);
      etr.appendChild(etd);
      tr.parentNode.insertBefore(etr, insertAfter.nextSibling);
      return;
    }
    d.items.forEach((child, i) => {
      const sub = buildRow(child, i, depth + 1);
      tr.parentNode.insertBefore(sub, insertAfter.nextSibling);
      insertAfter = sub;
    });
  } catch (e) {
    $("status").textContent = "Ошибка: " + e.message;
    tg.textContent = "▶"; tr.dataset.expanded = "";
  }
}

function renderTable(d) {
  const tb = $("tbody");
  tb.innerHTML = "";
  if (!d.items.length) {
    const tr = document.createElement("tr");
    const msg = d.include_unset === false ? "Все товары неразмечены" : "Нет данных";
    tr.innerHTML = `<td colspan="5" class="empty">${msg}</td>`;
    tb.appendChild(tr); return;
  }
  d.items.forEach((it, i) => tb.appendChild(buildRow(it, i, 0)));
}

/* ---------- инициализация ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  initModalBase();

  $("modal-close").addEventListener("click", () => {
    if ($("modal-frame").hidden === false) backToList();
    else window.closeModal();
  });
  $("modal-backdrop").addEventListener("click", () => window.closeModal());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("modal").hidden) {
      if (!$("modal-frame").hidden) backToList();
      else window.closeModal();
      e.stopPropagation();
    }
  });
  window.addEventListener("message", (e) => {
    const d = e.data || {};
    if (d.type === "close-comparison" || d.type === "back-to-list") backToList();
  });

  $("btn-build").addEventListener("click", build);

  $("include_unset").addEventListener("change", () => {
    if (state.filter.category_id) build();
  });

  $("chart_type").addEventListener("change", () => {
    try { localStorage.setItem("fns-analysis-chart-type", $("chart_type").value); } catch (_) {}
    if (state.data) renderChart(state.data);
  });

  // режим расчета процента — сохранение + перерисовка таблицы
  $("pct_mode").addEventListener("change", () => {
    state.pctMode = $("pct_mode").value === PctMode.GROUP ? PctMode.GROUP : PctMode.TOTAL;
    try { localStorage.setItem("fns-analysis-pct-mode", state.pctMode); } catch (_) {}
    if (state.data) renderTable(state.data);
  });

  let _rt = null;
  window.addEventListener("resize", () => {
    if ($("chart_type").value !== "treemap") return;
    if (!state.data || !state.data.items.length) return;
    clearTimeout(_rt);
    _rt = setTimeout(() => renderChart(state.data), 150);
  });

  // дефолтные даты — последние 30 дней
  const today = new Date();
  const past = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  $("date_to").value = toIso(today);
  $("date_from").value = toIso(past);

  // тип диаграммы из localStorage
  const savedChart = localStorage.getItem("fns-analysis-chart-type");
  if (savedChart && ["none","doughnut","bar","treemap"].includes(savedChart)) {
    $("chart_type").value = savedChart;
  }

  // режим расчета процента из localStorage
  const savedPct = localStorage.getItem("fns-analysis-pct-mode");
  if (savedPct === PctMode.GROUP || savedPct === PctMode.TOTAL) {
    state.pctMode = savedPct;
    $("pct_mode").value = savedPct;
  }

  // параметры из URL
  const urlParams = new URLSearchParams(location.search);
  const urlCat = urlParams.get("category_id");
  const urlFrom = urlParams.get("date_from");
  const urlTo = urlParams.get("date_to");
  const hasUrlParams = !!(urlCat && urlFrom && urlTo);

  if (urlFrom) $("date_from").value = urlFrom;
  if (urlTo) $("date_to").value = urlTo;

  await loadCategories();

  if (hasUrlParams) {
    $("category").value = urlCat;
    if ($("category").value === urlCat) {
      await build();
    } else {
      $("status").textContent = `Категория #${urlCat} не найдена`;
    }
  }
});