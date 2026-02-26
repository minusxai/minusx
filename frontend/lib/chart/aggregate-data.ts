export interface AggregatedData {
  xAxisData: string[]
  series: Array<{
    name: string
    data: number[]
  }>
}

// Aggregate data based on X and Y axis selections
export const aggregateData = (
  rows: Record<string, any>[],
  xAxisColumns: string[],
  yAxisColumns: string[],
  chartType: 'line' | 'bar' | 'area' | 'scatter' | 'funnel' | 'pie' | 'pivot' | 'trend' | 'waterfall'
): AggregatedData => {
  if (yAxisColumns.length === 0) {
    return { xAxisData: [], series: [] }
  }

  // Handle case when no X axis columns (show total aggregation)
  if (xAxisColumns.length === 0) {
    const series = yAxisColumns.map(yCol => {
      const values: number[] = []
      rows.forEach(row => {
        const val = row[yCol]
        if (val !== null && val !== undefined && !isNaN(Number(val))) {
          values.push(Number(val))
        }
      })
      const total = values.reduce((acc, v) => acc + v, 0)
      return {
        name: yCol,
        data: [total]
      }
    })

    return {
      xAxisData: ['Total'],
      series
    }
  }

  // Group data by X axis columns
  const grouped = new Map<string, Record<string, number[]>>()

  rows.forEach(row => {
    const xKey = xAxisColumns.map(col => {
      const val = row[col]
      if (val instanceof Date) {
        return val.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      }
      return String(val)
    }).join(' | ')

    if (!grouped.has(xKey)) {
      grouped.set(xKey, {})
    }

    const group = grouped.get(xKey)!

    yAxisColumns.forEach(yCol => {
      if (!group[yCol]) {
        group[yCol] = []
      }
      const val = row[yCol]
      if (val !== null && val !== undefined && !isNaN(Number(val))) {
        group[yCol].push(Number(val))
      }
    })
  })

  const xAxisData = Array.from(grouped.keys())

  // If we have multiple X columns, create series per category
  if (xAxisColumns.length > 1) {
    // const shouldReorderByCardinality = ['line', 'bar', 'area', 'scatter'].includes(chartType)
    const shouldReorderByCardinality = false;

    let xAxisCol: string
    let groupingCols: string[]

    if (shouldReorderByCardinality) {
      const cardinalities = xAxisColumns.map(col => {
        const uniqueValues = new Set(rows.map(row => String(row[col])))
        return { col, cardinality: uniqueValues.size }
      })

      cardinalities.sort((a, b) => {
        if (b.cardinality !== a.cardinality) {
          return b.cardinality - a.cardinality
        }
        return xAxisColumns.indexOf(a.col) - xAxisColumns.indexOf(b.col)
      })

      xAxisCol = cardinalities[0].col
      groupingCols = cardinalities.slice(1).map(c => c.col)
    } else {
      xAxisCol = xAxisColumns[0]
      groupingCols = xAxisColumns.slice(1)
    }

    const uniqueGroups = new Set<string>()

    rows.forEach(row => {
      const groupVal = groupingCols.map(col => String(row[col])).join(' | ')
      uniqueGroups.add(groupVal)
    })

    const nestedGrouped = new Map<string, Map<string, number[]>>()

    rows.forEach(row => {
      const val = row[xAxisCol]
      const primaryKey = val instanceof Date
        ? val.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : String(val)

      const secondaryKey = groupingCols.map(col => String(row[col])).join(' | ')

      if (!nestedGrouped.has(primaryKey)) {
        nestedGrouped.set(primaryKey, new Map())
      }

      const primaryGroup = nestedGrouped.get(primaryKey)!

      if (!primaryGroup.has(secondaryKey)) {
        primaryGroup.set(secondaryKey, [])
      }

      yAxisColumns.forEach(yCol => {
        const val = row[yCol]
        if (val !== null && val !== undefined && !isNaN(Number(val))) {
          const key = `${secondaryKey}|${yCol}`
          if (!primaryGroup.has(key)) {
            primaryGroup.set(key, [])
          }
          primaryGroup.get(key)!.push(Number(val))
        }
      })
    })

    const seriesMap = new Map<string, number[]>()
    const primaryKeys = Array.from(nestedGrouped.keys())

    uniqueGroups.forEach(group => {
      yAxisColumns.forEach(yCol => {
        const seriesName = yAxisColumns.length > 1 ? `${group} - ${yCol}` : group
        const data: number[] = []

        primaryKeys.forEach(primaryKey => {
          const primaryGroup = nestedGrouped.get(primaryKey)!
          const key = `${group}|${yCol}`
          const values = primaryGroup.get(key) || []
          const sum = values.reduce((acc, v) => acc + v, 0)
          data.push(sum)
        })

        seriesMap.set(seriesName, data)
      })
    })

    return {
      xAxisData: primaryKeys,
      series: Array.from(seriesMap.entries()).map(([name, data]) => ({ name, data }))
    }
  }

  // Simple case: single X column
  const series = yAxisColumns.map(yCol => ({
    name: yCol,
    data: xAxisData.map(xKey => {
      const values = grouped.get(xKey)?.[yCol] || []
      return values.reduce((acc, v) => acc + v, 0)
    })
  }))

  return { xAxisData, series }
}
