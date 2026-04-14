"""
Google Sheets Processor Module

Downloads a public Google Sheet as xlsx, converts each tab to CSV bytes,
uploads them to S3, then delegates to process_csv_from_s3 for metadata.

No local DuckDB files are created — all data lives in S3, same as the CSV
processor.
"""

import re
import io
import uuid
import asyncio
import httpx
import boto3
import pandas as pd
from typing import Dict, Any, List, Tuple

from config import (
    OBJECT_STORE_BUCKET,
    OBJECT_STORE_REGION,
    OBJECT_STORE_ACCESS_KEY_ID,
    OBJECT_STORE_SECRET_ACCESS_KEY,
    OBJECT_STORE_ENDPOINT,
)
from .csv_processor import process_csv_from_s3


# ---------------------------------------------------------------------------
# S3 upload helper
# ---------------------------------------------------------------------------

def _upload_bytes_to_s3(s3_key: str, data: bytes, content_type: str = 'text/csv') -> None:
    """Upload raw bytes to S3 at the given key."""
    kwargs: Dict[str, Any] = dict(
        region_name=OBJECT_STORE_REGION,
        aws_access_key_id=OBJECT_STORE_ACCESS_KEY_ID or None,
        aws_secret_access_key=OBJECT_STORE_SECRET_ACCESS_KEY or None,
    )
    if OBJECT_STORE_ENDPOINT:
        kwargs['endpoint_url'] = OBJECT_STORE_ENDPOINT

    s3 = boto3.client('s3', **kwargs)
    s3.put_object(
        Bucket=OBJECT_STORE_BUCKET,
        Key=s3_key,
        Body=data,
        ContentType=content_type,
    )


# ---------------------------------------------------------------------------
# URL / download helpers (unchanged)
# ---------------------------------------------------------------------------

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

            if response.status_code in (401, 403):
                raise ValueError(
                    "Cannot access spreadsheet. Please ensure the sheet is shared as "
                    "'Anyone with the link can view' (public access required)."
                )

            if response.status_code != 200:
                raise RuntimeError(
                    f"Failed to download spreadsheet: HTTP {response.status_code}"
                )

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


# ---------------------------------------------------------------------------
# Public import function
# ---------------------------------------------------------------------------

async def process_google_sheets_import_s3(
    company_id: int,
    mode: str,
    connection_name: str,
    spreadsheet_url: str,
    schema_name: str = 'public',
    replace_existing: bool = False,
) -> Dict[str, Any]:
    """
    Download a public Google Sheet, upload each tab as a CSV to S3,
    then register via process_csv_from_s3 for metadata.
    Returns {files: [...], spreadsheet_url, spreadsheet_id}.
    """
    if not OBJECT_STORE_BUCKET:
        raise ValueError(
            "OBJECT_STORE_BUCKET is not configured. "
            "Set OBJECT_STORE_BUCKET env var to enable S3-backed Google Sheets connections."
        )

    spreadsheet_id = parse_spreadsheet_id(spreadsheet_url)
    print(f"[Google Sheets] Processing spreadsheet: {spreadsheet_id}")

    print("[Google Sheets] Downloading spreadsheet...")
    xlsx_bytes = await download_xlsx(spreadsheet_id)
    print(f"[Google Sheets] Downloaded {len(xlsx_bytes)} bytes")

    # Parse xlsx in a thread (pandas is blocking)
    def _parse_xlsx() -> List[Tuple[str, bytes]]:
        xlsx_file = io.BytesIO(xlsx_bytes)
        xl = pd.ExcelFile(xlsx_file, engine='openpyxl')
        result = []
        for sheet_name in xl.sheet_names:
            df = pd.read_excel(xl, sheet_name=sheet_name)
            if df.empty:
                print(f"[Google Sheets] Skipping empty sheet: {sheet_name}")
                continue
            safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', sheet_name)[:50]
            csv_filename = f"{safe_name}.csv"
            buf = io.StringIO()
            df.to_csv(buf, index=False)
            result.append((csv_filename, buf.getvalue().encode('utf-8')))
            print(f"[Google Sheets] Extracted sheet '{sheet_name}' -> {csv_filename}")
        if not result:
            raise ValueError("No non-empty sheets found in the spreadsheet")
        return result

    sheets = await asyncio.to_thread(_parse_xlsx)
    print(f"[Google Sheets] Extracted {len(sheets)} sheet(s)")

    # Upload each sheet CSV to S3
    files_list = []
    for csv_filename, csv_bytes in sheets:
        s3_key = f"{company_id}/csvs/{mode}/{connection_name}/{uuid.uuid4().hex}_{csv_filename}"
        print(f"[Google Sheets] Uploading {csv_filename} to s3://{OBJECT_STORE_BUCKET}/{s3_key}")
        await asyncio.to_thread(_upload_bytes_to_s3, s3_key, csv_bytes, 'text/csv')
        files_list.append({
            'filename': csv_filename,
            's3_key': s3_key,
            'schema_name': schema_name,
            'file_format': 'csv',
        })

    # Register with process_csv_from_s3 to read metadata
    result = await process_csv_from_s3(
        company_id=company_id,
        mode=mode,
        connection_name=connection_name,
        files=files_list,
        replace_existing=replace_existing,
    )

    result['spreadsheet_url'] = spreadsheet_url
    result['spreadsheet_id'] = spreadsheet_id

    print(f"[Google Sheets] Successfully processed {len(result['files'])} sheet(s)")
    return result


# ---------------------------------------------------------------------------
# Connection management helpers
# ---------------------------------------------------------------------------

def delete_google_sheets_connection(company_id: int, mode: str, connection_name: str) -> bool:
    """
    Delete a Google Sheets connection's S3 data.

    Lists and deletes all objects under the connection's S3 prefix.
    Returns True if any objects were deleted, False if none were found.
    """
    if not OBJECT_STORE_BUCKET:
        return False

    kwargs: Dict[str, Any] = dict(
        region_name=OBJECT_STORE_REGION,
        aws_access_key_id=OBJECT_STORE_ACCESS_KEY_ID or None,
        aws_secret_access_key=OBJECT_STORE_SECRET_ACCESS_KEY or None,
    )
    if OBJECT_STORE_ENDPOINT:
        kwargs['endpoint_url'] = OBJECT_STORE_ENDPOINT

    s3 = boto3.client('s3', **kwargs)
    prefix = f"{company_id}/csvs/{mode}/{connection_name}/"

    paginator = s3.get_paginator('list_objects_v2')
    keys_to_delete = []
    for page in paginator.paginate(Bucket=OBJECT_STORE_BUCKET, Prefix=prefix):
        for obj in page.get('Contents', []):
            keys_to_delete.append({'Key': obj['Key']})

    if not keys_to_delete:
        return False

    s3.delete_objects(
        Bucket=OBJECT_STORE_BUCKET,
        Delete={'Objects': keys_to_delete},
    )
    return True


def get_google_sheets_connection_info(company_id: int, mode: str, connection_name: str) -> Dict[str, Any] | None:
    """
    Get info about an existing Google Sheets connection.
    Returns None — metadata is now stored in the connection document itself.
    """
    return None
