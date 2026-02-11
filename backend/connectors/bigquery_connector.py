from .base import DatabaseConnector
from . import register_connector
from sqlalchemy import create_engine, text
from google.cloud import bigquery
from google.oauth2 import service_account
import json


@register_connector('bigquery')
class BigQueryConnector(DatabaseConnector):
    """Google BigQuery database connector"""

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
        Get BigQuery schema using native google-cloud-bigquery library.
        Returns list of datasets (schemas) with their tables and columns.
        """
        try:
            service_account_json = self.config.get('service_account_json')
            project_id = self.config.get('project_id')

            # Parse credentials JSON
            credentials_dict = json.loads(service_account_json)
            credentials = service_account.Credentials.from_service_account_info(credentials_dict)

            # Create BigQuery client
            client = bigquery.Client(project=project_id, credentials=credentials)

            schemas = []

            # List all datasets (BigQuery equivalent of schemas)
            datasets = list(client.list_datasets())

            for dataset in datasets:
                dataset_id = dataset.dataset_id
                dataset_ref = client.dataset(dataset_id)

                tables = []

                # List all tables in the dataset
                tables_list = list(client.list_tables(dataset_ref))

                for table_item in tables_list:
                    table_ref = dataset_ref.table(table_item.table_id)
                    table = client.get_table(table_ref)

                    columns = []

                    # Get column information from table schema
                    for field in table.schema:
                        columns.append({
                            "name": field.name,
                            "type": field.field_type
                        })

                    tables.append({
                        "table": table_item.table_id,
                        "columns": columns
                    })

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
