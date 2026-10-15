"use strict";

/* manual.js — логика страницы (авто-экстракция) */

const params = new URLSearchParams(location.search);
const embedded = params.get("embedded") === "1";
const editIdRaw = params.get("id");
const editId = editIdRaw ? parseInt(editIdRaw, 10) : null;

const itemsBody = $("items-body");
const statusEl = $("status");

function setStatus(msg, cls) {
  statusEl.textContent = msg || "";
  statusEl.className = cls || "";
}

function fmtMoney(v) {
  const n = Number(v);
  if (!isFinite(n)) return "0,00 ₽";
  return n.toLocaleString("ru-RU",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
}

function fmtNum2(v) {
  const n = Number(v);
  if (!isFinite(n)) return "";
  return n.toFixed(2);
}

function isoToInput(iso) {
  if (!iso) return "";
  const [date, time] = iso.split("T");
  if (!date || !time) return "";
  return `${date}T${time.slice(0, 5)}`;
}

// ---------- строки товаров ----------
function makeRow(item) {
  item = item || {};
  const tr = document.createElement("tr");

  const nameTd = document.createElement("td");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "item-name";
  nameInput.setAttribute("list", "goods-list");
  nameInput.placeholder = "начните вводить…";
  nameInput.value = item.name || "";
  nameTd.appendChild(nameInput);
  tr.appendChild(nameTd);

  const priceTd = document.createElement("td");
  priceTd.className = "num";
  const priceInput = document.createElement("input");
  priceInput.type = "number";
  priceInput.className = "item-price";
  priceInput.step = "0.01";
  priceInput.min = "0";
  priceInput.value = (item.price != null) ? fmtNum2(item.price) : "";
  priceTd.appendChild(priceInput);
  tr.appendChild(priceTd);

  const qtyTd = document.createElement("td");
  qtyTd.className = "num";
  const qtyInput = document.createElement("input");
  qtyInput.type = "number";
  qtyInput.className = "item-qty";
  qtyInput.step = "0.001";
  qtyInput.min = "0";
  qtyInput.value = (item.quantity != null) ? String(item.quantity) : "1";
  qtyTd.appendChild(qtyInput);
  tr.appendChild(qtyTd);

  const sumTd = document.createElement("td");
  sumTd.className = "num";
  const sumInput = document.createElement("input");
  sumInput.type = "number";
  sumInput.className = "item-sum";
  sumInput.step = "0.01";
  sumInput.min = "0";
  sumInput.value = (item.sum != null) ? fmtNum2(item.sum) : "";
  sumTd.appendChild(sumInput);
  tr.appendChild(sumTd);

  const delTd = document.createElement("td");
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "del-row";
  delBtn.textContent = "✕";
  delBtn.title = "Удалить строку";
  delTd.appendChild(delBtn);
  tr.appendChild(delTd);

  // события
  priceInput.addEventListener("input", () => { recalcRow(tr, "price"); });
  qtyInput.addEventListener("input", () => { recalcRow(tr, "qty"); });
  sumInput.addEventListener("input", () => { recalcRow(tr, "sum"); });
  qtyInput.addEventListener("blur", () => {
    if (!(parseFloat(qtyInput.value) > 0)) { qtyInput.value = "1"; recalcRow(tr, "qty"); }
  });
  sumInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && tr === itemsBody.lastElementChild) {
      e.preventDefault(); addRow(); itemsBody.lastElementChild.querySelector(".item-name").focus();
    }
  });

  delBtn.addEventListener("click", () => {
    tr.remove();
    if (!itemsBody.children.length) addRow();
    recalcTotal();
  });

  return tr;
}

function recalcRow(tr, source) {
  const priceInput = tr.querySelector(".item-price");
  const qtyInput = tr.querySelector(".item-qty");
  const sumInput = tr.querySelector(".item-sum");

  let price = parseFloat(priceInput.value);
  let qty = parseFloat(qtyInput.value);
  let sum = parseFloat(sumInput.value);

  if (!isFinite(price)) price = 0;
  if (!isFinite(qty)) qty = 0;
  if (!isFinite(sum)) sum = 0;

  if (qty <= 0) qty = 1;  // поле не трогаем, пока пользователь печатает (раньше «0,5» превращалось в «1»)

  if (source === "sum") {
    // сумма изменена → пересчитываем цену
    const newPrice = Math.round((sum / qty) * 100) / 100;
    priceInput.value = newPrice.toFixed(2);
  } else {
    // цена или количество → пересчитываем сумму
    const newSum = Math.round(price * qty * 100) / 100;
    sumInput.value = newSum.toFixed(2);
  }
  recalcTotal();
}

function recalcTotal() {
  let total = 0;
  for (const tr of itemsBody.children) {
    const v = parseFloat(tr.querySelector(".item-sum").value);
    if (isFinite(v)) total += v;
  }
  $("total-sum").textContent = fmtMoney(total);
}

function addRow(item) {
  itemsBody.appendChild(makeRow(item));
  recalcTotal();
}

// ---------- сохранение ----------
function collect() {
  const items = [];
  for (const tr of itemsBody.children) {
    const name = tr.querySelector(".item-name").value.trim();
    const price = parseFloat(tr.querySelector(".item-price").value) || 0;
    let quantity = parseFloat(tr.querySelector(".item-qty").value) || 0;
    const sum = parseFloat(tr.querySelector(".item-sum").value) || 0;

    if (!name) throw new Error("Заполните наименование во всех строках");
    if (quantity <= 0) quantity = 1;
    if (sum <= 0) throw new Error(`Сумма должна быть > 0 (товар «${name}»)`);

    items.push({ name, price, quantity, sum });
  }
  if (!items.length) throw new Error("Добавьте хотя бы один товар");
  return items;
}

async function save() {
  setStatus("", "");
  const check_at = $("check_at").value;
  if (!check_at) { setStatus("Укажите дату чека", "err"); return; }

  let items;
  try { items = collect(); }
  catch (e) { setStatus(e.message, "err"); return; }

  const user = $("user").value.trim();
  const payload = { check_at, user, items };

  const url = editId
    ? `/api/receipts/${editId}/manual`
    : `/api/receipts/manual`;
  const method = editId ? "PUT" : "POST";

  $("btn-save").disabled = true;
  setStatus("Сохранение…", "");
  try {
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) {
      setStatus("Ошибка: " + (d.error || r.status), "err");
      return;
    }
    // после сохранения — закрыть / вернуться
    if (embedded && window.parent && window.parent !== window) {
      window.parent.postMessage(
        { type: "close-manual", refresh: true }, "*"
      );
    } else {
      location.href = "/";
    }
  } catch (e) {
    setStatus("Ошибка: " + e.message, "err");
  } finally {
    $("btn-save").disabled = false;
  }
}

// ---------- закрытие ----------
let dirty = false;
document.addEventListener("input", () => { dirty = true; });

function closePage() {
  if (dirty && !confirm("Закрыть без сохранения? Введённые данные будут потеряны.")) return;
  if (embedded && window.parent && window.parent !== window) {
    window.parent.postMessage({ type: "close-manual", refresh: false }, "*");
    return;
  }
  window.close();
  setTimeout(() => {
    if (!window.closed) history.length > 1 ? history.back() : (location.href = "/");
  }, 50);
}

$("nav-close").addEventListener("click", (e) => {
  e.preventDefault();
  closePage();
});
$("btn-cancel").addEventListener("click", closePage);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); closePage(); }
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
});

// ---------- загрузка справочников ----------
async function loadGoods() {
  const r = await fetch("/api/goods");
  const d = await r.json();
  const list = $("goods-list");
  list.innerHTML = "";
  for (const g of (d.items || [])) {
    const o = document.createElement("option");
    o.value = g.name;
    list.appendChild(o);
  }
}

async function loadUsers() {
  const r = await fetch("/api/users");
  const d = await r.json();
  const list = $("users-list");
  list.innerHTML = "";
  for (const u of (d.items || [])) {
    const o = document.createElement("option");
    o.value = u;
    list.appendChild(o);
  }
}

// ---------- загрузка для редактирования ----------
async function loadForEdit() {
  const r = await fetch(`/api/receipts/${editId}`);
  if (!r.ok) {
    setStatus("Не удалось загрузить чек", "err");
    return;
  }
  const d = await r.json();
  const rec = d.receipt;

  $("page-title").textContent = `Редактирование чека #${rec.id}`;
  $("check_at").value = isoToInput(rec.check_at);
  $("user").value = rec.user || "";

  itemsBody.innerHTML = "";
  for (const it of (d.items || [])) {
    itemsBody.appendChild(makeRow(it));
  }
  if (!itemsBody.children.length) addRow();
  recalcTotal();
}

// ---------- старт ----------
(async function init() {
  // дефолтная дата — сейчас
  if (!editId) {
    const now = new Date();
    const p2 = (n) => String(n).padStart(2, "0");
    $("check_at").value =
      `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}` +
      `T${p2(now.getHours())}:${p2(now.getMinutes())}`;
  }

  $("btn-add-row").addEventListener("click", () => {
    addRow(); itemsBody.lastElementChild.querySelector(".item-name").focus();
  });
  $("btn-save").addEventListener("click", save);

  await Promise.all([loadGoods(), loadUsers()]);

  if (editId) {
    await loadForEdit();
  } else {
    addRow();
  }

  $("check_at").focus();
})();
