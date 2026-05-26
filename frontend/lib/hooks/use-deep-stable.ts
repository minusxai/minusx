import { useRef } from 'react'
import isEqual from 'lodash/isEqual'
import isEqualWith from 'lodash/isEqualWith'

/**
 * Return a reference-stable view of `value`: when the latest `value` is deeply
 * equal to the previous one, return the previous reference; otherwise return
 * the new value (and remember it for next time).
 *
 * Useful at memo/effect boundaries when upstream callers pass deeply-equal but
 * referentially-fresh objects (e.g. config objects rebuilt inline each render).
 * The cost is one `lodash.isEqual` per render — pay it once at the boundary so
 * downstream `useEffect`/`useMemo`/`React.memo` paths don't recompute.
 *
 * Trade-off: if the consumer is cheap to re-run (a small div), don't bother —
 * the deep equal is its own work. Use this when the consumer triggers
 * expensive side-effects (chart.setOption, layout, network) on prop change.
 *
 * react-hooks/refs is disabled deliberately: this hook's entire purpose is to
 * read/write the ref during render to provide a stable identity.
 */
/* eslint-disable react-hooks/refs */
export function useDeepStable<T>(value: T): T {
  const ref = useRef(value)
  if (!isEqual(ref.current, value)) {
    ref.current = value
  }
  return ref.current
}

/**
 * Like `useDeepStable`, but treats two function values as equal (regardless of
 * reference identity).
 *
 * Why this exists: lodash's `isEqual` compares functions by strict `===`. When
 * the consumer is something like an ECharts `option` tree, callers commonly
 * rebuild nested formatters (`tooltip.formatter`, `yAxis.axisLabel.formatter`,
 * `legend.formatter`, ...) as inline closures on every render. Even when the
 * *behavior* of those formatters depends only on data we're also comparing
 * (column formats, color palette, chart type), their identities differ each
 * render and `isEqual` bails — defeating the stabiliser.
 *
 * This variant ignores function identity. Safe to use only when the function's
 * behaviour is fully determined by other (non-function) values that the
 * surrounding deep-equal still sees. If a real behaviour change is encoded
 * only in a closed-over variable, this helper will hide it.
 */
const treatFunctionsAsEqual = (a: unknown, b: unknown): boolean | undefined => {
  if (typeof a === 'function' && typeof b === 'function') return true
  return undefined // fall back to default isEqualWith comparison
}

export function useDeepStableIgnoreFunctions<T>(value: T): T {
  const ref = useRef(value)
  if (!isEqualWith(ref.current, value, treatFunctionsAsEqual)) {
    ref.current = value
  }
  return ref.current
}
/* eslint-enable react-hooks/refs */
