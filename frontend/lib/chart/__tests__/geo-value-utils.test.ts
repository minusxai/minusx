import { parseGeoNumber } from '@/lib/chart/geo-value-utils'

describe('parseGeoNumber', () => {
  it('returns numeric inputs unchanged', () => {
    expect(parseGeoNumber(42)).toBe(42)
    expect(parseGeoNumber(-122.41)).toBe(-122.41)
  })

  it('parses plain numeric strings', () => {
    expect(parseGeoNumber('37.78')).toBe(37.78)
  })

  it('parses strings with thousands separators', () => {
    expect(parseGeoNumber('33,076')).toBe(33076)
  })

  it('returns NaN for empty or invalid strings', () => {
    expect(parseGeoNumber('')).toBeNaN()
    expect(parseGeoNumber('SOMA')).toBeNaN()
  })
})
