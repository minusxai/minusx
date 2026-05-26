import { useRef } from 'react'
import isEqual from 'lodash/isEqual'

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
/* eslint-enable react-hooks/refs */
