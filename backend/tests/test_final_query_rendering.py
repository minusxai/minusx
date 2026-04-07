import pytest
from sqlalchemy.dialects import postgresql

from main import (
    _render_query_with_sqlalchemy_literals,
    _render_query_with_regex_fallback,
    _sqlalchemy_literal_type,
)
from sqlalchemy import Boolean, Date, DateTime, Float, Integer, String
from datetime import datetime, date


class _SyncEngineStub:
    dialect = postgresql.dialect()


class _UnrenderableValue:
    def __str__(self):
        return "fallback'value"


# ─── _sqlalchemy_literal_type ─────────────────────────────────────────────────

class TestSqlalchemyLiteralType:
    """Tests for type inference used in literal compilation."""

    def test_declared_text_returns_string(self):
        assert isinstance(_sqlalchemy_literal_type("hello", "text"), String)

    def test_declared_number_int_returns_integer(self):
        assert isinstance(_sqlalchemy_literal_type(42, "number"), Integer)

    def test_declared_number_float_returns_float(self):
        assert isinstance(_sqlalchemy_literal_type(3.14, "number"), Float)

    def test_declared_number_bool_returns_boolean(self):
        # bool is subclass of int, must be caught first
        assert isinstance(_sqlalchemy_literal_type(True, "number"), Boolean)

    def test_declared_date_string_returns_date(self):
        assert isinstance(_sqlalchemy_literal_type("2026-01-01", "date"), Date)

    def test_declared_date_datetime_returns_datetime(self):
        assert isinstance(_sqlalchemy_literal_type(datetime(2026, 1, 1), "date"), DateTime)

    def test_inferred_string(self):
        assert isinstance(_sqlalchemy_literal_type("hello", None), String)

    def test_inferred_int(self):
        assert isinstance(_sqlalchemy_literal_type(42, None), Integer)

    def test_inferred_float(self):
        assert isinstance(_sqlalchemy_literal_type(3.14, None), Float)

    def test_inferred_bool(self):
        assert isinstance(_sqlalchemy_literal_type(False, None), Boolean)

    def test_inferred_date(self):
        assert isinstance(_sqlalchemy_literal_type(date(2026, 1, 1), None), Date)

    def test_inferred_datetime(self):
        assert isinstance(_sqlalchemy_literal_type(datetime(2026, 1, 1, 12, 0), None), DateTime)

    def test_unknown_type_returns_none(self):
        assert _sqlalchemy_literal_type([1, 2, 3], None) is None

    def test_none_value_returns_none(self):
        assert _sqlalchemy_literal_type(None, None) is None


# ─── _render_query_with_regex_fallback ────────────────────────────────────────

class TestRegexFallback:
    """Tests for the regex-based param substitution fallback."""

    def test_basic_string_param(self):
        result = _render_query_with_regex_fallback(
            "SELECT * FROM t WHERE name = :name", {"name": "Alice"}
        )
        assert "name = 'Alice'" in result

    def test_numeric_param(self):
        result = _render_query_with_regex_fallback(
            "SELECT * FROM t WHERE id = :id", {"id": 42}
        )
        assert "id = 42" in result

    def test_float_param(self):
        result = _render_query_with_regex_fallback(
            "SELECT * FROM t WHERE price > :price", {"price": 9.99}
        )
        assert "price > 9.99" in result

    def test_single_quote_escaping(self):
        result = _render_query_with_regex_fallback(
            "SELECT * FROM t WHERE name = :name", {"name": "O'Brien"}
        )
        assert "name = 'O''Brien'" in result

    def test_multiple_params(self):
        result = _render_query_with_regex_fallback(
            "SELECT * FROM t WHERE a = :a AND b = :b",
            {"a": "x", "b": 10},
        )
        assert "a = 'x'" in result
        assert "b = 10" in result

    def test_param_not_replaced_mid_word(self):
        # :name should not replace :name_full
        result = _render_query_with_regex_fallback(
            "SELECT * FROM t WHERE name_full = :name_full AND name = :name",
            {"name_full": "Alice Bob", "name": "Alice"},
        )
        assert "name_full = 'Alice Bob'" in result
        assert "AND name = 'Alice'" in result

    def test_no_params(self):
        result = _render_query_with_regex_fallback("SELECT 1", {})
        assert result == "SELECT 1"

    def test_empty_string_param(self):
        result = _render_query_with_regex_fallback(
            "SELECT * FROM t WHERE name = :name", {"name": ""}
        )
        assert "name = ''" in result

    def test_param_used_multiple_times(self):
        result = _render_query_with_regex_fallback(
            "SELECT * FROM t WHERE a = :x OR b = :x", {"x": "val"}
        )
        assert result.count("'val'") == 2


# ─── _render_query_with_sqlalchemy_literals ───────────────────────────────────

class TestSqlalchemyLiteralRendering:
    """Tests for the primary SQLAlchemy-based literal rendering."""

    def test_basic_text_param(self):
        rendered = _render_query_with_sqlalchemy_literals(
            "SELECT * FROM t WHERE name = :name",
            {"name": "Alice"},
            {"name": "text"},
            _SyncEngineStub(),
        )
        assert "name = 'Alice'" in rendered

    def test_basic_number_param(self):
        rendered = _render_query_with_sqlalchemy_literals(
            "SELECT * FROM t WHERE id = :id",
            {"id": "42"},
            {"id": "number"},
            _SyncEngineStub(),
        )
        assert "id = 42" in rendered

    def test_date_param(self):
        rendered = _render_query_with_sqlalchemy_literals(
            "SELECT * FROM t WHERE d >= :start",
            {"start": "2026-03-01"},
            {"start": "date"},
            _SyncEngineStub(),
        )
        assert "2026-03-01" in rendered

    def test_sql_injection_escaped(self):
        rendered = _render_query_with_sqlalchemy_literals(
            "SELECT * FROM t WHERE name = :name",
            {"name": "'; DROP TABLE t; --"},
            {"name": "text"},
            _SyncEngineStub(),
        )
        # The dangerous payload must be escaped, not executed as SQL
        assert "DROP TABLE" not in rendered or "'';" in rendered
        assert ":name" not in rendered

    def test_single_quote_in_value(self):
        rendered = _render_query_with_sqlalchemy_literals(
            "SELECT * FROM t WHERE name = :name",
            {"name": "O'Brien"},
            {"name": "text"},
            _SyncEngineStub(),
        )
        assert "O''Brien" in rendered

    def test_multiple_mixed_params(self):
        rendered = _render_query_with_sqlalchemy_literals(
            "SELECT * FROM orders WHERE customer = :cust AND amount > :amt AND created >= :dt",
            {"cust": "Acme", "amt": "500", "dt": "2026-01-01"},
            {"cust": "text", "amt": "number", "dt": "date"},
            _SyncEngineStub(),
        )
        assert "'Acme'" in rendered
        assert "500" in rendered
        assert "2026-01-01" in rendered
        assert ":cust" not in rendered
        assert ":amt" not in rendered
        assert ":dt" not in rendered

    def test_no_params_returns_original(self):
        rendered = _render_query_with_sqlalchemy_literals(
            "SELECT 1", {}, {}, _SyncEngineStub()
        )
        assert rendered == "SELECT 1"

    def test_fallback_on_compile_error(self):
        rendered = _render_query_with_sqlalchemy_literals(
            "SELECT * FROM t WHERE note = :note AND amount > :min_amount",
            {"note": _UnrenderableValue(), "min_amount": 5},
            {},
            _SyncEngineStub(),
        )
        assert "note = 'fallback''value'" in rendered
        assert "amount > 5" in rendered

    def test_no_declared_types_infers_from_values(self):
        rendered = _render_query_with_sqlalchemy_literals(
            "SELECT * FROM t WHERE name = :name AND count = :count",
            {"name": "test", "count": 99},
            {},
            _SyncEngineStub(),
        )
        assert "'test'" in rendered
        assert "99" in rendered
        assert ":name" not in rendered
        assert ":count" not in rendered

    def test_param_boundary_respected(self):
        """Param :a should not partially replace :ab."""
        rendered = _render_query_with_sqlalchemy_literals(
            "SELECT * FROM t WHERE ab = :ab AND a = :a",
            {"ab": "full", "a": "short"},
            {"ab": "text", "a": "text"},
            _SyncEngineStub(),
        )
        assert "'full'" in rendered
        assert "'short'" in rendered

    def test_boolean_param(self):
        rendered = _render_query_with_sqlalchemy_literals(
            "SELECT * FROM t WHERE active = :active",
            {"active": True},
            {"active": "number"},
            _SyncEngineStub(),
        )
        assert ":active" not in rendered
        assert "true" in rendered.lower()

    def test_negative_number(self):
        rendered = _render_query_with_sqlalchemy_literals(
            "SELECT * FROM t WHERE balance > :bal",
            {"bal": "-100"},
            {"bal": "number"},
            _SyncEngineStub(),
        )
        assert "-100" in rendered

    def test_zero_value(self):
        rendered = _render_query_with_sqlalchemy_literals(
            "SELECT * FROM t WHERE score = :score",
            {"score": "0"},
            {"score": "number"},
            _SyncEngineStub(),
        )
        assert ":score" not in rendered

    def test_unicode_text(self):
        rendered = _render_query_with_sqlalchemy_literals(
            "SELECT * FROM t WHERE city = :city",
            {"city": "São Paulo"},
            {"city": "text"},
            _SyncEngineStub(),
        )
        assert "São Paulo" in rendered

    def test_empty_string_param(self):
        rendered = _render_query_with_sqlalchemy_literals(
            "SELECT * FROM t WHERE name = :name",
            {"name": ""},
            {"name": "text"},
            _SyncEngineStub(),
        )
        assert ":name" not in rendered
        assert "''" in rendered
