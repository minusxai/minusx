/**
 * Playwright globalSetup for the QA config: reset `test/qa/.metrics/` so each
 * run's report reflects exactly this run (stale rows from a previous run can
 * never leak into a report), and stamp the run's label/target metadata.
 */
import { initMetricsDir } from './metrics';

export default function globalSetup(): void {
  initMetricsDir();
}
