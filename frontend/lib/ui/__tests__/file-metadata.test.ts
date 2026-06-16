import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_FILE_TYPES,
  getSupportedFileTypes,
  isFileTypeSupported,
  type FileType,
} from '@/lib/ui/file-metadata';

describe('getSupportedFileTypes', () => {
  it('returns the built-in defaults when no override is given', () => {
    expect(getSupportedFileTypes()).toEqual(SUPPORTED_FILE_TYPES);
    expect(getSupportedFileTypes(undefined)).toEqual(SUPPORTED_FILE_TYPES);
  });

  it('falls back to defaults for an empty override (footgun guard)', () => {
    expect(getSupportedFileTypes([])).toEqual(SUPPORTED_FILE_TYPES);
  });

  it('fully replaces the default set when an override is provided', () => {
    const override: FileType[] = ['question', 'dashboard', 'story'];
    expect(getSupportedFileTypes(override)).toEqual(override);
  });

  it('can make a normally-unsupported type supported via override', () => {
    expect(SUPPORTED_FILE_TYPES).not.toContain('story');
    expect(getSupportedFileTypes(['question', 'story'])).toContain('story');
  });

  it('can drop a normally-supported type via override (full replace)', () => {
    const override: FileType[] = ['question'];
    expect(getSupportedFileTypes(override)).not.toContain('dashboard');
  });
});

describe('isFileTypeSupported', () => {
  it('uses defaults when no override is given', () => {
    expect(isFileTypeSupported('question')).toBe(true);
    expect(isFileTypeSupported('story')).toBe(false);
  });

  it('honors the override when provided', () => {
    expect(isFileTypeSupported('story', ['question', 'story'])).toBe(true);
    expect(isFileTypeSupported('dashboard', ['question', 'story'])).toBe(false);
  });
});
