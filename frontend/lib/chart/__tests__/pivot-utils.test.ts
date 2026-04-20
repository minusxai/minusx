import { aggregatePivotData } from '../pivot-utils'
import type { PivotConfig } from '@/lib/types'

describe('aggregatePivotData', () => {
  describe('row and column sorting', () => {
    const config: PivotConfig = {
      rows: ['day_of_week'],
      columns: ['week'],
      values: [{ column: 'orders', aggFunction: 'SUM' }],
    }

    // Simulates SQL: ORDER BY week, day_of_week
    // First week starts on Tuesday, so insertion order would give 2-Tue first
    const rows = [
      { week: '2025-09-01', day_of_week: '2-Tue', orders: 10 },
      { week: '2025-09-01', day_of_week: '3-Wed', orders: 11 },
      { week: '2025-09-01', day_of_week: '4-Thu', orders: 12 },
      { week: '2025-09-01', day_of_week: '5-Fri', orders: 13 },
      { week: '2025-09-01', day_of_week: '6-Sat', orders: 14 },
      { week: '2025-09-01', day_of_week: '7-Sun', orders: 15 },
      { week: '2025-09-08', day_of_week: '1-Mon', orders: 9 },
      { week: '2025-09-08', day_of_week: '2-Tue', orders: 10 },
      { week: '2025-09-08', day_of_week: '3-Wed', orders: 11 },
      { week: '2025-09-08', day_of_week: '4-Thu', orders: 12 },
      { week: '2025-09-08', day_of_week: '5-Fri', orders: 13 },
      { week: '2025-09-08', day_of_week: '6-Sat', orders: 14 },
      { week: '2025-09-08', day_of_week: '7-Sun', orders: 15 },
    ]

    it('should sort row headers lexicographically ascending', () => {
      const result = aggregatePivotData(rows, config)
      expect(result.rowHeaders.map(h => h[0])).toEqual([
        '1-Mon', '2-Tue', '3-Wed', '4-Thu', '5-Fri', '6-Sat', '7-Sun',
      ])
    })

    it('should sort column headers lexicographically ascending', () => {
      // Reverse the data so columns would appear in wrong insertion order
      const reversed = [...rows].reverse()
      const result = aggregatePivotData(reversed, config)
      expect(result.columnHeaders.map(h => h[0])).toEqual([
        '2025-09-01', '2025-09-08',
      ])
    })

    it('should align cell data with sorted row and column keys', () => {
      const result = aggregatePivotData(rows, config)
      // 1-Mon only has data in week 2025-09-08 (value 9), not in 2025-09-01
      // After sorting: row 0 = 1-Mon, col 0 = 2025-09-01, col 1 = 2025-09-08
      expect(result.cells[0]).toEqual([0, 9]) // 1-Mon: no data in week 1, 9 in week 2
      expect(result.cells[1]).toEqual([10, 10]) // 2-Tue: 10 in both weeks
    })

    it('should sort multi-level row headers lexicographically', () => {
      const multiConfig: PivotConfig = {
        rows: ['category', 'product'],
        columns: ['month'],
        values: [{ column: 'sales', aggFunction: 'SUM' }],
      }
      const data = [
        { category: 'B-Electronics', product: 'TV', month: 'Jan', sales: 100 },
        { category: 'A-Clothing', product: 'Shirt', month: 'Jan', sales: 50 },
        { category: 'B-Electronics', product: 'Phone', month: 'Jan', sales: 200 },
        { category: 'A-Clothing', product: 'Pants', month: 'Jan', sales: 60 },
      ]
      const result = aggregatePivotData(data, multiConfig)
      expect(result.rowHeaders).toEqual([
        ['A-Clothing', 'Pants'],
        ['A-Clothing', 'Shirt'],
        ['B-Electronics', 'Phone'],
        ['B-Electronics', 'TV'],
      ])
    })
  })
})
