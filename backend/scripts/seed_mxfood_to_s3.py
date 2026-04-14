"""One-time script: read mxfood.duckdb and upload all tables as Parquet to S3.

Usage:
    cd backend
    uv run python scripts/seed_mxfood_to_s3.py

Required environment variables:
    OBJECT_STORE_BUCKET              — S3 bucket name (required)
    OBJECT_STORE_REGION              — AWS region (default: us-east-1)
    OBJECT_STORE_ACCESS_KEY_ID       — AWS access key
    OBJECT_STORE_SECRET_ACCESS_KEY   — AWS secret key
    OBJECT_STORE_ENDPOINT            — Custom endpoint (optional, for MinIO/R2)

Optional:
    BASE_DUCKDB_DATA_PATH            — Base directory for resolving DuckDB paths (default: ..)
"""

import os
import sys

import duckdb


def resolve_duckdb_path(file_path: str) -> str:
    base = os.environ.get("BASE_DUCKDB_DATA_PATH", "..")
    if os.path.isabs(file_path):
        return file_path
    return os.path.normpath(os.path.join(base, file_path))


def main() -> None:
    bucket = os.environ.get("OBJECT_STORE_BUCKET")
    if not bucket:
        print("ERROR: OBJECT_STORE_BUCKET environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    region = os.environ.get("OBJECT_STORE_REGION", "us-east-1")
    access_key = os.environ.get("OBJECT_STORE_ACCESS_KEY_ID", "")
    secret_key = os.environ.get("OBJECT_STORE_SECRET_ACCESS_KEY", "")
    endpoint = os.environ.get("OBJECT_STORE_ENDPOINT", "")

    db_path = resolve_duckdb_path("data/mxfood.duckdb")
    print(f"Opening DuckDB: {db_path}")

    con = duckdb.connect(db_path, read_only=True)

    # Install and load httpfs for S3 support
    con.execute("INSTALL httpfs")
    con.execute("LOAD httpfs")

    # Configure S3 credentials
    con.execute(f"SET s3_region = '{region}'")
    con.execute(f"SET s3_access_key_id = '{access_key}'")
    con.execute(f"SET s3_secret_access_key = '{secret_key}'")
    if endpoint:
        con.execute(f"SET s3_endpoint = '{endpoint}'")
        con.execute("SET s3_url_style = 'path'")

    # Enumerate all user tables in the main schema
    tables_result = con.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = 'main' AND table_type = 'BASE TABLE' "
        "ORDER BY table_name"
    ).fetchall()

    tables = [row[0] for row in tables_result]
    if not tables:
        print("No tables found in main schema of mxfood.duckdb.", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(tables)} tables: {', '.join(tables)}")
    print()

    succeeded = []
    failed = []

    for table in tables:
        s3_path = f"s3://{bucket}/seeds/mxfood/{table}.parquet"
        print(f"  Uploading {table} → {s3_path} ...", end=" ", flush=True)
        try:
            con.execute(
                f'COPY (SELECT * FROM main."{table}") TO \'{s3_path}\' (FORMAT PARQUET)'
            )
            print("OK")
            succeeded.append(table)
        except Exception as exc:
            print(f"FAILED: {exc}")
            failed.append((table, str(exc)))

    con.close()

    print()
    print(f"Done. {len(succeeded)}/{len(tables)} tables uploaded successfully.")
    if succeeded:
        print(f"  Succeeded: {', '.join(succeeded)}")
    if failed:
        print(f"  Failed: {', '.join(t for t, _ in failed)}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
