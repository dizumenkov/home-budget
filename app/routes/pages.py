from flask import Blueprint, render_template

bp = Blueprint("pages", __name__)


@bp.route("/")
def index():
    return render_template("index.html")


@bp.route("/categories")
def categories_page():
    return render_template("categories.html")


@bp.route("/comparison")
def comparison_page():
    return render_template("comparison.html")


@bp.route("/analysis")
def analysis_page():
    return render_template("analysis.html")


@bp.route("/manual")
def manual_page():
    return render_template("manual.html")


@bp.route("/goods")
def goods_page():
    return render_template("goods.html")


@bp.route("/compare-periods")
def compare_periods_page():
    return render_template("compare_periods.html")


@bp.route("/settings")
def settings_page():
    return render_template("settings.html")


@bp.route("/periods-analysis")
def periods_analysis_page():
    return render_template("periods_analysis.html")
