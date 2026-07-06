import { describe, it, expect } from 'vitest';
import {
  parseTelemetryLevel,
  shouldInitSentry,
  sentryLevelOptions,
  clientTelemetryLevel,
  TELEMETRY_LEVEL_ATTR,
} from '@/lib/telemetry';

describe('parseTelemetryLevel', () => {
  it('defaults to errors when unset or empty', () => {
    expect(parseTelemetryLevel(undefined)).toBe('errors');
    expect(parseTelemetryLevel('')).toBe('errors');
    expect(parseTelemetryLevel('   ')).toBe('errors');
  });

  it('parses named levels, case/whitespace-insensitive', () => {
    expect(parseTelemetryLevel('off')).toBe('off');
    expect(parseTelemetryLevel('errors')).toBe('errors');
    expect(parseTelemetryLevel('full')).toBe('full');
    expect(parseTelemetryLevel(' FULL ')).toBe('full');
    expect(parseTelemetryLevel('Off')).toBe('off');
  });

  it('accepts numeric aliases 0/1/2', () => {
    expect(parseTelemetryLevel('0')).toBe('off');
    expect(parseTelemetryLevel('1')).toBe('errors');
    expect(parseTelemetryLevel('2')).toBe('full');
  });

  it('falls back to errors on unrecognized values', () => {
    expect(parseTelemetryLevel('banana')).toBe('errors');
    expect(parseTelemetryLevel('3')).toBe('errors');
  });
});

describe('shouldInitSentry', () => {
  it('never initializes at level off, in any env', () => {
    expect(shouldInitSentry({ isDev: false, sendErrorsInDev: false, level: 'off' })).toBe(false);
    expect(shouldInitSentry({ isDev: true, sendErrorsInDev: true, level: 'off' })).toBe(false);
  });

  it('initializes in production at errors and full', () => {
    expect(shouldInitSentry({ isDev: false, sendErrorsInDev: false, level: 'errors' })).toBe(true);
    expect(shouldInitSentry({ isDev: false, sendErrorsInDev: false, level: 'full' })).toBe(true);
  });

  it('skips dev unless dev error reporting is explicitly opted in', () => {
    expect(shouldInitSentry({ isDev: true, sendErrorsInDev: false, level: 'full' })).toBe(false);
    expect(shouldInitSentry({ isDev: true, sendErrorsInDev: true, level: 'errors' })).toBe(true);
  });
});

describe('sentryLevelOptions', () => {
  it('errors level sends crash reports only: no traces, no logs, no PII', () => {
    expect(sentryLevelOptions('errors')).toEqual({
      tracesSampleRate: 0,
      enableLogs: false,
      sendDefaultPii: false,
    });
  });

  it('full level keeps traces, logs, and PII', () => {
    expect(sentryLevelOptions('full')).toEqual({
      tracesSampleRate: 1,
      enableLogs: true,
      sendDefaultPii: true,
    });
  });
});

describe('clientTelemetryLevel', () => {
  const rootWith = (value: string | null) => ({
    getAttribute: (name: string) => (name === TELEMETRY_LEVEL_ATTR ? value : null),
  });

  it('reads the level stamped on the html element', () => {
    expect(clientTelemetryLevel(rootWith('off'))).toBe('off');
    expect(clientTelemetryLevel(rootWith('errors'))).toBe('errors');
    expect(clientTelemetryLevel(rootWith('full'))).toBe('full');
  });

  it('defaults to errors (never full) when the attribute is absent or unknown', () => {
    expect(clientTelemetryLevel(rootWith(null))).toBe('errors');
    expect(clientTelemetryLevel(rootWith('bogus'))).toBe('errors');
    expect(clientTelemetryLevel(null)).toBe('errors');
    expect(clientTelemetryLevel(undefined)).toBe('errors');
  });
});
