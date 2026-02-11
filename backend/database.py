def infer_type_from_value(value) -> str:
    """Infer SQL type from Python value."""
    import datetime

    if value is None:
        return 'NULL'
    elif isinstance(value, bool):
        return 'BOOLEAN'
    elif isinstance(value, datetime.datetime):
        return 'TIMESTAMP'
    elif isinstance(value, datetime.date):
        return 'DATE'
    elif isinstance(value, datetime.time):
        return 'TIME'
    elif isinstance(value, int):
        return 'BIGINT'
    elif isinstance(value, float):
        return 'DOUBLE'
    elif isinstance(value, str):
        return 'VARCHAR'
    elif isinstance(value, bytes):
        return 'BLOB'
    else:
        return 'UNKNOWN'
