#!/usr/bin/env bash
# Запуск Flask-сервиса "Домашний бюджет" и открытие стартовой страницы.
# Проверяет, не запущен ли сервис ранее (через pid-файл и HTTP-запрос к /).
#
# Использование:
#   ./run.sh              # запустить и открыть браузер
#   ./run.sh stop         # остановить сервис
#   ./run.sh status       # показать статус
#   ./run.sh restart      # перезапустить
#   ./run.sh fg           # запустить на переднем плане (без открытия браузера)
#
# Логирование в фоне управляется ключом logging.enabled в config.json:
#   { "logging": { "enabled": false, "path": "run.log" } }

set -euo pipefail

# ---------- настройки ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/.venv"
PYTHON="$VENV_DIR/bin/python"
APP="$SCRIPT_DIR/run.py"
PID_FILE="$SCRIPT_DIR/run.pid"
LOG_ENABLED="0"
LOG_FILE="$SCRIPT_DIR/run.log"
HOST="127.0.0.1"
PORT="5000"
CONFIG_FILE="$SCRIPT_DIR/config.json"

# ---------- host/port из config.json ----------
if [ -f "$CONFIG_FILE" ] && [ -x "$PYTHON" ]; then
  read -r CFG_HOST CFG_PORT < <("$PYTHON" - "$CONFIG_FILE" <<'PY' || true
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        c = json.load(f)
    s = c.get("server", {}) or {}
    print(s.get("host", "127.0.0.1"), s.get("port", 5000))
except Exception:
    print("127.0.0.1 5000")
PY
)
  HOST="${CFG_HOST:-$HOST}"
  PORT="${CFG_PORT:-$PORT}"
fi

# ---------- logging.* из config.json ----------
if [ -f "$CONFIG_FILE" ] && [ -x "$PYTHON" ]; then
  read -r CFG_LOG_ENABLED CFG_LOG_PATH < <("$PYTHON" - "$CONFIG_FILE" <<'PY' || true
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        c = json.load(f)
    lg = c.get("logging", {}) or {}
    print("1" if lg.get("enabled") else "0", lg.get("path", "run.log"))
except Exception:
    print("0", "run.log")
PY
)
  LOG_ENABLED="${CFG_LOG_ENABLED:-0}"
  if [ -n "${CFG_LOG_PATH:-}" ]; then
    case "$CFG_LOG_PATH" in
      /*) LOG_FILE="$CFG_LOG_PATH" ;;
      *)  LOG_FILE="$SCRIPT_DIR/$CFG_LOG_PATH" ;;
    esac
  fi
fi

URL="http://${HOST}:${PORT}/"

# ---------- утилиты ----------
log()  { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
warn() { printf '[%s] ! %s\n' "$(date '+%H:%M:%S')" "$*" >&2; }
die()  { warn "$*"; exit 1; }

read_pid() {
  if [ -f "$PID_FILE" ]; then
    cat "$PID_FILE" 2>/dev/null || true
  fi
}

is_pid_alive() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

http_ok() {
  # Проверяем, отвечает ли сервис по HTTP
  if command -v curl >/dev/null 2>&1; then
    curl -sf -o /dev/null --max-time 2 "$URL" && return 0
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 2 -O /dev/null "$URL" && return 0
  else
    # без curl/wget — считаем, что сервис жив, если порт слушается
    (exec 3<>"/dev/tcp/${HOST}/${PORT}") >/dev/null 2>&1 && return 0
  fi
  return 1
}

is_running() {
  local pid
  pid="$(read_pid)"
  if is_pid_alive "$pid"; then
    return 0
  fi
  # pid-файла нет/устарел, но порт может слушать кто-то другой (или тот же сервис)
  http_ok
}

wait_http() {
  local tries=30
  while [ "$tries" -gt 0 ]; do
    if http_ok; then
      return 0
    fi
    sleep 0.3
    tries=$((tries - 1))
  done
  return 1
}

open_browser() {
  local url="$1"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
  elif command -v sensible-browser >/dev/null 2>&1; then
    sensible-browser "$url" >/dev/null 2>&1 || true
  elif command -v firefox >/dev/null 2>&1; then
    firefox "$url" >/dev/null 2>&1 &
  elif command -v chromium >/dev/null 2>&1; then
    chromium "$url" >/dev/null 2>&1 &
  elif command -v google-chrome >/dev/null 2>&1; then
    google-chrome "$url" >/dev/null 2>&1 &
  else
    warn "Не найден браузер. Откройте вручную: $url"
  fi
}

# ---------- команды ----------
cmd_status() {
  local pid
  pid="$(read_pid)"
  if is_pid_alive "$pid"; then
    log "Сервис запущен (PID $pid), URL: $URL"
    if http_ok; then
      log "HTTP-проверка: OK"
    else
      warn "HTTP-проверка не проходит — сервис ещё стартует или упал"
    fi
    return 0
  fi
  if http_ok; then
    warn "По адресу $URL кто-то отвечает, но PID-файл не найден/устарел"
    return 0
  fi
  log "Сервис не запущен"
  return 1
}

cmd_stop() {
  local pid
  pid="$(read_pid)"
  if ! is_pid_alive "$pid"; then
    rm -f "$PID_FILE"
    log "Сервис не запущен — останавливать нечего"
    return 0
  fi
  log "Останавливаю сервис (PID $pid)…"
  kill "$pid" 2>/dev/null || true
  local tries=20
  while [ "$tries" -gt 0 ] && is_pid_alive "$pid"; do
    sleep 0.2
    tries=$((tries - 1))
  done
  if is_pid_alive "$pid"; then
    warn "Мягко не получилось — отправляю SIGKILL"
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  log "Сервис остановлен"
}

cmd_run() {
  local open_browser_flag="$1"
  local foreground="$2"

  if is_running; then
    log "Сервис уже запущен: $URL"
    if [ "$open_browser_flag" = "1" ]; then
      open_browser "$URL"
    fi
    return 0
  fi

  # проверки окружения
  [ -f "$APP" ]      || die "Не найден run.py в $SCRIPT_DIR"
  [ -x "$PYTHON" ]   || die "Не найден venv: $VENV_DIR (создайте: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt)"

  # чистим устаревший pid
  rm -f "$PID_FILE"

  if [ "$foreground" = "1" ]; then
    log "Запуск на переднем плане: $URL"
    exec "$PYTHON" "$APP"
  fi

  if [ "$LOG_ENABLED" = "1" ]; then
    log "Запуск в фоне (лог: $LOG_FILE)…"
    nohup "$PYTHON" "$APP" >"$LOG_FILE" 2>&1 &
  else
    log "Запуск в фоне (логирование отключено в config.json)…"
    nohup "$PYTHON" "$APP" >/dev/null 2>&1 &
  fi
  local pid=$!
  echo "$pid" > "$PID_FILE"

  if ! wait_http; then
    if [ "$LOG_ENABLED" = "1" ] && [ -f "$LOG_FILE" ]; then
      warn "Сервис не ответил за ~10 секунд. Последние строки лога:"
      tail -n 20 "$LOG_FILE" >&2 || true
    else
      warn "Сервис не ответил за ~10 секунд. Запустите '$0 fg', чтобы увидеть вывод в терминале."
    fi
    die "Запуск не удался (PID $pid)"
  fi

  log "Сервис запущен (PID $pid): $URL"

  if [ "$open_browser_flag" = "1" ]; then
    open_browser "$URL"
  fi
}

cmd_restart() {
  cmd_stop
  cmd_run 1 0
}

# ---------- разбор аргументов ----------
case "${1:-start}" in
  start|"")
    cmd_run 1 0
    ;;
  fg|foreground)
    cmd_run 0 1
    ;;
  stop)
    cmd_stop
    ;;
  restart)
    cmd_restart
    ;;
  status)
    cmd_status
    ;;
  -h|--help|help)
    cat <<EOF
Использование: $0 [команда]

Команды:
  (без аргумента), start   запустить сервис (если не запущен) и открыть браузер
  fg                       запустить на переднем плане (Ctrl+C для остановки)
  stop                     остановить сервис
  restart                  перезапустить
  status                   показать статус
  help                     эта справка

Файлы:
  PID:  $PID_FILE
  Лог:  $LOG_FILE (пишется только если logging.enabled = true)
  URL:  $URL

Логирование:
  Управляется ключом в config.json:
    "logging": { "enabled": false, "path": "run.log" }
  enabled = false → сервис пишет в /dev/null
  enabled = true  → сервис пишет в файл (run.log или path)
  В режиме 'fg' вывод всегда идёт в текущий терминал.
EOF
    ;;
  *)
    die "Неизвестная команда: $1 (см. $0 help)"
    ;;
esac