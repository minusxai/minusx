import { describe, it, expect } from 'vitest';
import {
  parseTelemetryDisabled,
  shouldInitSentry,
  isClientTelemetryDisabled,
  TELEMETRY_OPT_OUT_ATTR,
} from '@/lib/telemetry';

describe('parseTelemetryDisabled', () => {
  it('is false when unset or empty', () => {
    expect(parseTelemetryDisabled(undefined)).toBe(false);
    expect(parseTelemetryDisabled('')).toBe(false);
    expect(parseTelemetryDisabled('   ')).toBe(false);
  });

  it('is false for explicit falsy values', () => {
    expect(parseTelemetryDisabled('0')).toBe(false);
    expect(parseTelemetryDisabled('false')).toBe(false);
    expect(parseTelemetryDisabled('off')).toBe(false);
  });

  it('is true for truthy opt-out values, case/whitespace-insensitive', () => {
    expect(parseTelemetryDisabled('1')).toBe(true);
    expect(parseTelemetryDisabled('true')).toBe(true);
    expect(parseTelemetryDisabled('TRUE')).toBe(true);
    expect(parseTelemetryDisabled(' 1 ')).toBe(true);
    expect(parseTelemetryDisabled('yes')).toBe(true);
  });
});

describe('shouldInitSentry', () => {
  it('never initializes when telemetry is disabled, in any env', () => {
    expect(shouldInitSentry({ isDev: false, sendErrorsInDev: false, telemetryDisabled: true })).toBe(false);
    expect(shouldInitSentry({ isDev: true, sendErrorsInDev: true, telemetryDisabled: true })).toBe(false);
  });

  it('initializes in production when telemetry is enabled', () => {
    expect(shouldInitSentry({ isDev: false, sendErrorsInDev: false, telemetryDisabled: false })).toBe(true);
  });

  it('skips dev unless dev error reporting is explicitly opted in', () => {
    expect(shouldInitSentry({ isDev: true, sendErrorsInDev: false, telemetryDisabled: false })).toBe(false);
    expect(shouldInitSentry({ isDev: true, sendErrorsInDev: true, telemetryDisabled: false })).toBe(true);
  });
});

describe('isClientTelemetryDisabled', () => {
  const rootWith = (value: string | null) => ({
    getAttribute: (name: string) => (name === TELEMETRY_OPT_OUT_ATTR ? value : null),
  });

  it('is true only when the opt-out attribute is stamped "off"', () => {
    expect(isClientTelemetryDisabled(rootWith('off'))).toBe(true);
  });

  it('is false when the attribute is absent, different, or root is missing', () => {
    expect(isClientTelemetryDisabled(rootWith(null))).toBe(false);
    expect(isClientTelemetryDisabled(rootWith('on'))).toBe(false);
    expect(isClientTelemetryDisabled(null)).toBe(false);
    expect(isClientTelemetryDisabled(undefined)).toBe(false);
  });
});
