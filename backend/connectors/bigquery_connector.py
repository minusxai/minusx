from .base import DatabaseConnector
from . import register_connector
from sqlalchemy import create_engine, text
from google.cloud import bigquery
from google.oauth2 import service_account
import json


@register_connector('bigquery')
class BigQueryConnector(DatabaseConnector):
    """Google BigQuery database connector"""

    def _get_client(self):
        service_account_json = self.config.get('service_account_json')
        project_id = self.config.get('project_id')
        credentials_dict = json.loads(service_account_json)
        credentials = service_account.Credentials.from_service_account_info(credentials_dict)
        return bigquery.Client(project=project_id, credentials=credentials)

    def get_engine(self):
        if not self._engine:
            service_account_json = self.config.get('service_account_json')
            project_id = self.config.get('project_id')

            # Parse credentials JSON
            credentials_dict = json.loads(service_account_json)

            # Create engine with credentials
            self._engine = create_engine(
                f"bigquery://{project_id}",
                credentials_info=credentials_dict
            )
        return self._engine

    def test_connection(self):
        try:
            engine = self.get_engine()
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return {"success": True, "message": "Connection successful"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def get_schema(self):
        """
        Get BigQuery schema using INFORMATION_SCHEMA.COLUMNS.
        One query per dataset instead of one API call per table.
        """
        try:
            client = self._get_client()
            project_id = self.config.get('project_id')

            schemas = []
            datasets = list(client.list_datasets())

            for dataset in datasets:
                dataset_id = dataset.dataset_id
                try:
                    query = f"""
                        SELECT table_name, column_name, data_type
                        FROM `{project_id}.{dataset_id}.INFORMATION_SCHEMA.COLUMNS`
                        ORDER BY table_name, ordinal_position
                    """
                    rows = client.query(query).result()

                    # Group columns by table
                    tables_dict = {}
                    for row in rows:
                        table_name = row.table_name
                        if table_name not in tables_dict:
                            tables_dict[table_name] = []
                        tables_dict[table_name].append({
                            "name": row.column_name,
                            "type": row.data_type
                        })

                    tables = [
                        {"table": table_name, "columns": columns}
                        for table_name, columns in tables_dict.items()
                    ]
                except Exception as e:
                    print(f"[BigQueryConnector] Error fetching schema for dataset {dataset_id}: {e}")
                    tables = []

                schemas.append({
                    "schema": dataset_id,
                    "tables": tables
                })

            return schemas

        except Exception as e:
            print(f"[BigQueryConnector] Error fetching schema: {e}")
            return []

    def validate_config(self):
        errors = []

        if 'service_account_json' not in self.config:
            errors.append("service_account_json is required")
        else:
            try:
                json.loads(self.config['service_account_json'])
            except Exception:
                errors.append("service_account_json must be valid JSON")

        if 'project_id' not in self.config:
            errors.append("project_id is required")

        return {"valid": len(errors) == 0, "errors": errors}
