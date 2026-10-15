/* goods.js — логика страницы «Справочник товаров» */
"use strict";

let goodsAll = [];
let delTarget = null;

function setStatus(m, kind) {
  const el = $("status");
  el.textContent = m || "";
  el.className = kind || "";
}

async function load() {
  const r = await fetch("/api/goods");
  const d = await r.json();
  goodsAll = d.items || [];
  const tbody = $("tbody");
  tbody.innerHTML = "";
  for (const g of goodsAll) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    const inp = document.createElement("input");
    inp.type = "text"; inp.value = g.name; inp.style.minWidth = "220px";
    nameTd.appendChild(inp);
    tr.appendChild(nameTd);

    const actTd = document.createElement("td");
    actTd.className = "actions";

    const compLink = document.createElement("a");
    compLink.className = "link";
    compLink.href = `/comparison?good_id=${g.id}`;
    compLink.target = "_blank"; compLink.rel = "noopener";
    compLink.textContent = "Соответствия";
    actTd.appendChild(compLink);

    const saveBtn = document.createElement("button");
    saveBtn.className = "sm"; saveBtn.textContent = "Сохранить";
    saveBtn.addEventListener("click", async () => {
      const name = inp.value.trim();
      if (!name) { inp.focus(); return; }
      const r = await fetch(`/api/goods/${g.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const d = await r.json();
      if (!r.ok) { setStatus("Ошибка: " + (d.error || r.status), "err"); return; }
      setStatus("Сохранено", "ok");
      await load();
    });
    actTd.appendChild(saveBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "del"; delBtn.textContent = "Удалить";
    delBtn.style.marginLeft = "8px";
    delBtn.addEventListener("click", () => openDeleteModal(g));
    actTd.appendChild(delBtn);

    tr.appendChild(actTd);
    tbody.appendChild(tr);
  }
}

function openDeleteModal(g) {
  delTarget = g;
  $("del-title").textContent = `Удалить «${g.name}»?`;
  const sel = $("del-select");
  sel.innerHTML = "";

  const optNull = document.createElement("option");
  optNull.value = "0";
  optNull.textContent = "— удалить без переназначения (обнулить в «— не определено —») —";
  sel.appendChild(optNull);

  for (const other of goodsAll) {
    if (other.id === g.id) continue;
    const o = document.createElement("option");
    o.value = String(other.id);
    o.textContent = "Переназначить на: " + other.name;
    sel.appendChild(o);
  }
  $("del-modal").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeDeleteModal() {
  $("del-modal").hidden = true;
  document.body.style.overflow = "";
  delTarget = null;
}

document.addEventListener("DOMContentLoaded", () => {
  $("btn-add").addEventListener("click", async () => {
    const name = $("new-name").value.trim();
    if (!name) { $("new-name").focus(); return; }
    const r = await fetch("/api/goods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const d = await r.json();
    if (!r.ok) { setStatus("Ошибка: " + (d.error || r.status), "err"); return; }
    $("new-name").value = "";
    setStatus(`Добавлено: «${name}»`, "ok");
    await load();
  });
  $("new-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btn-add").click();
  });

  $("del-backdrop").addEventListener("click", closeDeleteModal);
  $("del-cancel").addEventListener("click", closeDeleteModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("del-modal").hidden) {
      closeDeleteModal(); e.stopPropagation();
    }
  });
  $("del-confirm").addEventListener("click", async () => {
    if (!delTarget) return;
    const sel = $("del-select");
    const reassign_to = parseInt(sel.value, 10) || 0;
    const r = await fetch(`/api/goods/${delTarget.id}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reassign_to: reassign_to || null }),
    });
    const d = await r.json();
    if (!r.ok) {
      setStatus("Ошибка: " + (d.error || r.status), "err");
      closeDeleteModal(); return;
    }
    if (reassign_to) {
      const label = sel.options[sel.selectedIndex].textContent
        .replace("Переназначить на: ", "");
      setStatus(`Удалено, переназначено на «${label}»`, "ok");
    } else {
      setStatus("Удалено без переназначения", "ok");
    }
    closeDeleteModal();
    await load();
  });

  load();
});
