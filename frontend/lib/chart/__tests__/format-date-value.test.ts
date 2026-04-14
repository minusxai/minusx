import { formatDateValue } from '@/lib/chart/chart-utils'

const DATE = '2024-01-15T14:05:09Z'
const DATE_ONLY = '2024-01-15'

describe('formatDateValue', () => {
  describe('pattern-based formatting', () => {
    it('formats yyyy-MM-dd', () => {
      expect(formatDateValue(DATE, 'yyyy-MM-dd')).toBe('2024-01-15')
    })

    it('formats MM/dd/yyyy', () => {
      expect(formatDateValue(DATE, 'MM/dd/yyyy')).toBe('01/15/2024')
    })

    it('formats dd/MM/yyyy', () => {
      expect(formatDateValue(DATE, 'dd/MM/yyyy')).toBe('15/01/2024')
    })

    it('formats MMM dd, yyyy (short month)', () => {
      expect(formatDateValue(DATE, 'MMM dd, yyyy')).toBe('Jan 15, 2024')
    })

    it('formats MMMM dd, yyyy (full month)', () => {
      expect(formatDateValue(DATE, 'MMMM dd, yyyy')).toBe('January 15, 2024')
    })

    it("formats MMM'yy", () => {
      expect(formatDateValue(DATE, "MMM'yy")).toBe("Jan'24")
    })

    it('formats yyyy alone', () => {
      expect(formatDateValue(DATE, 'yyyy')).toBe('2024')
    })

    it('formats yy (2-digit year)', () => {
      expect(formatDateValue(DATE, 'yy')).toBe('24')
    })

    it('formats time HH:mm:ss', () => {
      expect(formatDateValue(DATE, 'HH:mm:ss')).toBe('14:05:09')
    })

    it('formats date + time yyyy-MM-dd HH:mm', () => {
      expect(formatDateValue(DATE, 'yyyy-MM-dd HH:mm')).toBe('2024-01-15 14:05')
    })

    it('handles date-only input strings', () => {
      expect(formatDateValue(DATE_ONLY, 'MM/dd/yyyy')).toBe('01/15/2024')
    })

    it('preserves literal separators', () => {
      expect(formatDateValue(DATE, 'dd.MM.yyyy')).toBe('15.01.2024')
      expect(formatDateValue(DATE, 'dd-MM-yyyy')).toBe('15-01-2024')
    })
  })

  describe('legacy named format compat', () => {
    it('maps "iso" to yyyy-MM-dd', () => {
      expect(formatDateValue(DATE, 'iso')).toBe('2024-01-15')
    })

    it('maps "us" to MM/dd/yyyy', () => {
      expect(formatDateValue(DATE, 'us')).toBe('01/15/2024')
    })

    it('maps "short" to MMM dd, yyyy', () => {
      expect(formatDateValue(DATE, 'short')).toBe('Jan 15, 2024')
    })

    it("maps 'month-year' to MMM'yy", () => {
      expect(formatDateValue(DATE, 'month-year')).toBe("Jan'24")
    })

    it('maps "year" to yyyy', () => {
      expect(formatDateValue(DATE, 'year')).toBe('2024')
    })
  })

  describe('edge cases', () => {
    it('returns original string for invalid date', () => {
      expect(formatDateValue('not-a-date', 'yyyy-MM-dd')).toBe('not-a-date')
    })

    it('returns original string for empty string', () => {
      expect(formatDateValue('', 'yyyy-MM-dd')).toBe('')
    })

    it('handles different months correctly', () => {
      expect(formatDateValue('2024-12-25', 'MMM')).toBe('Dec')
      expect(formatDateValue('2024-06-01', 'MMMM')).toBe('June')
      expect(formatDateValue('2024-02-14', 'MMM dd')).toBe('Feb 14')
    })

    it('zero-pads single-digit day and month', () => {
      expect(formatDateValue('2024-03-05', 'dd/MM/yyyy')).toBe('05/03/2024')
    })

    it('zero-pads midnight time', () => {
      expect(formatDateValue('2024-01-15T00:00:00Z', 'HH:mm:ss')).toBe('00:00:00')
    })
  })
})
