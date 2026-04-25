import 'server-only';

export type ColumnClassification =
  | 'categorical'
  | 'numeric'
  | 'temporal'
  | 'id_unique'
  | 'boolean'
  | 'text'
  | 'unknown';

export interface TopValue {
  value: string | number | boolean;
  count: number;
  fraction: number;
}

export interface ColumnStatistics {
  name: string;
  type: string;
  classification: ColumnClassification;
  description?: string;
  nullCount: number;
  nDistinct: number;
  cardinalityRatio: number;
  /** Top values with counts — categorical columns only */
  topValues?: TopValue[];
  /** Min/max/avg — numeric columns */
  min?: number | string;
  max?: number | string;
  avg?: number;
  /** Min/max dates — temporal columns */
  minDate?: string;
  maxDate?: string;
}

export interface TableStatistics {
  schema: string;
  table: string;
  rowCount: number;
  columns: ColumnStatistics[];
}

export interface DatabaseStatistics {
  tables: TableStatistics[];
  generatedAt: string;
  connectorType: string;
  queryCount: number;
}
