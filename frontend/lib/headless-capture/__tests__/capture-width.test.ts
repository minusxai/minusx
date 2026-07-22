/**
 * Headless captures must render at the width a READER sees (Story_Design_V2 §4: no fidelity fork).
 *
 * Since the svg surface tracks its container (the width-clip fix), the headless viewport is no
 * longer just an output-size knob — it is a LAYOUT input. An 800px viewport renders the story below
 * the container-query breakpoints the story prompt mandates, so multi-column bands collapse and the
 * agent reviews its own work at a width no reader uses (StoryView caps the reading column at the
 * story canvas width).
 */
import { describe, it, expect } from 'vitest';
import { STORY_CANVAS_WIDTH } from '@/lib/story-surface';
import { DEFAULT_CAPTURE_WIDTH } from '../playwright-backend.server';

describe('headless capture width', () => {
  it('defaults to the story canvas width, so the agent sees the reader layout', () => {
    expect(DEFAULT_CAPTURE_WIDTH).toBe(STORY_CANVAS_WIDTH);
  });
});
