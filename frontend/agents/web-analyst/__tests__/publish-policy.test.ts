// Publish policy: the agent must NEVER volunteer a publish. PublishAll is called only
// when (a) the user explicitly asks to save/publish, or (b) the agent is about to
// Navigate away from a file with unsaved edits (and says why). It is never a step of
// some other task — edits stay staged as drafts for the user to review and publish.
// This pins that policy in the two places the model learns it from: the PublishAll
// tool description and the shared system prompts.

import { describe, expect, it } from 'vitest';
import { PublishAll } from '../web-tools';
import { PROMPTS } from '@/orchestrator/prompts';

// Collapse yaml line-wraps (literal-block newlines + indent) so phrases match across breaks.
const promptsFlat = JSON.stringify(PROMPTS).replace(/\\n/g, ' ').replace(/\s+/g, ' ');

describe('publish policy — agent never volunteers a publish', () => {
  it('PublishAll description restricts calls to explicit user request or pre-Navigate', () => {
    const desc = PublishAll.schema.description;
    expect(desc).toMatch(/explicitly asks/i);
    expect(desc).toMatch(/navigat/i);
    expect(desc).toMatch(/never/i);
    // The old description instructed auto-publishing after edits.
    expect(desc).not.toMatch(/use after editfile/i);
    expect(desc).not.toMatch(/persist agent edits/i);
  });

  it('system prompts do not tell the agent to offer saving after edits', () => {
    expect(promptsFlat).not.toMatch(/ask the user if they'd like to save/i);
  });

  it('system prompts state the never-as-part-of-another-task rule', () => {
    expect(promptsFlat).toMatch(/never call publishall as part of (some other|another) task/i);
  });
});
