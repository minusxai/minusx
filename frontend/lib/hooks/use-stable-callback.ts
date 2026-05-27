import { useEffect, useRef } from 'react'

/**
 * Return a function whose identity is stable across the component's lifetime,
 * but which always invokes the latest `fn` passed in. Useful when the consumer
 * uses the function inside a memoised child or an effect whose deps you can't
 * change — the wrapper's identity stays constant so the consumer doesn't
 * re-run, but the closure it points at is updated each render.
 *
 * Don't use this when you actually want the consumer to re-react to a new
 * function (e.g. when the callback's identity is the signal for invalidation).
 *
 * react-hooks/refs is disabled deliberately: the stable-wrapper pattern needs
 * to return ref.current during render so the consumer sees a constant identity.
 */
export function useStableCallback<T extends (...args: never[]) => unknown>(fn: T): T {
  const ref = useRef(fn)
  useEffect(() => { ref.current = fn })
  // The wrapper is created once per component instance; the ref points at the
  // latest fn each render.
   
  const stable = useRef(((...args: Parameters<T>) => ref.current(...args)) as T)
  // eslint-disable-next-line react-hooks/refs
  return stable.current
}

/**
 * memo comparator: shallow-equals every prop *except* those listed in `ignore`.
 * Use when a component reads certain props through `useStableCallback`/refs
 * and wants memoisation to skip when only those props changed identity.
 *
 * Iterates `Object.keys` rather than naming each prop so adding a new field
 * doesn't silently bypass memoisation.
 */
export function shallowEqualExcept<P extends object>(prev: P, next: P, ignore: ReadonlyArray<keyof P>): boolean {
  const prevKeys = Object.keys(prev) as (keyof P)[]
  const nextKeys = Object.keys(next) as (keyof P)[]
  if (prevKeys.length !== nextKeys.length) return false
  for (const k of nextKeys) {
    if (ignore.includes(k)) continue
    if (prev[k] !== next[k]) return false
  }
  return true
}
