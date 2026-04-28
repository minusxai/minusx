export type ConnectionTypeOption = {
  type: 'bigquery' | 'postgresql' | 'csv' | 'xlsx' | 'google-sheets' | 'athena' | 'clickhouse' | 'databricks' | 'snowflake';
  name: string;
  logo: string;
  comingSoon: boolean;
  group: 'external-engine' | 'minusx-warehouse' | 'coming-soon';
  description: string;
  note?: string;
  redirectToStatic?: boolean;
  isStatic?: boolean;
};

export const CONNECTION_TYPES: ConnectionTypeOption[] = [
  {
    type: 'bigquery',
    name: 'BigQuery',
    logo: '/logos/bigquery.svg',
    comingSoon: false,
    group: 'external-engine',
    description: 'Connect to your Google Cloud warehouse. Data stays in BigQuery.',
  },
  {
    type: 'postgresql',
    name: 'PostgreSQL',
    logo: '/logos/postgresql.svg',
    comingSoon: false,
    group: 'external-engine',
    description: 'Query your Postgres database or warehouse directly.',
  },
  {
    type: 'athena',
    name: 'Athena',
    logo: '/logos/athena.svg',
    comingSoon: false,
    group: 'external-engine',
    description: 'Use AWS Athena over your Glue catalog and S3 data.',
  },
  {
    type: 'csv',
    name: 'CSV',
    logo: '/logos/csv.svg',
    comingSoon: false,
    group: 'minusx-warehouse',
    description: 'Upload CSV files into the MinusX managed warehouse.',
    redirectToStatic: true,
    isStatic: true,
  },
  {
    type: 'xlsx',
    name: 'Excel Workbook',
    logo: '/logos/xlsx.svg',
    comingSoon: false,
    group: 'minusx-warehouse',
    description: 'Upload Excel spreadsheets into the MinusX managed warehouse.',
    redirectToStatic: true,
    isStatic: true,
  },
  {
    type: 'google-sheets',
    name: 'Google Sheets',
    logo: '/logos/google-sheets.svg',
    comingSoon: false,
    group: 'minusx-warehouse',
    description: 'Import a public sheet into the MinusX managed warehouse.',
    redirectToStatic: true,
    isStatic: true,
    note: 'Sheet needs to be public',
  },
  {
    type: 'clickhouse',
    name: 'ClickHouse',
    logo: '/logos/clickhouse.svg',
    comingSoon: true,
    group: 'coming-soon',
    description: 'Native ClickHouse connections are planned.',
  },
  {
    type: 'databricks',
    name: 'Databricks',
    logo: '/logos/databricks.svg',
    comingSoon: true,
    group: 'coming-soon',
    description: 'Databricks SQL Warehouse support is planned.',
  },
  {
    type: 'snowflake',
    name: 'Snowflake',
    logo: '/logos/snowflake.svg',
    comingSoon: true,
    group: 'coming-soon',
    description: 'Snowflake warehouse support is planned.',
  },
];

export const CONNECTION_TYPE_GROUPS = [
  {
    id: 'external-engine',
    title: 'Your Engine',
    description: 'MinusX connects to your existing database or warehouse and queries it in place.',
  },
  {
    id: 'minusx-warehouse',
    title: 'MinusX Warehouse',
    description: 'For files, public sheets, and APIs, MinusX creates and manages the warehouse for you.',
  },
  {
    id: 'coming-soon',
    title: 'Coming Soon',
    description: 'These engines are visible so teams can see what is planned next.',
  },
] as const;
