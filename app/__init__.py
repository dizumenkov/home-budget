from flask import Flask

from .config import BASE_DIR
from .db import init_db
from .scheduler import start_scheduler
from .routes import (
    pages, receipts, manual, goods, queue,
    categories, comparison, analysis, settings,
)


def create_app():
    app = Flask(
        __name__,
        template_folder=str(BASE_DIR / "templates"),
        static_folder=str(BASE_DIR / "static"),
    )

    app.register_blueprint(pages.bp)
    app.register_blueprint(receipts.bp)
    app.register_blueprint(manual.bp)
    app.register_blueprint(goods.bp)
    app.register_blueprint(queue.bp)
    app.register_blueprint(categories.bp)
    app.register_blueprint(comparison.bp)
    app.register_blueprint(analysis.bp)
    app.register_blueprint(settings.bp)

    init_db()
    start_scheduler()

    return app
