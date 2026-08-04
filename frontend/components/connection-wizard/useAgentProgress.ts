import { useState, useRef, useEffect } from 'react';

/**
 * Exponential decay progress: p(t) = (1 - e^(-t/tau)) * 100, clamped to PROGRESS_CEILING.
 *
 * This curve is driven by ELAPSED TIME ONLY — it knows nothing about what the agent has
 * actually done. That is why it is capped rather than allowed to approach 100. On a measured
 * run the onboarding context agent produced nothing for 5m03s and then finished inside 14s;
 * throughout those five minutes an uncapped curve sat pinned at 99% under the caption
 * "Finishing up...". Claiming the last stage on time alone is worse than claiming nothing,
 * because it is indistinguishable from a hung run right up until it isn't.
 *
 * The ceiling sits below the lowest final-stage message threshold any caller uses (80 in
 * StepContextDocsStep, 85 in StepGenerating), so elapsed time can never select a "nearly
 * done" message. Only `isDone` reaches 100.
 *
 * @param isRunning - whether the agent is currently executing
 * @param isDone - whether the agent has finished
 * @param tau - time constant in seconds (higher = slower). ~63% at tau seconds.
 */
const PROGRESS_INTERVAL_MS = 200;

/** Highest value elapsed time may reach. Below every caller's final-stage threshold. */
export const PROGRESS_CEILING = 75;

/** Past this long and still running, callers say so instead of inventing a stage. */
export const SLOW_AFTER_SECONDS = 45;

export interface AgentProgress {
  /** 0–PROGRESS_CEILING while running; exactly 100 once done; 0 when idle. */
  progress: number;
  /** Running longer than SLOW_AFTER_SECONDS — show honest copy, not a stage message. */
  isSlow: boolean;
}

export function useAgentProgress(isRunning: boolean, isDone: boolean, tau: number = 20): AgentProgress {
  const [progress, setProgress] = useState(0);
  const [isSlow, setIsSlow] = useState(false);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (isDone) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgress(100);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsSlow(false);
      startTimeRef.current = null;
      return;
    }
    if (!isRunning) {

      setProgress(0);

      setIsSlow(false);
      startTimeRef.current = null;
      return;
    }
    startTimeRef.current = Date.now();

    setIsSlow(false);
    const interval = setInterval(() => {
      if (!startTimeRef.current) return;
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const p = (1 - Math.exp(-elapsed / tau)) * 100;

      setProgress(Math.min(p, PROGRESS_CEILING));

      setIsSlow(elapsed >= SLOW_AFTER_SECONDS);
    }, PROGRESS_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isRunning, isDone, tau]);

  return { progress, isSlow };
}

/** Copy shown in place of a fabricated stage message once a run passes SLOW_AFTER_SECONDS. */
export const SLOW_RUN_MESSAGE = 'Still working — this is taking longer than usual...';

/**
 * Human-friendly status for a progress percentage.
 *
 * `isSlow` replaces the stage outright rather than selecting a later message: the stage list
 * is a guess keyed off elapsed time, and on a long run the one thing worth saying is that it
 * is a long run.
 */
export function getProgressMessage(progress: number, messages: [number, string][], isSlow = false): string {
  if (isSlow) return SLOW_RUN_MESSAGE;
  // messages is sorted by threshold ascending, e.g. [[0, "Starting..."], [25, "Exploring..."], ...]
  let msg = messages[0]?.[1] ?? '';
  for (const [threshold, text] of messages) {
    if (progress >= threshold) msg = text;
  }
  return msg;
}
