/** Today's date as an ISO `YYYY-MM-DD` string. Used for the `current_date` system-prompt var. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
