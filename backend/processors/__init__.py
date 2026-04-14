"""
Data processors for importing external data sources.
"""

from .csv_processor import (
    process_csv_from_s3,
    sanitize_table_name,
    ensure_unique_table_names,
    detect_file_format,
)

from .google_sheets_processor import (
    process_google_sheets_import,
    delete_google_sheets_connection,
    get_google_sheets_connection_info,
    parse_spreadsheet_id,
)

__all__ = [
    # CSV (S3-backed)
    'process_csv_from_s3',
    'sanitize_table_name',
    'ensure_unique_table_names',
    'detect_file_format',
    # Google Sheets
    'process_google_sheets_import',
    'delete_google_sheets_connection',
    'get_google_sheets_connection_info',
    'parse_spreadsheet_id',
]
