import { getTimestamp } from '@/lib/chart/chart-utils'

const escapeCsvValue = (val: string | number) => {
  const str = String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Serialize a raw query result (every column, every row) to a CSV string — the chart
 * "download data" export. Nulls become empty cells; values are CSV-escaped. Pure, so the
 * V2 download menu and any future exporter share one deterministic, testable serializer.
 */
export const queryResultToCsv = (columns: string[], rows: Array<Record<string, unknown>>): string => {
  const cell = (v: unknown): string | number => (v == null ? '' : typeof v === 'number' ? v : String(v));
  const line = (cells: Array<string | number>) => cells.map(escapeCsvValue).join(',');
  return [line(columns), ...rows.map(r => line(columns.map(c => cell(r[c]))))].join('\n');
};

/** Trigger a browser download of a CSV string. Browser-only. */
export const downloadCsvString = (csv: string, filename: string) => {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const downloadChartCsv = (headers: string[], rows: Array<Array<string | number>>) => {
  const csvContent = [
    headers.map(escapeCsvValue).join(','),
    ...rows.map(row => row.map(escapeCsvValue).join(',')),
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `chart-${getTimestamp()}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
