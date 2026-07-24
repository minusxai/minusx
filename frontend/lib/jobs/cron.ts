/**
 * Minimal cron expression evaluator (handles *, numbers, ranges, lists, steps).
 * Format: "minute hour day-of-month month day-of-week".
 *
 * The cron *string* for a given job comes from `JobDefinition.getCron`
 * (`lib/jobs/job-definitions.ts`) — that hook knows how to pull the schedule
 * out of each job type's content shape (e.g. `alert.schedule.cron`). This
 * module is the other half: it evaluates whatever string `getCron` returns.
 * `lib/jobs/cron-scan.ts` is the seam that wires the two together.
 */

/** Does a single cron field ("*", "1,2,5", "*\/5", "1-5", "3") match `value`? */
export function matchesCronField(expr: string, value: number): boolean {
  if (expr === '*') return true;

  // Handle list: "1,2,5"
  if (expr.includes(',')) {
    return expr.split(',').some((part) => matchesCronField(part.trim(), value));
  }

  // Handle step: "*/5" or "0-59/5"
  if (expr.includes('/')) {
    const [rangeExpr, stepStr] = expr.split('/');
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) return false;
    if (rangeExpr === '*') return value % step === 0;
    // range/step
    if (rangeExpr.includes('-')) {
      const [start, end] = rangeExpr.split('-').map(Number);
      if (value < start || value > end) return false;
      return (value - start) % step === 0;
    }
    return false;
  }

  // Handle range: "1-5"
  if (expr.includes('-')) {
    const [start, end] = expr.split('-').map(Number);
    return value >= start && value <= end;
  }

  // Literal number
  return parseInt(expr, 10) === value;
}

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * The calendar fields (minute/hour/day-of-month/month/day-of-week) of `date`,
 * evaluated in `timeZone` when given (IANA, e.g. 'America/Los_Angeles') or the
 * server's local time otherwise. Used so a cron like "59 23 * * 0" means
 * 11:59 PM Sunday IN THAT ZONE, independent of where the server runs.
 */
function calendarFields(date: Date, timeZone?: string): { minute: number; hour: number; dom: number; month: number; dow: number } {
  if (!timeZone) {
    return { minute: date.getMinutes(), hour: date.getHours(), dom: date.getDate(), month: date.getMonth() + 1, dow: date.getDay() };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    minute: parseInt(get('minute'), 10),
    hour: parseInt(get('hour'), 10) % 24, // some locales render midnight as '24'
    dom: parseInt(get('day'), 10),
    month: parseInt(get('month'), 10),
    dow: DOW[get('weekday')] ?? 0,
  };
}

/** Is the 5-field cron expression ("min hour dom month dow") due at `date` (optionally in `timeZone`)? */
export function isCronDue(cronExpr: string, date: Date, timeZone?: string): boolean {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, month, dow] = parts;
  const f = calendarFields(date, timeZone);
  return (
    matchesCronField(min, f.minute) &&
    matchesCronField(hour, f.hour) &&
    matchesCronField(dom, f.dom) &&
    matchesCronField(month, f.month) &&
    matchesCronField(dow, f.dow)
  );
}

/**
 * Walk backwards minute-by-minute from `now` to find the most recent time
 * the cron expression was scheduled to fire (in `timeZone` when given). Returns
 * null if not found within the search bound (default 1 year = 525,600 minutes).
 */
export function getPrevFireTime(cronExpr: string, now: Date, maxMinutes = 525_600, timeZone?: string): Date | null {
  // Start from the current minute (truncate seconds/ms)
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);

  for (let i = 0; i < maxMinutes; i++) {
    if (isCronDue(cronExpr, candidate, timeZone)) return new Date(candidate);
    candidate.setMinutes(candidate.getMinutes() - 1);
  }
  return null;
}
