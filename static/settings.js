/* settings.js — логика страницы настроек */
"use strict";

let currentConfig = null;

function getVal(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setVal(obj, path, val) {
  const keys = path.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== "object" || cur[keys[i]] == null) {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = val;
}

function showBanner(text) {
  const b = document.getElementById("banner");
  b.textContent = text;
  b.hidden = false;
}
function hideBanner() {
  document.getElementById("banner").hidden = true;
}
function setStatus(msg, kind) {
  const el = document.getElementById("status");
  el.textContent = msg || "";
  el.className = kind || "";
}

function fillForm(cfg) {
  document.querySelectorAll("[data-path]").forEach(el => {
    const v = getVal(cfg, el.dataset.path);
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = (v == null) ? "" : String(v);
  });
}

function readForm() {
  const out = {};
  document.querySelectorAll("[data-path]").forEach(el => {
    let v;
    if (el.type === "checkbox") v = el.checked;
    else if (el.type === "number") {
      v = el.value === "" ? 0 : Number(el.value);
      if (isNaN(v)) v = 0;
    } else {
      v = el.value;
    }
    setVal(out, el.dataset.path, v);
  });
  return out;
}

async function loadConfig() {
  setStatus("Загрузка…");
  try {
    const r = await fetch("/api/config");
    const d = await r.json();
    if (!r.ok) {
      setStatus("Ошибка: " + (d.error || r.status), "err");
      return;
    }
    currentConfig = d.config;
    fillForm(d.config);
    if (!d.config_exists) {
      showBanner(
        "config.json не найден — сейчас используются значения из config.example.json. " +
        "Нажмите «Сохранить», чтобы создать настоящий config.json."
      );
    } else {
      hideBanner();
    }
    setStatus("Загружено из " + d.source);
  } catch (e) {
    setStatus("Ошибка: " + e.message, "err");
  }
}

async function save() {
  setStatus("Сохранение…");
  const cfg = readForm();
  try {
    const r = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    const d = await r.json();
    if (!r.ok) {
      setStatus("Ошибка: " + (d.error || r.status), "err");
      return;
    }
    setStatus("Сохранено. Можно перезапустить сервис.", "ok");
    document.getElementById("btn-restart").hidden = false;
    hideBanner();
    currentConfig = cfg;
  } catch (e) {
    setStatus("Ошибка: " + e.message, "err");
  }
}

async function restart() {
  const btn = document.getElementById("btn-restart");
  btn.disabled = true;
  setStatus("Перезапуск…");
  try {
    await fetch("/api/restart", {
      method: "POST",
      headers: { "X-Restart": "1" },
    });
  } catch (_) { /* соединение оборвётся — это ожидаемо */ }

  let ok = false;
  for (let i = 0; i < 40; i++) {
    await new Promise(res => setTimeout(res, 500));
    try {
      const r = await fetch("/api/fns-limit", { cache: "no-store" });
      if (r.ok) { ok = true; break; }
    } catch (_) {}
  }
  if (ok) {
    setStatus("Сервис перезапущен. Обновляю страницу…", "ok");
    setTimeout(() => location.reload(), 500);
  } else {
    setStatus("Сервис не ответил за 20 секунд — проверьте ./run.sh status", "err");
    btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-save").addEventListener("click", save);

  document.getElementById("btn-reset").addEventListener("click", () => {
    if (currentConfig) {
      fillForm(currentConfig);
      setStatus("Отменено", "");
    }
  });

  document.getElementById("btn-restart").addEventListener("click", restart);

  document.querySelectorAll(".toggle-secret").forEach(btn => {
    btn.addEventListener("click", () => {
      const inp = btn.parentElement.querySelector("input");
      const isPwd = inp.type === "password";
      inp.type = isPwd ? "text" : "password";
      btn.textContent = isPwd ? "🙈" : "👁";
    });
  });

  loadConfig();
});

/* ---------- QR с параметрами подключения ---------- */

function buildQrPayload(cfg) {
  const sqs = cfg.sqs || {};
  return {
    queue_url: sqs.queue_url || "",
    access_key_id: sqs.aws_access_key_id || "",
    secret_key: sqs.aws_secret_access_key || "",
  };
}

function openQrModal() {
  const cfg = readForm();
  const payload = buildQrPayload(cfg);
  const text = JSON.stringify(payload);

  document.getElementById("qr-json").textContent = text;

  const container = document.getElementById("qr-container");
  container.innerHTML = "";

  if (typeof QRCode === "undefined") {
    const err = document.createElement("div");
    err.className = "qr-error";
    err.textContent =
      "Библиотека QR не загружена. Скачайте static/qrcode.min.js " +
      "(см. README). JSON ниже можно скопировать вручную.";
    container.appendChild(err);
  } else {
    try {
      new QRCode(container, {
        text: text,
        width: 280,
        height: 280,
        colorDark: "#1f2328",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M,
      });
    } catch (e) {
      const err = document.createElement("div");
      err.className = "qr-error";
      err.textContent = "Не удалось построить QR: " + e.message;
      container.appendChild(err);
    }
  }

  document.getElementById("qr-modal").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeQrModal() {
  document.getElementById("qr-modal").hidden = true;
  document.body.style.overflow = "";
  document.getElementById("qr-container").innerHTML = "";
}

async function copyQrJson() {
  const text = document.getElementById("qr-json").textContent || "";
  try {
    await navigator.clipboard.writeText(text);
    setStatus("JSON скопирован в буфер обмена", "ok");
  } catch (_) {
    // запасной способ
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); setStatus("JSON скопирован", "ok"); }
    catch (e) { setStatus("Не удалось скопировать: " + e.message, "err"); }
    ta.remove();
  }
}

/* ---------- регистрация обработчиков ---------- */
document.addEventListener("DOMContentLoaded", () => {
  // ... всё, что было раньше ...
});

// добавляем в существующий DOMContentLoaded (или отдельным):
document.addEventListener("DOMContentLoaded", () => {
  const btnQr = document.getElementById("btn-show-qr");
  if (btnQr) btnQr.addEventListener("click", openQrModal);

  const btnClose = document.getElementById("qr-close");
  if (btnClose) btnClose.addEventListener("click", closeQrModal);

  const btnCopy = document.getElementById("qr-copy");
  if (btnCopy) btnCopy.addEventListener("click", copyQrJson);

  const backdrop = document.getElementById("qr-backdrop");
  if (backdrop) backdrop.addEventListener("click", closeQrModal);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" &&
        !document.getElementById("qr-modal").hidden) {
      closeQrModal();
      e.stopPropagation();
    }
  });
});