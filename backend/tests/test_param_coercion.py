"""Tests for asyncpg parameter type coercion."""

from datetime import date, datetime
from main import _coerce_params_for_asyncpg


# ---------------------------------------------------------------------------
# Params with type declared as 'date' — should be coerced
# ---------------------------------------------------------------------------

def test_date_string_converted_to_date_object():
    result = _coerce_params_for_asyncpg({'start_date': '2026-03-01'}, {'start_date': 'date'})
    assert result['start_date'] == date(2026, 3, 1)
    assert isinstance(result['start_date'], date)


def test_datetime_t_separator_converted():
    result = _coerce_params_for_asyncpg({'created_at': '2026-03-01T12:30:00'}, {'created_at': 'date'})
    assert isinstance(result['created_at'], datetime)
    assert result['created_at'] == datetime(2026, 3, 1, 12, 30, 0)


def test_datetime_space_separator_converted():
    result = _coerce_params_for_asyncpg({'end_date': '2026-03-01 12:30:00'}, {'end_date': 'date'})
    assert isinstance(result['end_date'], datetime)


# ---------------------------------------------------------------------------
# Params with type NOT declared as 'date' — must NOT be coerced
# ---------------------------------------------------------------------------

def test_number_param_unchanged():
    result = _coerce_params_for_asyncpg({'min_amount': 100}, {'min_amount': 'number'})
    assert result['min_amount'] == 100
    assert isinstance(result['min_amount'], int)


def test_text_param_unchanged():
    result = _coerce_params_for_asyncpg({'name_val': 'Alice'}, {'name_val': 'text'})
    assert result['name_val'] == 'Alice'


def test_date_looking_string_with_text_type_not_converted():
    """A TEXT-typed param whose value looks like a date must stay a string."""
    result = _coerce_params_for_asyncpg({'reference_code': '2024-01-01'}, {'reference_code': 'text'})
    assert result['reference_code'] == '2024-01-01'
    assert isinstance(result['reference_code'], str)


def test_no_type_info_string_not_converted():
    """When parameter_types is empty, nothing is coerced."""
    result = _coerce_params_for_asyncpg({'start_date': '2026-03-01'}, {})
    assert result['start_date'] == '2026-03-01'
    assert isinstance(result['start_date'], str)


def test_already_date_object_unchanged():
    d = date(2026, 1, 1)
    result = _coerce_params_for_asyncpg({'start_date': d}, {'start_date': 'date'})
    assert result['start_date'] is d


# ---------------------------------------------------------------------------
# Mixed payload
# ---------------------------------------------------------------------------

def test_mixed_params_coerced_selectively():
    params = {
        'start_date': '2026-03-01',
        'end_ts': '2026-12-31T23:59:59',
        'min_amount': 50,
        'name_val': 'Alice',
        'reference_code': '2024-01-01',
    }
    types = {
        'start_date': 'date',
        'end_ts': 'date',
        'min_amount': 'number',
        'name_val': 'text',
        'reference_code': 'text',
    }
    result = _coerce_params_for_asyncpg(params, types)
    assert isinstance(result['start_date'], date)
    assert isinstance(result['end_ts'], datetime)
    assert result['min_amount'] == 50
    assert result['name_val'] == 'Alice'
    assert result['reference_code'] == '2024-01-01'
    assert isinstance(result['reference_code'], str)
