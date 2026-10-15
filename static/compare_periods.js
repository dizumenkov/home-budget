"use strict";

/* compare_periods.js — логика страницы (авто-экстракция) */

"use strict";

const state = { chart: null, data: null };

const COLOR_P1 = "#4e79a7";
const COLOR_P2 = "#f28e2b";
const COLOR_UNSET = "#9aa0a6";
const COLOR_NO_GOOD = "#5c636b";

function fmtMoney(v) {
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  return n.toLocaleString("ru-RU",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
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

// ---------- работа с датами ----------
function isoAddDays(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function isoToday() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function toIso(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- загрузка категорий ----------
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

// ---------- кнопка «предыдущий период такой же длины» ----------
$("btn-prev").addEventListener("click", () => {
  const f2 = $("p2_from").value;
  const t2 = $("p2_to").value;
  if (!f2 || !t2) { setStatus("Сначала задайте период 2", "err"); return; }
  const d1 = new Date(f2 + "T00:00:00");
  const d2 = new Date(t2 + "T00:00:00");
  if (d2 < d1) { setStatus("Конец периода 2 раньше начала", "err"); return; }
  const len = Math.round((d2 - d1) / 86400000) + 1;   // дней включительно
  $("p1_to").value = isoAddDays(f2, -1);
  $("p1_from").value = isoAddDays(f2, -len);
  setStatus("");
});

// ---------- пресеты периодов ----------
function applyPreset(name) {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();

  if (name === "month") {
    const curFrom = new Date(y, m, 1);
    const curTo = today;
    const prevFrom = new Date(y, m - 1, 1);
    const prevTo = new Date(y, m, 0);          // последний день прошлого месяца
    $("p2_from").value = toIso(curFrom);
    $("p2_to").value   = toIso(curTo);
    $("p1_from").value = toIso(prevFrom);
    $("p1_to").value   = toIso(prevTo);
  } else if (name === "year") {
    const curFrom = new Date(y, 0, 1);
    const curTo = today;
    const prevFrom = new Date(y - 1, 0, 1);
    const maxDay = new Date(y - 1, m + 1, 0).getDate();   // защита от 29 февраля
    const day = Math.min(today.getDate(), maxDay);
    const prevTo = new Date(y - 1, m, day);
    $("p2_from").value = toIso(curFrom);
    $("p2_to").value   = toIso(curTo);
    $("p1_from").value = toIso(prevFrom);
    $("p1_to").value   = toIso(prevTo);
  } else if (name === "last30") {
    const p2To = new Date(today);
    const p2From = new Date(today); p2From.setDate(p2From.getDate() - 29);
    const p1To = new Date(today);   p1To.setDate(p1To.getDate() - 30);
    const p1From = new Date(today); p1From.setDate(p1From.getDate() - 59);
    $("p2_from").value = toIso(p2From);
    $("p2_to").value   = toIso(p2To);
    $("p1_from").value = toIso(p1From);
    $("p1_to").value   = toIso(p1To);
  }
  setStatus("");
}

document.querySelectorAll("[data-preset]").forEach(b => {
  b.addEventListener("click", () => applyPreset(b.dataset.preset));
});

// ---------- построение ----------
function setStatus(m, kind) {
  const el = $("status");
  el.textContent = m || "";
  el.className = kind || "";
}

async function build() {
  const cat = $("category").value;
  const p1f = $("p1_from").value, p1t = $("p1_to").value;
  const p2f = $("p2_from").value, p2t = $("p2_to").value;
  const includeUnset = $("include_unset").checked ? "1" : "0";

  if (!cat) { setStatus("Выберите категорию", "err"); return; }
  if (!p1f || !p1t) { setStatus("Заполните период 1", "err"); return; }
  if (!p2f || !p2t) { setStatus("Заполните период 2", "err"); return; }

  setStatus("Загрузка…");
  $("btn-build").disabled = true;
  try {
    const p = new URLSearchParams({
      category_id: cat,
      p1_from: p1f, p1_to: p1t,
      p2_from: p2f, p2_to: p2t,
      include_unset: includeUnset,
    });
    const r = await fetch("/api/analysis/compare?" + p.toString());
    const d = await r.json();
    if (!r.ok) { setStatus("Ошибка: " + (d.error || r.status), "err"); return; }

    state.data = d;
    render(d);
    setStatus(`Строк: ${d.items.length}`);
  } catch (e) {
    setStatus("Ошибка: " + e.message, "err");
  } finally {
    $("btn-build").disabled = false;
  }
}

function render(d) {
  $("result-card").hidden = false;
  $("table-card").hidden = false;
  $("cat-name").textContent = d.category.name;
  $("total1").textContent = fmtMoney(d.total1);
  $("total2").textContent = fmtMoney(d.total2);

  const totalDeltaEl = $("total-delta");
  totalDeltaEl.textContent = fmtSignedMoney(d.delta);
  totalDeltaEl.className = deltaClass(d.delta);

  const pctEl = $("total-delta-pct");
  pctEl.textContent = "(" + fmtSignedPct(d.delta_pct) + ")";
  pctEl.className = deltaClass(d.delta_pct);

  renderChart(d);
  renderTable(d);
}

function renderChart(d) {
  const wrap = $("chart-wrap");
  const isEmpty = d.items.length === 0;
  $("chart-empty").hidden = !isEmpty;

  if (state.chart) { state.chart.destroy(); state.chart = null; }
  if (isEmpty) { wrap.hidden = true; return; }
  wrap.hidden = false;

  const labels = d.items.map(x => x.name);
  const v1 = d.items.map(x => x.sum1);
  const v2 = d.items.map(x => x.sum2);

  const label1 = `Период 1 (${d.period1.from} — ${d.period1.to})`;
  const label2 = `Период 2 (${d.period2.from} — ${d.period2.to})`;

  const ctx = $("chart").getContext("2d");
  state.chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: label1, data: v1, backgroundColor: COLOR_P1, borderWidth: 0 },
        { label: label2, data: v2, backgroundColor: COLOR_P2, borderWidth: 0 },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top" },
        tooltip: {
          callbacks: {
            label: (c) => {
              const it = d.items[c.dataIndex];
              const sum = c.datasetIndex === 0 ? it.sum1 : it.sum2;
              return `${c.dataset.label}: ${fmtMoney(sum)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => Number(v).toLocaleString("ru-RU") }
        },
        x: {
          ticks: { autoSkip: false, maxRotation: 45, minRotation: 0 }
        }
      }
    }
  });
}

function renderTable(d) {
  const tb = $("tbody");
  tb.innerHTML = "";
  if (!d.items.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" class="empty">Нет данных за выбранные периоды</td>`;
    tb.appendChild(tr);
    return;
  }
  d.items.forEach((it) => {
    const tr = document.createElement("tr");
    if (it.key === "unset" || it.key === "no_good") tr.classList.add("row-accent");

    const cls = deltaClass(it.delta);

    const nameTd = document.createElement("td");
    let swColor;
    if (it.key === "unset") swColor = COLOR_UNSET;
    else if (it.key === "no_good") swColor = COLOR_NO_GOOD;
    else swColor = COLOR_P2;
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = swColor;
    nameTd.appendChild(sw);
    nameTd.appendChild(document.createTextNode(it.name));
    tr.appendChild(nameTd);

    const td1 = document.createElement("td");
    td1.className = "num";
    td1.textContent = fmtMoney(it.sum1);
    tr.appendChild(td1);

    const td2 = document.createElement("td");
    td2.className = "num";
    td2.textContent = fmtMoney(it.sum2);
    tr.appendChild(td2);

    const tdD = document.createElement("td");
    tdD.className = "num " + cls;
    tdD.textContent = fmtSignedMoney(it.delta);
    tr.appendChild(tdD);

    const tdP = document.createElement("td");
    tdP.className = "num " + deltaClass(it.delta_pct);
    tdP.textContent = fmtSignedPct(it.delta_pct);
    tr.appendChild(tdP);

    tb.appendChild(tr);
  });
}

$("btn-build").addEventListener("click", build);

// ---------- старт ----------
(async function init() {
  const today = isoToday();
  $("p2_to").value = today;
  $("p2_from").value = isoAddDays(today, -29);            // последние 30 дней
  $("p1_to").value = isoAddDays($("p2_from").value, -1);
  $("p1_from").value = isoAddDays($("p1_to").value, -29); // предыдущие 30 дней

  await loadCategories();
})();
