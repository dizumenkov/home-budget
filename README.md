# Домашний бюджет

Локальное Flask-приложение: читает чеки из Yandex Message Queue, запрашивает
данные ФНС на proverkacheka.com, ведёт справочник товаров, категорий и меток,
строит отчёты по суммам.

## Установка

```bash
git clone <repo> home-budget
cd home-budget

python3 -m venv .venv
. .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Скачайте Chart.js в `static/` (один раз):

```bash
mkdir -p static
curl -fsSL -o static/chart.umd.min.js \
  https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js
```

## Конфигурация

```bash
cp config.example.json config.json
```

Откройте `config.json` и заполните:

- `sqs.aws_access_key_id`, `sqs.aws_secret_access_key` — статический ключ сервисного аккаунта Yandex Cloud;
- `sqs.queue_url` — URL очереди;
- `proverkacheka.token` — токен из личного кабинета proverkacheka.com;
- остальные ключи — см. комментарии в `config.example.json`.

Если конфиг не создан, приложение завершится с понятным сообщением.

## Запуск

```bash
chmod +x run.sh
./run.sh                 # запустить в фоне и открыть браузер
./run.sh status          # проверить статус
./run.sh stop            # остановить
./run.sh restart         # перезапустить
./run.sh fg              # запустить в терминале (Ctrl+C — стоп)
```

По умолчанию сервис поднимается на `http://127.0.0.1:5000/`.

### Запуск через иконку

Скопируйте `.desktop`-файл в `~/.local/share/applications/`:

```bash
cp domashniy-byudzhet.desktop ~/.local/share/applications/
update-desktop-database ~/.local/share/applications/
```

После этого «Домашний бюджет» появится в меню приложений.

## Логирование

Если `logging.enabled: true` в `config.json`, приложение пишет лог
в файл `logging.path`. Работает и при запуске через `run.sh`, и при
прямом `python run.py`. Лог ротируется на 5 МБ (до 3 архивов).

## Страницы

- `/` — список чеков, загрузка из очереди, ручной ввод, модалки сравнений и сопоставления товаров.
- `/goods` — справочник товаров.
- `/categories` — категории и метки.
- `/analysis` — анализ по одной категории (круговая, столбчатая, квадратная диаграммы).
- `/compare-periods` — сравнение периодов.
- `/manual` — форма ручного ввода чека.
- `/comparison` — соответствия одного товара.

## Структура

```
app/
  __init__.py         # create_app()
  config.py           # CONFIG, DB_PATH, TZ, LOGGING
  db.py               # db(), init_db()
  parsing.py          # parse_body, t_to_dt
  sqs.py              # read_queue
  fns.py              # fetch_fns_data
  categories_util.py  # cat_map, descendants, top, is_dup
  scheduler.py        # start_scheduler
  routes/             # Flask blueprints по функциональным группам
static/
  buttons.css         # общий стиль кнопок
  common.css          # общие стили
  common.js           # общие функции
  *.css / *.js        # стили и логика отдельных страниц
  chart.umd.min.js    # Chart.js локально
templates/            # тонкая разметка страниц
run.py                # точка входа
run.sh                # управляющий скрипт
config.example.json   # пример конфигурации
```

## Лицензия

См. файл `LICENSE` (при наличии).