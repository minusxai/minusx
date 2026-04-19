import { computeTrendComparison } from '@/lib/chart/trend-utils'

describe('computeTrendComparison', () => {
  const labels = ['Jan', 'Feb', 'Mar', 'Apr']
  const data = [100, 200, 300, 150] // Apr is partial (incomplete period)

  describe('compareMode = "last" (default)', () => {
    it('uses last value as the display value', () => {
      const result = computeTrendComparison(data, labels, 'last')
      expect(result.currentValue).toBe(150)
    })

    it('compares last vs second-to-last', () => {
      const result = computeTrendComparison(data, labels, 'last')
      expect(result.compareBaseValue).toBe(150)
      expect(result.compareValue).toBe(300)
      // (150 - 300) / 300 * 100 = -50%
      expect(result.percentChange).toBeCloseTo(-50)
    })

    it('returns labels for the compared periods', () => {
      const result = computeTrendComparison(data, labels, 'last')
      expect(result.compareBaseLabel).toBe('Apr')
      expect(result.compareLabel).toBe('Mar')
    })

    it('defaults to last mode when no mode specified', () => {
      const result = computeTrendComparison(data, labels)
      expect(result.compareBaseValue).toBe(150)
      expect(result.compareValue).toBe(300)
    })
  })

  describe('compareMode = "previous"', () => {
    it('uses last value as the display value', () => {
      const result = computeTrendComparison(data, labels, 'previous')
      expect(result.currentValue).toBe(150)
    })

    it('compares the two most recent complete periods (skips last)', () => {
      const result = computeTrendComparison(data, labels, 'previous')
      // Trend should compare Mar (300) vs Feb (200)
      expect(result.compareBaseValue).toBe(300)
      expect(result.compareValue).toBe(200)
      // (300 - 200) / |200| * 100 = 50%
      expect(result.percentChange).toBeCloseTo(50)
    })

    it('returns labels for the compared periods', () => {
      const result = computeTrendComparison(data, labels, 'previous')
      expect(result.compareBaseLabel).toBe('Mar')
      expect(result.compareLabel).toBe('Feb')
    })
  })

  describe('with exactly 2 data points', () => {
    const twoLabels = ['Jan', 'Feb']
    const twoData = [100, 200]

    it('compares them directly regardless of mode', () => {
      const last = computeTrendComparison(twoData, twoLabels, 'last')
      const prev = computeTrendComparison(twoData, twoLabels, 'previous')
      expect(last.compareBaseValue).toBe(200)
      expect(last.compareValue).toBe(100)
      expect(prev.compareBaseValue).toBe(200)
      expect(prev.compareValue).toBe(100)
    })
  })

  describe('with 1 data point', () => {
    it('returns null for comparison fields', () => {
      const result = computeTrendComparison([500], ['Jan'])
      expect(result.currentValue).toBe(500)
      expect(result.percentChange).toBeNull()
      expect(result.compareValue).toBeNull()
    })
  })

  describe('with empty data', () => {
    it('returns zeros and nulls', () => {
      const result = computeTrendComparison([], [])
      expect(result.currentValue).toBe(0)
      expect(result.percentChange).toBeNull()
    })
  })

  describe('edge case: previous value is zero', () => {
    it('returns null percentage when dividing by zero', () => {
      const result = computeTrendComparison([0, 100, 50], ['Jan', 'Feb', 'Mar'], 'previous')
      // Compares Feb (100) vs Jan (0) — can't divide by zero
      expect(result.percentChange).toBeNull()
    })
  })

  describe('without labels', () => {
    it('works with undefined labels', () => {
      const result = computeTrendComparison([100, 200, 300, 150], undefined, 'previous')
      expect(result.currentValue).toBe(150)
      expect(result.percentChange).toBeCloseTo(50)
      expect(result.compareLabel).toBeUndefined()
    })
  })
})
