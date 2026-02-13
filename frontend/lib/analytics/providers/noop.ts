import type { AnalyticsProvider } from '../types';

export class NoopProvider implements AnalyticsProvider {
  init(): void {}
  identify(): void {}
  captureEvent(): void {}
  startSession(): void {}
  stopSession(): void {}
  reset(): void {}
}
