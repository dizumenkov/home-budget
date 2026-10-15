import sqlite3
from contextlib import contextmanager

from .config import DB_PATH

GOOD_UNDEFINED_ID = 0
GOOD_UNDEFINED_NAME = "— не определено —"


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Создаёт схему БД, если она отсутствует.

    Предполагается запуск на чистой базе или на базе, которая уже
    соответствует текущей схеме.
    """    
    with db() as conn:
        # ---------- receipts
        conn.execute("""
            CREATE TABLE IF NOT EXISTS receipts (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                raw         TEXT NOT NULL UNIQUE,
                check_at    TEXT NOT NULL,
                code        INTEGER DEFAULT NULL,
                fnsData     TEXT DEFAULT NULL,
                html        TEXT DEFAULT NULL,
                sum         REAL DEFAULT NULL,
                user        TEXT DEFAULT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_receipts_check_at ON receipts(check_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_receipts_code ON receipts(code)")

        conn.execute("""
            CREATE TABLE IF NOT EXISTS skipped_messages (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                skipped_at  TEXT NOT NULL DEFAULT (datetime('now')),
                body        TEXT,
                reason      TEXT
            )
        """)

        # ---------- goods
        conn.execute("""
            CREATE TABLE IF NOT EXISTS goods (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                name    TEXT NOT NULL UNIQUE
            )
        """)
        conn.execute(
            "INSERT OR IGNORE INTO goods(id, name) VALUES (?, ?)",
            (GOOD_UNDEFINED_ID, GOOD_UNDEFINED_NAME),
        )
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS trg_goods_no_delete_zero
            BEFORE DELETE ON goods
            WHEN OLD.id = 0
            BEGIN
                SELECT RAISE(ABORT, 'cannot delete goods.id=0');
            END
        """)

        # ---------- products
        conn.execute("""
            CREATE TABLE IF NOT EXISTS products (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                good_id  INTEGER NOT NULL DEFAULT 0,
                name     TEXT NOT NULL UNIQUE,
                FOREIGN KEY (good_id) REFERENCES goods(id) ON DELETE SET DEFAULT
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_products_good_id ON products(good_id)")

        # ---------- items
        conn.execute("""
            CREATE TABLE IF NOT EXISTS items (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                receipt_id  INTEGER NOT NULL,
                product_id  INTEGER,
                good_id     INTEGER NOT NULL DEFAULT 0,
                price       REAL,
                quantity    REAL,
                sum         REAL,
                FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE,
                FOREIGN KEY (good_id)    REFERENCES goods(id)    ON DELETE SET DEFAULT
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_items_receipt_id ON items(receipt_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_items_good_id ON items(good_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_items_product_id ON items(product_id)")

        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS trg_products_update_good_id
            AFTER UPDATE OF good_id ON products
            BEGIN
                UPDATE items SET good_id = NEW.good_id WHERE product_id = NEW.id;
            END
        """)

        # ---------- categories
        conn.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                parent_id   INTEGER DEFAULT NULL,
                name        TEXT NOT NULL,
                is_folder   BOOLEAN NOT NULL DEFAULT 0 CHECK (is_folder IN (0, 1)),
                FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id)")

        # ---------- comparison
        conn.execute("""
            CREATE TABLE IF NOT EXISTS comparison (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                good_id      INTEGER NOT NULL,
                category_id  INTEGER NOT NULL,
                metka_id     INTEGER NOT NULL,
                FOREIGN KEY (good_id)     REFERENCES goods(id)      ON DELETE CASCADE,
                FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
                FOREIGN KEY (metka_id)    REFERENCES categories(id) ON DELETE CASCADE,
                UNIQUE (good_id, category_id)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_comparison_good_id ON comparison(good_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_comparison_metka_id ON comparison(metka_id)")

        # ---------- api_calls
        conn.execute("""
            CREATE TABLE IF NOT EXISTS api_calls (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                called_at   TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_api_calls_called_at ON api_calls(called_at)")