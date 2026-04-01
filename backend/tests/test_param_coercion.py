"""Tests for asyncpg parameter type coercion.

_coerce_params_for_asyncpg coerces parameter values based on the declared
parameter type sent from the frontend ('date', 'number', 'text'):

  date   — string → datetime.date or datetime.datetime
  number — string → int or float
  text   — no coercion (string stays string)
  (none) — no coercion (no declared type)
"""

from datetime import date, datetime
from main import _coerce_params_for_asyncpg


# ---------------------------------------------------------------------------
# 'date' type — string must be converted to Python date/datetime
# ---------------------------------------------------------------------------

def test_date_type_iso_date_string_becomes_date():
    result = _coerce_params_for_asyncpg({'start_date': '2026-03-01'}, {'start_date': 'date'})
    assert result['start_date'] == date(2026, 3, 1)
    assert type(result['start_date']) is date


def test_date_type_iso_datetime_t_separator_becomes_datetime():
    result = _coerce_params_for_asyncpg({'created_at': '2026-03-01T12:30:00'}, {'created_at': 'date'})
    assert result['created_at'] == datetime(2026, 3, 1, 12, 30, 0)
    assert type(result['created_at']) is datetime


def test_date_type_iso_datetime_space_separator_becomes_datetime():
    result = _coerce_params_for_asyncpg({'end_date': '2026-03-01 12:30:00'}, {'end_date': 'date'})
    assert type(result['end_date']) is datetime


def test_date_type_already_date_object_unchanged():
    d = date(2026, 1, 1)
    result = _coerce_params_for_asyncpg({'start_date': d}, {'start_date': 'date'})
    assert result['start_date'] is d


# ---------------------------------------------------------------------------
# 'number' type — string must be converted to int or float
# ---------------------------------------------------------------------------

def test_number_type_integer_string_becomes_int():
    result = _coerce_params_for_asyncpg({'min_amount': '100'}, {'min_amount': 'number'})
    assert result['min_amount'] == 100
    assert type(result['min_amount']) is int


def test_number_type_float_string_becomes_float():
    result = _coerce_params_for_asyncpg({'threshold': '3.14'}, {'threshold': 'number'})
    assert result['threshold'] == 3.14
    assert type(result['threshold']) is float


def test_number_type_already_int_unchanged():
    result = _coerce_params_for_asyncpg({'min_amount': 100}, {'min_amount': 'number'})
    assert result['min_amount'] == 100
    assert type(result['min_amount']) is int


# ---------------------------------------------------------------------------
# 'text' type — string must stay as string (no coercion)
# ---------------------------------------------------------------------------

def test_text_type_plain_string_unchanged():
    result = _coerce_params_for_asyncpg({'name_val': 'Alice'}, {'name_val': 'text'})
    assert result['name_val'] == 'Alice'
    assert type(result['name_val']) is str


def test_text_type_date_looking_string_not_converted():
    """Critical: TEXT column with date-like value must never be coerced."""
    result = _coerce_params_for_asyncpg({'reference_code': '2024-01-01'}, {'reference_code': 'text'})
    assert result['reference_code'] == '2024-01-01'
    assert type(result['reference_code']) is str


def test_text_type_numeric_looking_string_not_converted():
    """TEXT column with numeric-looking value must stay a string."""
    result = _coerce_params_for_asyncpg({'zip_code': '10001'}, {'zip_code': 'text'})
    assert result['zip_code'] == '10001'
    assert type(result['zip_code']) is str


# ---------------------------------------------------------------------------
# No declared type — nothing is coerced
# ---------------------------------------------------------------------------

def test_no_type_info_date_string_not_converted():
    result = _coerce_params_for_asyncpg({'start_date': '2026-03-01'}, {})
    assert result['start_date'] == '2026-03-01'
    assert type(result['start_date']) is str


# ---------------------------------------------------------------------------
# Mixed payload — each param coerced only according to its own declared type
# ---------------------------------------------------------------------------

def test_mixed_params_coerced_per_declared_type():
    params = {
        'start_date': '2026-03-01',       # date   → date
        'end_ts': '2026-12-31T23:59:59',  # date   → datetime
        'min_amount': '50',               # number → int
        'threshold': '9.5',               # number → float
        'name_val': 'Alice',              # text   → str (unchanged)
        'reference_code': '2024-01-01',   # text   → str (unchanged, not a date)
    }
    types = {
        'start_date': 'date',
        'end_ts': 'date',
        'min_amount': 'number',
        'threshold': 'number',
        'name_val': 'text',
        'reference_code': 'text',
    }
    result = _coerce_params_for_asyncpg(params, types)

    assert type(result['start_date']) is date
    assert type(result['end_ts']) is datetime
    assert result['min_amount'] == 50 and type(result['min_amount']) is int
    assert result['threshold'] == 9.5 and type(result['threshold']) is float
    assert result['name_val'] == 'Alice' and type(result['name_val']) is str
    assert result['reference_code'] == '2024-01-01' and type(result['reference_code']) is str
