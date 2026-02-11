import { executeQuery } from '../database/duckdb'

export interface HistogramBin {
  bin: number
  binMin: number
  binMax: number
  count: number
}

export async function calculateHistogram(
  tableName: string,
  column: string,
  columnType: 'number' | 'date',
  numBins: number = 20
): Promise<HistogramBin[]> {
  try {
    // For dates, convert to epoch (days or seconds)
    const valueExpr = columnType === 'date'
      ? `EPOCH(CAST("${column}" AS DATE))`
      : `"${column}"`

    const query = `
      WITH params AS (
        SELECT
          ${numBins} AS num_bins,
          MIN(${valueExpr}) AS min_val,
          MAX(${valueExpr}) AS max_val,
          (MAX(${valueExpr}) - MIN(${valueExpr})) / ${numBins} AS bin_width
        FROM ${tableName}
        WHERE "${column}" IS NOT NULL
      ),
      buckets AS (
        SELECT
          CASE
            WHEN ${valueExpr} = params.max_val THEN ${numBins - 1}
            ELSE FLOOR((${valueExpr} - params.min_val) / params.bin_width)
          END AS bucket_id,
          params.min_val,
          params.max_val,
          params.bin_width
        FROM ${tableName}, params
        WHERE "${column}" IS NOT NULL
      )
      SELECT
        bucket_id,
        COUNT(*) AS freq,
        MIN(min_val) as min_val,
        MIN(bin_width) as bin_width
      FROM buckets
      GROUP BY bucket_id
      ORDER BY bucket_id
    `

    const rows = await executeQuery<{
      bucket_id: number
      freq: number
      min_val: number
      bin_width: number
    }>(query)

    if (!rows.length) return []

    const min = Number(rows[0].min_val)
    const binWidth = Number(rows[0].bin_width)

    // Fill all bins (including empty ones)
    const histogram: HistogramBin[] = []
    for (let i = 0; i < numBins; i++) {
      const binData = rows.find(r => Number(r.bucket_id) === i)
      const binMin = min + i * binWidth
      const binMax = min + (i + 1) * binWidth
      histogram.push({
        bin: min + (i + 0.5) * binWidth, // bin center
        binMin,
        binMax,
        count: binData ? Number(binData.freq) : 0,
      })
    }

    return histogram
  } catch (error) {
    console.error('Error calculating histogram:', error)
    return []
  }
}
