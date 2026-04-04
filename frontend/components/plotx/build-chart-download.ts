import { getTimestamp } from '@/lib/chart/chart-utils'

const escapeCsvValue = (val: string | number) => {
  const str = String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

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
