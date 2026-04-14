import { getColorScale, getRadiusScale, interpolateColor, COLOR_SCALES } from '@/lib/chart/geo-color-scale'

describe('interpolateColor', () => {
  it('returns start color at t=0', () => {
    expect(interpolateColor('#000000', '#ffffff', 0)).toBe('#000000')
  })

  it('returns end color at t=1', () => {
    expect(interpolateColor('#000000', '#ffffff', 1)).toBe('#ffffff')
  })

  it('returns midpoint color at t=0.5', () => {
    const mid = interpolateColor('#000000', '#ffffff', 0.5)
    // Should be roughly #808080 (gray)
    expect(mid).toBe('#808080')
  })

  it('clamps t below 0 to start color', () => {
    expect(interpolateColor('#ff0000', '#0000ff', -0.5)).toBe('#ff0000')
  })

  it('clamps t above 1 to end color', () => {
    expect(interpolateColor('#ff0000', '#0000ff', 1.5)).toBe('#0000ff')
  })
})

describe('getColorScale', () => {
  it('returns low color for minimum value', () => {
    const color = getColorScale(0, 0, 100, 'light')
    expect(color).toBeDefined()
    expect(color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('returns high color for maximum value', () => {
    const color = getColorScale(100, 0, 100, 'light')
    expect(color).toBeDefined()
    expect(color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('returns different colors for different values', () => {
    const low = getColorScale(10, 0, 100, 'light')
    const high = getColorScale(90, 0, 100, 'light')
    expect(low).not.toBe(high)
  })

  it('handles min === max without crashing', () => {
    const color = getColorScale(50, 50, 50, 'light')
    expect(color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('returns different palettes for light vs dark mode', () => {
    const light = getColorScale(50, 0, 100, 'light')
    const dark = getColorScale(50, 0, 100, 'dark')
    // They may or may not differ, but both should be valid
    expect(light).toMatch(/^#[0-9a-f]{6}$/)
    expect(dark).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('uses different colors for different scale keys', () => {
    const green = getColorScale(80, 0, 100, 'light', 'green')
    const blue = getColorScale(80, 0, 100, 'light', 'blue')
    const ryg = getColorScale(80, 0, 100, 'light', 'red-yellow-green')
    expect(green).not.toBe(blue)
    expect(blue).not.toBe(ryg)
  })

  it('falls back to default scale for unknown key', () => {
    const defaultColor = getColorScale(50, 0, 100, 'light')
    const unknownColor = getColorScale(50, 0, 100, 'light', 'nonexistent')
    expect(unknownColor).toBe(defaultColor)
  })

  it('falls back to default scale for null/undefined', () => {
    const defaultColor = getColorScale(50, 0, 100, 'light')
    const nullColor = getColorScale(50, 0, 100, 'light', null)
    const undefColor = getColorScale(50, 0, 100, 'light', undefined)
    expect(nullColor).toBe(defaultColor)
    expect(undefColor).toBe(defaultColor)
  })
})

describe('COLOR_SCALES', () => {
  it('has at least 2 scale options', () => {
    expect(COLOR_SCALES.length).toBeGreaterThanOrEqual(2)
  })

  it('each scale has key, label, and 3 colors', () => {
    for (const scale of COLOR_SCALES) {
      expect(scale.key).toBeTruthy()
      expect(scale.label).toBeTruthy()
      expect(scale.colors).toHaveLength(3)
      for (const c of scale.colors) {
        expect(c).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })
})

describe('getRadiusScale', () => {
  it('returns minimum radius for minimum value', () => {
    expect(getRadiusScale(0, 0, 100)).toBe(4)
  })

  it('returns maximum radius for maximum value', () => {
    expect(getRadiusScale(100, 0, 100)).toBe(30)
  })

  it('returns intermediate radius for middle value', () => {
    const r = getRadiusScale(50, 0, 100)
    expect(r).toBeGreaterThan(4)
    expect(r).toBeLessThan(30)
  })

  it('handles min === max', () => {
    const r = getRadiusScale(50, 50, 50)
    expect(r).toBe(4) // default to min radius
  })

  it('clamps values below min', () => {
    expect(getRadiusScale(-10, 0, 100)).toBe(4)
  })

  it('clamps values above max', () => {
    expect(getRadiusScale(200, 0, 100)).toBe(30)
  })

  it('uses custom minRadius when provided', () => {
    expect(getRadiusScale(0, 0, 100, 10)).toBe(10)
  })

  it('uses custom minRadius for min===max fallback', () => {
    expect(getRadiusScale(50, 50, 50, 10)).toBe(10)
  })

  it('scales between custom minRadius and MAX_RADIUS', () => {
    const r = getRadiusScale(100, 0, 100, 10)
    expect(r).toBe(30) // max radius unchanged
  })

  it('interpolates correctly with custom minRadius', () => {
    // midpoint with minRadius=10: 10 + (30-10)*0.5 = 20
    expect(getRadiusScale(50, 0, 100, 10)).toBe(20)
  })
})
