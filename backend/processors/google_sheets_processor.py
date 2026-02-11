"""
Google Sheets Processor Module

Handles Google Sheets import and processing.
Downloads public Google Sheets as xlsx, extracts sheets as CSV,
then uses the CSV processor to create a DuckDB database.

Storage Structure (same as CSV):
    data/
      csv_connections/
        {company_id}/
          {mode}/
            {connection_name}/
              files/
                sheet1.csv
                sheet2.csv
              database.duckdb
"""

import re
import io
import httpx
from pathlib import Path
from typing import Dict, Any, List, Tuple
import pandas as pd
from .csv_processor import process_csv_upload, delete_csv_connection, get_csv_connection_info


def parse_spreadsheet_id(url: str) -> str:
    """
    Extract spreadsheet ID from various Google Sheets URL formats.

    Supported formats:
    - https://docs.google.com/spreadsheets/d/{ID}/edit
    - https://docs.google.com/spreadsheets/d/{ID}/
    - https://docs.google.com/spreadsheets/d/{ID}/edit#gid=0
    - https://docs.google.com/spreadsheets/d/{ID}

    Args:
        url: Google Sheets URL

    Returns:
        Spreadsheet ID string

    Raises:
        ValueError: If URL format is invalid
    """
    # Pattern to match Google Sheets URLs
    pattern = r'https://docs\.google\.com/spreadsheets/d/([a-zA-Z0-9_-]+)'
    match = re.search(pattern, url)

    if not match:
        raise ValueError(
            "Invalid Google Sheets URL. Expected format: "
            "https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/..."
        )

    return match.group(1)


async def download_xlsx(spreadsheet_id: str) -> bytes:
    """
    Download entire spreadsheet as xlsx via Google's export endpoint.

    Args:
        spreadsheet_id: Google Sheets spreadsheet ID

    Returns:
        xlsx file content as bytes

    Raises:
        ValueError: If sheet is not public or not found
        RuntimeError: If download fails
    """
    export_url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=xlsx"

    async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as client:
        try:
            response = await client.get(export_url)

            if response.status_code == 404:
                raise ValueError(
                    "Spreadsheet not found. Please check the URL is correct."
                )

            if response.status_code == 403 or response.status_code == 401:
                raise ValueError(
                    "Cannot access spreadsheet. Please ensure the sheet is shared as "
                    "'Anyone with the link can view' (public access required)."
                )

            if response.status_code != 200:
                raise RuntimeError(
                    f"Failed to download spreadsheet: HTTP {response.status_code}"
                )

            # Check content type to ensure we got xlsx, not HTML error page
            content_type = response.headers.get('content-type', '')
            if 'text/html' in content_type:
                raise ValueError(
                    "Cannot access spreadsheet. Please ensure the sheet is shared as "
                    "'Anyone with the link can view' (public access required)."
                )

            return response.content

        except httpx.TimeoutException:
            raise RuntimeError(
                "Timeout downloading spreadsheet. The file may be too large or "
                "Google Sheets is slow to respond. Please try again."
            )
        except httpx.RequestError as e:
            raise RuntimeError(f"Network error downloading spreadsheet: {str(e)}")


def xlsx_to_csv_files(xlsx_bytes: bytes, output_dir: Path) -> List[Tuple[str, Path]]:
    """
    Parse xlsx file and save each sheet as a CSV file.

    Args:
        xlsx_bytes: xlsx file content as bytes
        output_dir: Directory to save CSV files

    Returns:
        List of (sheet_name, csv_path) tuples

    Raises:
        RuntimeError: If xlsx parsing fails
    """
    try:
        # Create output directory if needed
        output_dir.mkdir(parents=True, exist_ok=True)

        # Parse xlsx with pandas (using openpyxl engine)
        xlsx_file = io.BytesIO(xlsx_bytes)
        xlsx = pd.ExcelFile(xlsx_file, engine='openpyxl')

        result = []
        for sheet_name in xlsx.sheet_names:
            # Read sheet into DataFrame
            df = pd.read_excel(xlsx, sheet_name=sheet_name)

            # Skip empty sheets
            if df.empty:
                print(f"[Google Sheets] Skipping empty sheet: {sheet_name}")
                continue

            # Sanitize sheet name for filename
            safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', sheet_name)
            safe_name = safe_name[:50]  # Truncate long names
            csv_filename = f"{safe_name}.csv"
            csv_path = output_dir / csv_filename

            # Save as CSV
            df.to_csv(csv_path, index=False)

            result.append((csv_filename, csv_path))
            print(f"[Google Sheets] Extracted sheet '{sheet_name}' -> {csv_filename}")

        if not result:
            raise ValueError("No non-empty sheets found in the spreadsheet")

        return result

    except pd.errors.EmptyDataError:
        raise ValueError("Spreadsheet contains no data")
    except Exception as e:
        if isinstance(e, ValueError):
            raise
        raise RuntimeError(f"Failed to parse xlsx file: {str(e)}")


async def process_google_sheets_import(
    company_id: int,
    mode: str,
    connection_name: str,
    spreadsheet_url: str,
    replace_existing: bool = False
) -> Dict[str, Any]:
    """
    Main entry point for Google Sheets import.

    Downloads the spreadsheet as xlsx, extracts sheets as CSV files,
    then uses the CSV processor to create a DuckDB database.

    Args:
        company_id: Company ID for multi-tenant isolation
        mode: Mode for isolation (org, tutorial, etc.)
        connection_name: Name of the connection
        spreadsheet_url: Public Google Sheets URL
        replace_existing: If True, replace existing data; if False, error on existing

    Returns:
        Dict with:
        - spreadsheet_url: Original URL
        - spreadsheet_id: Extracted spreadsheet ID
        - generated_db_path: Relative path to the generated DuckDB file
        - files: List of file metadata (filename, table_name, row_count, columns)

    Raises:
        ValueError: If URL is invalid or sheet is not accessible
        RuntimeError: If processing fails
    """
    import tempfile
    import shutil

    # Parse spreadsheet ID from URL
    spreadsheet_id = parse_spreadsheet_id(spreadsheet_url)
    print(f"[Google Sheets] Processing spreadsheet: {spreadsheet_id}")

    # Download xlsx
    print(f"[Google Sheets] Downloading spreadsheet...")
    xlsx_bytes = await download_xlsx(spreadsheet_id)
    print(f"[Google Sheets] Downloaded {len(xlsx_bytes)} bytes")

    # Create temporary directory for CSV extraction (outside of connection directory)
    temp_dir = tempfile.mkdtemp(prefix=f"gsheets_{connection_name}_")
    temp_files_dir = Path(temp_dir)

    try:
        # Extract sheets as CSV files
        print(f"[Google Sheets] Extracting sheets to CSV...")
        csv_files = xlsx_to_csv_files(xlsx_bytes, temp_files_dir)
        print(f"[Google Sheets] Extracted {len(csv_files)} sheets")

        # Read CSV file contents
        files_data = []
        for csv_filename, csv_path in csv_files:
            with open(csv_path, 'rb') as f:
                content = f.read()
            files_data.append((csv_filename, content))

        # Use CSV processor to create DuckDB database
        print(f"[Google Sheets] Creating DuckDB database...")
        result = await process_csv_upload(
            company_id=company_id,
            mode=mode,
            connection_name=connection_name,
            files=files_data,
            replace_existing=replace_existing
        )

        # Add Google Sheets-specific metadata
        result['spreadsheet_url'] = spreadsheet_url
        result['spreadsheet_id'] = spreadsheet_id

        print(f"[Google Sheets] Successfully created database with {len(result['files'])} tables")
        return result

    finally:
        # Clean up temporary directory
        if temp_files_dir.exists():
            shutil.rmtree(temp_files_dir)


def delete_google_sheets_connection(company_id: int, mode: str, connection_name: str) -> bool:
    """
    Delete a Google Sheets connection's data.
    This is the same as deleting CSV connection data since they share storage.

    Args:
        company_id: Company ID
        mode: Mode for isolation
        connection_name: Connection name

    Returns:
        True if data was deleted, False if connection didn't exist
    """
    return delete_csv_connection(company_id, mode, connection_name)


def get_google_sheets_connection_info(company_id: int, mode: str, connection_name: str) -> Dict[str, Any] | None:
    """
    Get info about an existing Google Sheets connection.
    This reuses the CSV connection info function since they share storage.

    Returns None if connection doesn't exist.
    """
    return get_csv_connection_info(company_id, mode, connection_name)
