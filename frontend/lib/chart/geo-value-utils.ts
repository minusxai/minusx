/**
 * Parse numeric geo values that may arrive as formatted strings, e.g. "33,076".
 */
export function parseGeoNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : Number.NaN
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return Number.NaN

    const direct = Number(trimmed)
    if (Number.isFinite(direct)) return direct

    const withoutThousands = Number(trimmed.replace(/,/g, ''))
    if (Number.isFinite(withoutThousands)) return withoutThousands
  }

  return Number.NaN
}
