from datetime import date, datetime, timedelta

from .config import day_bound

_MONTHS_RU = ["Янв","Фев","Мар","Апр","Май","Июн",
              "Июл","Авг","Сен","Окт","Ноя","Дек"]
_QUARTERS_ROMAN = ["I","II","III","IV"]

ALLOWED_INTERVALS = ("day", "week", "month", "quarter", "year")


def build_intervals(date_from: str, date_to: str, interval: str):
    """Возвращает список интервалов [{key, label, start_iso, end_iso}].

    start_iso / end_iso — границы интервала включительно в ISO-формате
    с офсетом TZ из config.json. Границы обрезаны по [date_from, date_to].
    """
    if interval not in ALLOWED_INTERVALS:
        raise ValueError(f"bad interval: {interval}")

    d_from = datetime.strptime(date_from, "%Y-%m-%d").date()
    d_to = datetime.strptime(date_to, "%Y-%m-%d").date()
    if d_to < d_from:
        raise ValueError("date_to раньше date_from")

    multi_year = d_from.year != d_to.year
    out = []

    def add(key, label, s, e):
        out.append({
            "key": key,
            "label": label,
            "start_iso": day_bound(s.isoformat()),
            "end_iso": day_bound(e.isoformat(), True),
        })

    if interval == "day":
        cur = d_from
        while cur <= d_to:
            label = cur.strftime("%d.%m")
            if multi_year:
                label += "." + cur.strftime("%y")
            add(cur.isoformat(), label, cur, cur)
            cur += timedelta(days=1)

    elif interval == "week":
        cur = d_from
        while cur <= d_to:
            monday = cur - timedelta(days=cur.weekday())
            sunday = monday + timedelta(days=6)
            iso_year, iso_week, _ = cur.isocalendar()
            label = f"н{iso_week:02d}"
            if multi_year:
                label += f".{iso_year % 100:02d}"
            add(f"{iso_year}-W{iso_week:02d}", label,
                max(monday, d_from), min(sunday, d_to))
            cur = sunday + timedelta(days=1)

    elif interval == "month":
        y, m = d_from.year, d_from.month
        while (y, m) <= (d_to.year, d_to.month):
            first = date(y, m, 1)
            last = (date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)) - timedelta(days=1)
            label = _MONTHS_RU[m - 1]
            if multi_year:
                label += f" {y % 100:02d}"
            add(f"{y}-{m:02d}", label,
                max(first, d_from), min(last, d_to))
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)

    elif interval == "quarter":
        y, q = d_from.year, (d_from.month - 1) // 3 + 1
        q_to = (d_to.month - 1) // 3 + 1
        while (y, q) <= (d_to.year, q_to):
            start_m = (q - 1) * 3 + 1
            first = date(y, start_m, 1)
            last = (date(y + 1, 1, 1) if q == 4 else date(y, start_m + 3, 1)) - timedelta(days=1)
            label = f"{_QUARTERS_ROMAN[q - 1]} кв"
            if multi_year:
                label += f" {y % 100:02d}"
            add(f"{y}-Q{q}", label,
                max(first, d_from), min(last, d_to))
            y, q = (y + 1, 1) if q == 4 else (y, q + 1)

    else:  # year
        for y in range(d_from.year, d_to.year + 1):
            first = date(y, 1, 1)
            last = date(y, 12, 31)
            add(str(y), str(y), max(first, d_from), min(last, d_to))

    return out