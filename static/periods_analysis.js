/* periods_analysis.js — логика страницы «Анализ по периодам» */
"use strict";

const PALETTE = [
  "#4e79a7","#f28e2b","#e15759","#76b7b2","#59a14f",
  "#edc948","#b07aa1","#ff9da7","#9c755f","#bab0ac",
  "#8c6d31","#6b9bd1","#a05195","#d45087","#f95d6a"
];
const COLOR_UNSET = "#9aa0a6";
const COLOR_NO_GOOD = "#5c636b";

const INTERVAL_NAMES = {
  day: "день", week: "неделя", month: "месяц",
  quarter: "квартал", year: "год",
};

const state = {
  data: null,
  collapsed: new Set(),
  chart: null,
};

function colorFor(key, idx) {
  if (key === "unset") return COLOR_UNSET;
  if (key === "no_good") return COLOR_NO_GOOD;
  return PALETTE[idx % PALETTE.length];
}

/* фон по уровню иерархии — копия из analysis */
function depthBg(depth) {
  const d = Math.max(1, depth);
  const hue = Math.max(10, 48 - (d - 1) * 5);
  const sat = Math.min(100, 90 + (d - 1) * 2);
  const light = Math.max(45, 82 - (d - 1) * 7);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

function fmtNumber(v) {
  const n = Number(v);
  if (!isFinite(n) || n === 0) return "";
  return n.toLocaleString("ru-RU",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* «ср. X» — третья строка блока суммы: сумма / число интервалов (нулевые тоже считаются) */
function pctHtml(v, base) {
  if (!v || !base || base <= 0) return "";
  const pct = (Number(v) / Number(base)) * 100;
  return `<span class="pct">${pct.toFixed(1).replace(".", ",")} %</span>`;
}

function avgHtml(total, intervalsCount) {
  if (!intervalsCount) return "";
  const avg = fmtNumber(Number(total) / intervalsCount) || "0,00";
  return `<span class="pct" title="Сумма по строке / количество интервалов (${intervalsCount})">ср. ${avg}</span>`;
}

function analysisUrlForInterval(idx) {
  const d = state.data;
  if (!d || !d.intervals[idx]) return "/analysis";
  const iv = d.intervals[idx];
  const p = new URLSearchParams({
    category_id: d.category.id,
    date_from: iv.start || d.period.from,
    date_to:   iv.end   || d.period.to,
  });
  return "/analysis?" + p.toString();
}

function fmtNumberWithPct(v, base) {
  if (!v) return "";
  const sum = fmtNumber(v);
  if (!base || base <= 0) return sum;
  const pct = (Number(v) / Number(base)) * 100;
  const pctStr = pct.toFixed(1).replace(".", ",") + " %";
  return `${sum}<br><span class="pct">${pctStr}</span>`;
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
    o.value = c.id;
    o.textContent = c.name;
    sel.appendChild(o);
  }
  if (prev) sel.value = prev;
}

/* ---------- построение ---------- */
async function build() {
  const cat = $("category").value;
  const df = $("date_from").value;
  const dt = $("date_to").value;
  const interval = $("interval").value;

  if (!cat) { setStatus("Выберите категорию", "err"); return; }
  if (!df || !dt) { setStatus("Укажите период", "err"); return; }

  setStatus("Загрузка…");
  $("btn-build").disabled = true;
  try {
    const p = new URLSearchParams({
      category_id: cat, date_from: df, date_to: dt, interval: interval,
    });
    const r = await fetch("/api/analysis/periods?" + p.toString());
    const d = await r.json();
    if (!r.ok) { setStatus("Ошибка: " + (d.error || r.status), "err"); return; }

    state.data = d;
    state.collapsed = new Set();

    // сворачиваем все папки — при построении видны только строки 1-го уровня
    (function collapseAll(nodes) {
      for (const n of nodes) {
        if (n.is_folder) {
          state.collapsed.add(n.id);
          collapseAll(n.children || []);
        }
      }
    })(d.items);

    $("cat-name").textContent = d.category.name;
    $("period-range").textContent = `${d.period.from} — ${d.period.to}`;
    $("interval-name").textContent = INTERVAL_NAMES[d.interval] || d.interval;
    $("grand-total").textContent = fmtMoney(d.grand_total);

    $("result-card").hidden = false;
    renderTable();

    let msg = `Столбцов: ${d.intervals.length}`;
    if (d.intervals.length > 60) {
      msg += " · это много, используйте горизонтальный скролл";
    }
    setStatus(msg);
  } catch (e) {
    setStatus("Ошибка: " + e.message, "err");
  } finally {
    $("btn-build").disabled = false;
  }
}

function setStatus(m, kind) {
  const el = $("status");
  el.textContent = m || "";
  el.className = kind || "";
}

/* ---------- рендер таблицы ---------- */
function renderTable() {
  const d = state.data;
  const intervals = d.intervals;
  const M = intervals.length;

  const thead = $("thead");
  thead.innerHTML = "";
  const trh = document.createElement("tr");

  const thName = document.createElement("th");
  thName.textContent = "Метка";
  trh.appendChild(thName);

  for (let i = 0; i < M; i++) {
    const iv = intervals[i];
    const th = document.createElement("th");
    th.className = "num";

    const a = document.createElement("a");
    a.href = analysisUrlForInterval(i);
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = iv.label;
    a.className = "interval-link";
    a.title = "Открыть анализ по этому интервалу";
    th.appendChild(a);

    trh.appendChild(th);
  }
  const thTotal = document.createElement("th");
  thTotal.className = "num total-col";
  thTotal.textContent = "Итого";
  trh.appendChild(thTotal);
  thead.appendChild(trh);

  const tbody = $("tbody");
  tbody.innerHTML = "";

  // colorIdx по индексу top-level родителя
  function renderNode(node, depth, colorIdx) {
    const tr = document.createElement("tr");
    const isAccent = (node.kind === "unset" || node.kind === "no_good");
    if (isAccent) tr.classList.add("row-accent");

    // первая ячейка
    const tdName = document.createElement("td");
    tdName.style.paddingLeft = `${10 + depth * 20}px`;

    if (node.is_folder) {
      const tg = document.createElement("span");
      tg.className = "toggle";
      tg.textContent = state.collapsed.has(node.id) ? "▶" : "▼";
      tg.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.collapsed.has(node.id)) state.collapsed.delete(node.id);
        else state.collapsed.add(node.id);
        renderTable();
      });
      tdName.appendChild(tg);
    } else if (depth > 0) {
      const sp = document.createElement("span");
      sp.className = "toggle";
      sp.style.visibility = "hidden";
      sp.textContent = "·";
      tdName.appendChild(sp);
    }

    // swatch — как в analysis
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = colorFor(node.kind, colorIdx);
    tdName.appendChild(sw);

    const nm = document.createElement("span");
    nm.textContent = node.name;
    if (node.is_folder) nm.className = "folder-name";
    tdName.appendChild(nm);
    tr.appendChild(tdName);

    // значения (с процентом от итога интервала)
    for (let i = 0; i < M; i++) {
      const td = document.createElement("td");
      td.className = "num";
      td.innerHTML = fmtNumberWithPct(node.values[i], d.totals[i]);
      tr.appendChild(td);
    }

    // Итого
    const tdTotal = document.createElement("td");
    tdTotal.className = "num total-col";
    const link = document.createElement("span");
    link.className = "total-link";
    link.textContent = fmtNumber(node.total) || "0,00";
    link.title = "Показать диаграмму по строке";
    link.addEventListener("click", (e) => {
      e.stopPropagation();
      openRowChart(node);
    });
    tdTotal.appendChild(link);
    tdTotal.insertAdjacentHTML("beforeend", pctHtml(node.total, d.grand_total) + avgHtml(node.total, M));
    tr.appendChild(tdTotal);

    // фон по уровню — как в analysis
    if (depth > 0) {
      const bg = depthBg(depth);
      Array.from(tr.children).forEach(td => {
        if (!td.classList.contains("total-col")) td.style.background = bg;
      });
    }

    tbody.appendChild(tr);

    if (node.is_folder && !state.collapsed.has(node.id)) {
      for (const child of node.children) renderNode(child, depth + 1, colorIdx);
    }
  }

  d.items.forEach((it, i) => renderNode(it, 0, i));

  // Итоговая строка
  const trT = document.createElement("tr");
  trT.className = "total-row";
  const tdT = document.createElement("td");
  tdT.textContent = "Всего";
  trT.appendChild(tdT);
  for (let i = 0; i < M; i++) {
    const td = document.createElement("td");
    td.className = "num";
    td.innerHTML = fmtNumberWithPct(d.totals[i], d.grand_total);
    trT.appendChild(td);
  }
  const tdG = document.createElement("td");
  tdG.className = "num total-col";
  tdG.innerHTML = (fmtNumber(d.grand_total) || "0,00") + avgHtml(d.grand_total, M);
  trT.appendChild(tdG);
  tbody.appendChild(trT);
}

/* ---------- модалка с диаграммой ---------- */
function openRowChart(node) {
  const d = state.data;
  const labels = d.intervals.map(iv => iv.label);
  const values = node.values;

  $("rc-title").textContent = node.name + " — " +
    (INTERVAL_NAMES[d.interval] || d.interval) +
    " (" + d.period.from + " … " + d.period.to + ")";

  $("rc-modal").hidden = false;
  document.body.style.overflow = "hidden";

  if (state.chart) { state.chart.destroy(); state.chart = null; }

  const ctx = $("rc-chart").getContext("2d");
  state.chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: node.name,
        data: values,
        backgroundColor: "#4e79a7",
        borderWidth: 0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => fmtMoney(c.parsed.y) } }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => Number(v).toLocaleString("ru-RU") }
        },
        x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 0 } }
      }
    }
  });
}

function closeRowChart() {
  $("rc-modal").hidden = true;
  document.body.style.overflow = "";
  if (state.chart) { state.chart.destroy(); state.chart = null; }
}

/* ---------- инициализация ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  $("btn-build").addEventListener("click", build);
  $("rc-close").addEventListener("click", closeRowChart);
  $("rc-backdrop").addEventListener("click", closeRowChart);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("rc-modal").hidden) {
      closeRowChart();
      e.stopPropagation();
    }
  });

  const y = new Date().getFullYear();
  $("date_from").value = `${y}-01-01`;
  $("date_to").value = `${y}-12-31`;

  await loadCategories();
});