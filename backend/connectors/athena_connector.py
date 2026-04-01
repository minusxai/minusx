"""Sync Athena connector using PyAthena SQLAlchemy dialect for queries and boto3 Glue for schema"""

from .base import DatabaseConnector
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool
from urllib.parse import quote_plus
import boto3


class AthenaConnector(DatabaseConnector):
    """AWS Athena database connector.

    Uses PyAthena's REST dialect for query execution and boto3 Glue client
    for schema retrieval (faster than querying information_schema through Athena).
    """

    def _get_boto_kwargs(self) -> dict:
        """Build common boto3 kwargs from config. Omits credentials when not provided (falls back to IAM role)."""
        kwargs = {"region_name": self.config.get("region_name", "us-east-1")}
        key_id = self.config.get("aws_access_key_id", "")
        secret = self.config.get("aws_secret_access_key", "")
        if key_id and secret:
            kwargs["aws_access_key_id"] = key_id
            kwargs["aws_secret_access_key"] = secret
        return kwargs

    def _get_glue_client(self):
        return boto3.client("glue", **self._get_boto_kwargs())

    def get_engine(self):
        if not self._engine:
            region = self.config.get("region_name", "us-east-1")
            s3_staging_dir = self.config.get("s3_staging_dir", "")
            schema_name = self.config.get("schema_name", "default")
            work_group = self.config.get("work_group", "primary")
            key_id = self.config.get("aws_access_key_id", "")
            secret = self.config.get("aws_secret_access_key", "")

            if key_id and secret:
                encoded_secret = quote_plus(secret)
                url = (
                    f"awsathena+rest://{key_id}:{encoded_secret}"
                    f"@athena.{region}.amazonaws.com:443/{schema_name}"
                    f"?s3_staging_dir={quote_plus(s3_staging_dir)}&work_group={work_group}"
                )
            else:
                # No explicit credentials — rely on IAM role / environment
                url = (
                    f"awsathena+rest://@athena.{region}.amazonaws.com:443/{schema_name}"
                    f"?s3_staging_dir={quote_plus(s3_staging_dir)}&work_group={work_group}"
                )

            self._engine = create_engine(url, poolclass=NullPool)
        return self._engine

    def test_connection(self) -> dict:
        try:
            engine = self.get_engine()
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return {"success": True, "message": "Connection successful"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def get_schema(self):
        """Retrieve schema from AWS Glue Data Catalog.

        Uses boto3 Glue client directly (faster and more reliable than
        querying information_schema through Athena, which incurs query cost).
        Returns the standard nested structure:
            [{schema, tables: [{table, columns: [{name, type}]}]}]
        """
        try:
            glue = self._get_glue_client()
            schemas = []

            paginator = glue.get_paginator("get_databases")
            for page in paginator.paginate():
                for db in page.get("DatabaseList", []):
                    db_name = db["Name"]
                    if db_name in ("information_schema",):
                        continue

                    tables = []
                    try:
                        tbl_paginator = glue.get_paginator("get_tables")
                        for tbl_page in tbl_paginator.paginate(DatabaseName=db_name):
                            for tbl in tbl_page.get("TableList", []):
                                cols = []
                                storage = tbl.get("StorageDescriptor", {})
                                for col in storage.get("Columns", []):
                                    cols.append({"name": col["Name"], "type": col["Type"]})
                                # Also include partition keys as columns
                                for pk in tbl.get("PartitionKeys", []):
                                    cols.append({"name": pk["Name"], "type": pk["Type"]})
                                tables.append({"table": tbl["Name"], "columns": cols})
                    except Exception as e:
                        print(f"[AthenaConnector] Error fetching tables for {db_name}: {e}")

                    schemas.append({"schema": db_name, "tables": tables})

            return schemas

        except Exception as e:
            print(f"[AthenaConnector] Error fetching schema: {e}")
            return []

    def validate_config(self) -> dict:
        errors = []

        if not self.config.get("region_name"):
            errors.append("region_name is required")

        if not self.config.get("s3_staging_dir"):
            errors.append("s3_staging_dir is required (e.g. s3://my-bucket/results/)")
        else:
            s3_dir = self.config["s3_staging_dir"]
            if not s3_dir.startswith("s3://"):
                errors.append("s3_staging_dir must start with s3://")

        # Credentials must be provided together or not at all
        key_id = self.config.get("aws_access_key_id", "")
        secret = self.config.get("aws_secret_access_key", "")
        if bool(key_id) != bool(secret):
            errors.append("Both aws_access_key_id and aws_secret_access_key must be provided together (or both omitted for IAM role)")

        return {"valid": len(errors) == 0, "errors": errors}
