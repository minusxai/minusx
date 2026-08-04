/**
 * Postgres type-OID → type-name mapping, shared by every connector that reads
 * pg-wire field metadata (PostgresConnector via the `pg` driver,
 * InternalDbConnector via the adapter's `QueryResult.fields`). Originally
 * inlined in postgres-connector.ts; extracted when internal_db needed the same
 * mapping to stop reporting every column as 'text'.
 */
export const PG_OID_TO_TYPE: Record<number, string> = {
  16:   'boolean',
  17:   'bytea',
  20:   'bigint',
  21:   'smallint',
  23:   'integer',
  25:   'text',
  114:  'json',
  700:  'real',
  701:  'double precision',
  1042: 'character',
  1043: 'character varying',
  1082: 'date',
  1114: 'timestamp without time zone',
  1184: 'timestamp with time zone',
  1186: 'interval',
  1700: 'numeric',
  2950: 'uuid',
  3802: 'jsonb',
};

/** Type name for an OID; unknown OIDs fall back to 'text'. */
export function pgOidToTypeName(oid: number): string {
  return PG_OID_TO_TYPE[oid] ?? 'text';
}
