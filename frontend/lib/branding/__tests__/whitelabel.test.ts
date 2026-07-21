import { describe, it, expect } from 'vitest';
import { mergeConfig, DEFAULT_CONFIG } from '@/lib/branding/whitelabel';
import type { FileType } from '@/lib/ui/file-metadata';

describe('mergeConfig - supportedFileTypes', () => {
  it('preserves a supportedFileTypes override', () => {
    const override: FileType[] = ['question', 'dashboard', 'story'];
    const merged = mergeConfig(DEFAULT_CONFIG, { supportedFileTypes: override });
    expect(merged.supportedFileTypes).toEqual(override);
  });

  it('falls back to the default when no override is present', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {});
    expect(merged.supportedFileTypes).toBe(DEFAULT_CONFIG.supportedFileTypes);
  });
});
