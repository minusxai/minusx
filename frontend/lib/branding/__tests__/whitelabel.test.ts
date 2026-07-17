import { describe, it, expect } from 'vitest';
import { mergeConfig, DEFAULT_CONFIG, resolveStoryRenderer, STORY_RENDERERS } from '@/lib/branding/whitelabel';
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

describe('storyRenderer — one setting, no invalid states', () => {
  it('preserves a storyRenderer override through merge', () => {
    expect(mergeConfig(DEFAULT_CONFIG, { storyRenderer: 'svg' }).storyRenderer).toBe('svg');
    expect(mergeConfig(DEFAULT_CONFIG, { storyRenderer: 'canvas' }).storyRenderer).toBe('canvas');
  });

  it('resolves to dom by default (renderer choice is unset)', () => {
    expect(resolveStoryRenderer(mergeConfig(DEFAULT_CONFIG, {}))).toBe('dom');
    expect(resolveStoryRenderer(null)).toBe('dom');
    expect(resolveStoryRenderer(undefined)).toBe('dom');
  });

  it('resolves each explicit renderer', () => {
    for (const r of STORY_RENDERERS) {
      expect(resolveStoryRenderer(mergeConfig(DEFAULT_CONFIG, { storyRenderer: r }))).toBe(r);
    }
  });

  // Back-compat: workspaces configured before the union stored `useCanvasRenderer: true`. They must
  // keep rendering on canvas — a default injected during merge must not shadow the legacy flag.
  it('honours legacy useCanvasRenderer:true → canvas when storyRenderer is unset', () => {
    expect(resolveStoryRenderer(mergeConfig(DEFAULT_CONFIG, { useCanvasRenderer: true }))).toBe('canvas');
  });

  it('legacy useCanvasRenderer:false → dom', () => {
    expect(resolveStoryRenderer(mergeConfig(DEFAULT_CONFIG, { useCanvasRenderer: false }))).toBe('dom');
  });

  it('explicit storyRenderer always beats the legacy flag', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { storyRenderer: 'svg', useCanvasRenderer: true });
    expect(resolveStoryRenderer(merged)).toBe('svg');
  });
});
