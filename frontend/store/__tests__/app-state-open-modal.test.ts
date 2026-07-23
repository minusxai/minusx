/**
 * ui.openModal assembly (store/appStateSelector.ts → openModalForTop): the agent's app state
 * for a question overlay. When a question is opened FROM A DASHBOARD (pushView carries
 * dashboardId for BOTH 'question' and 'create-question'), the openModal must carry that
 * dashboardId — it previously did so only for 'create-question', silently dropping the
 * dashboard linkage for existing questions.
 */
import { describe, it, expect } from 'vitest';
import { openModalForTop } from '../appStateSelector';
import type { CompressedFileState } from '@/lib/types';

const fileState = { id: 7, type: 'question' } as unknown as CompressedFileState;

describe('openModalForTop', () => {
  it('carries dashboardId for an EXISTING question opened from a dashboard', () => {
    expect(openModalForTop({ type: 'question', fileId: 7, dashboardId: 3 }, fileState)).toEqual({
      type: 'question',
      fileId: 7,
      dashboardId: 3,
      fileState,
    });
  });

  it('carries dashboardId for create-question (unchanged)', () => {
    expect(
      openModalForTop({ type: 'create-question', folderPath: '/org', dashboardId: 3, fileId: 9 }, undefined),
    ).toEqual({ type: 'create-question', fileId: 9, dashboardId: 3 });
  });

  it('omits dashboardId when the question was opened standalone', () => {
    expect(openModalForTop({ type: 'question', fileId: 7 }, fileState)).toEqual({
      type: 'question',
      fileId: 7,
      fileState,
    });
  });
});
