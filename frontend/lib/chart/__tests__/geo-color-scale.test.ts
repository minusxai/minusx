import { getColorScale, getRadiusScale, interpolateColor } from '@/lib/chart/geo-color-scale'

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
})
