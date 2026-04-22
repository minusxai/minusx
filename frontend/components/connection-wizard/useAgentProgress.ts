import { useState, useRef, useEffect } from 'react';

/**
 * Exponential decay progress: approaches 100% asymptotically.
 * Formula: p(t) = (1 - e^(-t/tau)) * 100
 * Snaps to 100% when done, resets to 0 when not running.
 *
 * @param isRunning - whether the agent is currently executing
 * @param isDone - whether the agent has finished
 * @param tau - time constant in seconds (higher = slower). ~63% at tau seconds, ~90% at 2.3*tau.
 */
const PROGRESS_INTERVAL_MS = 200;

export function useAgentProgress(isRunning: boolean, isDone: boolean, tau: number = 20): number {
  const [progress, setProgress] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (isDone) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgress(100);
      startTimeRef.current = null;
      return;
    }
    if (!isRunning) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgress(0);
      startTimeRef.current = null;
      return;
    }
    startTimeRef.current = Date.now();
    const interval = setInterval(() => {
      if (!startTimeRef.current) return;
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const p = (1 - Math.exp(-elapsed / tau)) * 100;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgress(Math.min(p, 99));
    }, PROGRESS_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isRunning, isDone, tau]);

  return progress;
}
