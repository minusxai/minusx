/**
 * TableV2 style contract + iframe resize tests.
 *
 * Bug A — column resize inside stories (iframe surface): TanStack's
 * getResizeHandler() must receive the OWNING document (the iframe's), not the
 * module-global top document, or drag listeners land in the wrong document and
 * the drag never moves/ends.
 *
 * Bug B — the documented `.mx-table/.mx-th/.mx-row/.mx-cell` css override
 * contract (atlas-schemas VizSourceTable.css) must actually be overridable:
 * structural declarations live in the low-specificity :where() base stylesheet
 * (not inline style=), dynamic widths ride CSS custom properties, the teal
 * accent is a themable token (var(--mx-table-accent, #16a085)), and the row
 * hover rule carries no !important.
 */
import React from 'react'
import { vi, describe, it, expect } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { TableV2 } from '../TableV2'

// TableV2 stays REAL — mock its duckdb/virtualizer deps (same pattern as viz-table.ui.test.tsx).
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({ index: i, start: i * 41, end: (i + 1) * 41, size: 41 })),
    getTotalSize: () => count * 41,
  }),
}))
vi.mock('@/lib/database/duckdb', () => ({
  calculateColumnStats: vi.fn().mockResolvedValue({}),
  getColumnType: (t: string) => {
    if (['INTEGER', 'BIGINT', 'DOUBLE', 'FLOAT', 'DECIMAL'].some(n => t.toUpperCase().includes(n))) return 'number'
    if (['DATE', 'TIMESTAMP'].some(n => t.toUpperCase().includes(n))) return 'date'
    return 'text'
  },
  loadDataIntoTable: vi.fn().mockResolvedValue(undefined),
  generateRandomTableName: () => 'test_table',
}))
vi.mock('@/lib/chart/histogram', () => ({
  calculateHistogram: vi.fn().mockResolvedValue([]),
}))

const COLUMNS = ['region', 'revenue']
const TYPES = ['VARCHAR', 'INTEGER']
const ROWS = [
  { region: 'EMEA', revenue: 10 },
  { region: 'APAC', revenue: 20 },
  { region: 'AMER', revenue: 30 },
]

const renderTable = (props: Partial<React.ComponentProps<typeof TableV2>> = {}, container?: HTMLElement) =>
  renderWithProviders(
    <TableV2 columns={COLUMNS} types={TYPES} rows={ROWS} {...props} />,
    container ? { container } : {},
  )

function makeIframeDoc(): Document {
  const iframe = document.createElement('iframe')
  document.body.appendChild(iframe)
  const idoc = iframe.contentDocument!
  idoc.open()
  idoc.write('<!DOCTYPE html><html><head></head><body></body></html>')
  idoc.close()
  return idoc
}

describe('Bug A — resize handler targets the owning document (story iframe)', () => {
  it('registers drag listeners on the iframe document, not the top document', () => {
    const idoc = makeIframeDoc()
    const container = idoc.body.appendChild(idoc.createElement('div'))
    const { getByLabelText } = renderTable({}, container)

    const handle = getByLabelText('Resize column region')
    expect(handle.ownerDocument).toBe(idoc)

    const iframeSpy = vi.spyOn(idoc, 'addEventListener')
    const topSpy = vi.spyOn(document, 'addEventListener')
    fireEvent.mouseDown(handle, { clientX: 100, clientY: 10 })

    const listenerNames = (spy: { mock: { calls: unknown[][] } }) =>
      spy.mock.calls.map(c => c[0] as string)
    expect(listenerNames(iframeSpy)).toContain('mousemove')
    expect(listenerNames(iframeSpy)).toContain('mouseup')
    expect(listenerNames(topSpy)).not.toContain('mousemove')

    iframeSpy.mockRestore()
    topSpy.mockRestore()
  })

  it('still registers drag listeners on the top document for main-document tables', () => {
    const { getByLabelText } = renderTable()
    const handle = getByLabelText('Resize column region')
    const topSpy = vi.spyOn(document, 'addEventListener')
    fireEvent.mouseDown(handle, { clientX: 100, clientY: 10 })
    expect(topSpy.mock.calls.map(c => c[0])).toContain('mousemove')
    topSpy.mockRestore()
  })
})

describe('Bug B — css override contract (no inline structural styles)', () => {
  it('header cells carry no inline border/background/width — width rides --mx-col-w', () => {
    const { baseElement } = renderTable()
    const th = baseElement.querySelector('th.mx-th') as HTMLElement
    expect(th).toBeTruthy()
    expect(th.style.borderRight).toBe('')
    expect(th.style.borderBottom).toBe('')
    expect(th.style.background).toBe('')
    expect(th.style.width).toBe('')
    expect(th.style.getPropertyValue('--mx-col-w')).toMatch(/px$/)
  })

  it('an accented (sorted) header signals state via class, not inline styles', () => {
    const { baseElement } = renderTable({ initialSorting: [{ id: 'region', desc: false }] })
    const th = baseElement.querySelector('th.mx-th') as HTMLElement
    expect(th.classList.contains('mx-th-accented')).toBe(true)
    expect(th.style.background).toBe('')
    expect(th.style.borderBottom).toBe('')
  })

  it('body rows/cells carry no inline height/width/border — width rides --mx-col-w', () => {
    const { baseElement } = renderTable()
    const tr = baseElement.querySelector('tr.mx-row') as HTMLElement
    expect(tr).toBeTruthy()
    expect(tr.style.height).toBe('')
    const td = tr.querySelector('td.mx-cell') as HTMLElement
    expect(td.style.width).toBe('')
    expect(td.style.borderRight).toBe('')
    expect(td.style.getPropertyValue('--mx-col-w')).toMatch(/px$/)
  })

  it('zebra parity classes are unchanged (data-index based odd/even)', () => {
    const { baseElement } = renderTable()
    const rows = Array.from(baseElement.querySelectorAll('tr.mx-row'))
    expect(rows[0].classList.contains('mx-row-even')).toBe(true)
    expect(rows[1].classList.contains('mx-row-odd')).toBe(true)
    expect(rows[2].classList.contains('mx-row-even')).toBe(true)
  })

  it('conditional-format cell background stays inline (data-driven), untouched by the refactor', () => {
    const { baseElement } = renderTable({
      conditionalFormats: [
        { id: 'r1', column: 'revenue', operator: '>', value: '15', target: 'cell', bgColor: '#ff0000' },
      ],
    })
    const cells = Array.from(baseElement.querySelectorAll('td.mx-col-revenue')) as HTMLElement[]
    const painted = cells.filter(td => td.style.backgroundColor !== '')
    expect(painted.length).toBe(2) // rows with revenue 20 and 30
  })

  it('no element carries literal #16a085 inline except as a var(--mx-table-accent) fallback', () => {
    const { baseElement } = renderTable({ initialSorting: [{ id: 'region', desc: false }] })
    const offenders = Array.from(baseElement.querySelectorAll<HTMLElement>('[style]'))
      .map(el => el.getAttribute('style') ?? '')
      .filter(s => s.includes('#16a085') && !s.includes('var(--mx-table-accent'))
    expect(offenders).toEqual([])
  })

  it('the base stylesheet uses the accent token (teal only as var fallback) and no !important', () => {
    const { baseElement } = renderTable()
    const css = Array.from(baseElement.querySelectorAll('style'))
      .map(s => s.textContent ?? '')
      .join('\n')
    expect(css).toContain('.mx-th') // structural rules moved into the stylesheet
    expect(css.replaceAll('var(--mx-table-accent, #16a085)', '')).not.toContain('#16a085')
    expect(css).not.toContain('!important')
  })
})
