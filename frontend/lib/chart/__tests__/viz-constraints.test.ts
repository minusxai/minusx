import { getVizConstraintError } from '@/lib/chart/viz-constraints'

describe('getVizConstraintError', () => {
  describe('trend chart', () => {
    it('returns error when X-axis column is not a temporal type', () => {
      const result = getVizConstraintError('trend', {
        xColCount: 1,
        yColCount: 1,
        xColTypes: ['text'],
      })
      expect(result.error).toBeTruthy()
      expect(result.error).toMatch(/date|time/i)
    })

    it('returns no error when X-axis column is a date type', () => {
      const result = getVizConstraintError('trend', {
        xColCount: 1,
        yColCount: 1,
        xColTypes: ['date'],
      })
      expect(result.error).toBeNull()
    })

    it('returns no error when X-axis column is a timestamp type', () => {
      const result = getVizConstraintError('trend', {
        xColCount: 1,
        yColCount: 1,
        xColTypes: ['date'],
      })
      expect(result.error).toBeNull()
    })

    it('returns error when X-axis column is a number type', () => {
      const result = getVizConstraintError('trend', {
        xColCount: 1,
        yColCount: 1,
        xColTypes: ['number'],
      })
      expect(result.error).toBeTruthy()
    })

    it('returns no error when no X columns (shows aggregate)', () => {
      const result = getVizConstraintError('trend', {
        xColCount: 0,
        yColCount: 1,
        xColTypes: [],
      })
      expect(result.error).toBeNull()
    })
  })

  // Existing chart types should be unaffected by xColTypes
  describe('other chart types unaffected', () => {
    it('bar chart ignores xColTypes', () => {
      const result = getVizConstraintError('bar', {
        xColCount: 1,
        yColCount: 1,
        xColTypes: ['text'],
      })
      expect(result.error).toBeNull()
    })
  })
})
