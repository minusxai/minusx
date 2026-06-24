import { describe, it, expect } from 'vitest'
import { evalCondition, buildConditionalBg, getContrastText } from '../conditional-format-utils'
import type { ConditionalFormatRule } from '@/lib/types'

const rule = (over: Partial<ConditionalFormatRule>): ConditionalFormatRule => ({
  id: 'r1',
  column: 'status',
  operator: '=',
  value: 'failed',
  target: 'cell',
  bgColor: '#fecaca',
  ...over,
})

describe('evalCondition', () => {
  it('handles string equality / inequality', () => {
    expect(evalCondition('failed', rule({ operator: '=', value: 'failed' }), 'text')).toBe(true)
    expect(evalCondition('ok', rule({ operator: '=', value: 'failed' }), 'text')).toBe(false)
    expect(evalCondition('ok', rule({ operator: '!=', value: 'failed' }), 'text')).toBe(true)
    expect(evalCondition('failed', rule({ operator: '!=', value: 'failed' }), 'text')).toBe(false)
  })

  it('handles contains (case-insensitive substring)', () => {
    expect(evalCondition('Payment Failed', rule({ operator: 'contains', value: 'fail' }), 'text')).toBe(true)
    expect(evalCondition('success', rule({ operator: 'contains', value: 'fail' }), 'text')).toBe(false)
  })

  it('coerces numeric comparisons for number columns', () => {
    const r = rule({ column: 'revenue', value: '0' })
    expect(evalCondition(-5, { ...r, operator: '<' }, 'number')).toBe(true)
    expect(evalCondition(5, { ...r, operator: '<' }, 'number')).toBe(false)
    expect(evalCondition(10, { ...r, operator: '>=' }, 'number')).toBe(true)
    expect(evalCondition(100, { ...r, operator: '=', value: '100' }, 'number')).toBe(true)
  })

  it('never matches null/undefined values', () => {
    expect(evalCondition(null, rule({ operator: '!=', value: 'failed' }), 'text')).toBe(false)
    expect(evalCondition(undefined, rule({ operator: '=', value: 'failed' }), 'text')).toBe(false)
  })
})

describe('getContrastText', () => {
  it('returns dark text on light backgrounds', () => {
    expect(getContrastText('#fde68a')).toBe('#1a1a1a') // light amber
    expect(getContrastText('#ffffff')).toBe('#1a1a1a')
  })
  it('returns white text on dark/saturated backgrounds', () => {
    expect(getContrastText('#ef4444')).toBe('#ffffff') // red
    expect(getContrastText('#000000')).toBe('#ffffff')
  })
  it('supports 3-digit hex', () => {
    expect(getContrastText('#fff')).toBe('#1a1a1a')
    expect(getContrastText('#000')).toBe('#ffffff')
  })
  it('falls back to inherit on bad input', () => {
    expect(getContrastText('not-a-color')).toBe('inherit')
  })
})

describe('buildConditionalBg', () => {
  const rows = [
    { status: 'failed', revenue: -5, region: 'east' },
    { status: 'ok', revenue: 200, region: 'west' },
    { status: 'ok', revenue: 50, region: 'east' },
  ]
  const types: Record<string, 'number' | 'date' | 'text' | 'json'> = {
    status: 'text', revenue: 'number', region: 'text',
  }

  it('cell target paints only the matching cell in its column', () => {
    const fn = buildConditionalBg([rule({ target: 'cell', column: 'status', value: 'failed', bgColor: '#f00' })], rows, types)
    expect(fn(rows[0], 'status')).toBe('#f00')
    expect(fn(rows[0], 'revenue')).toBeUndefined()
    expect(fn(rows[1], 'status')).toBeUndefined()
  })

  it('row target paints every cell of the matching row', () => {
    const fn = buildConditionalBg([rule({ target: 'row', column: 'status', value: 'failed', bgColor: '#0f0' })], rows, types)
    expect(fn(rows[0], 'status')).toBe('#0f0')
    expect(fn(rows[0], 'revenue')).toBe('#0f0')
    expect(fn(rows[1], 'status')).toBeUndefined()
  })

  it('column target paints the whole column when any row matches', () => {
    const fn = buildConditionalBg([rule({ target: 'column', column: 'revenue', operator: '<', value: '0', bgColor: '#00f' })], rows, types)
    // revenue has a negative value (row 0) → whole revenue column painted
    expect(fn(rows[0], 'revenue')).toBe('#00f')
    expect(fn(rows[2], 'revenue')).toBe('#00f')
    expect(fn(rows[0], 'status')).toBeUndefined()
  })

  it('column target paints nothing when no row matches', () => {
    const fn = buildConditionalBg([rule({ target: 'column', column: 'revenue', operator: '>', value: '9999', bgColor: '#00f' })], rows, types)
    expect(fn(rows[0], 'revenue')).toBeUndefined()
  })

  it('last matching rule wins (precedence)', () => {
    const fn = buildConditionalBg([
      rule({ id: 'a', target: 'row', column: 'region', value: 'east', bgColor: '#aaa' }),
      rule({ id: 'b', target: 'cell', column: 'status', value: 'failed', bgColor: '#bbb' }),
    ], rows, types)
    // row 0 is region=east (rule a) AND status=failed (rule b) → cell rule b last-wins on status cell
    expect(fn(rows[0], 'status')).toBe('#bbb')
    // revenue cell only covered by rule a
    expect(fn(rows[0], 'revenue')).toBe('#aaa')
  })

  it('returns a no-op when there are no rules', () => {
    const fn = buildConditionalBg([], rows, types)
    expect(fn(rows[0], 'status')).toBeUndefined()
  })
})
