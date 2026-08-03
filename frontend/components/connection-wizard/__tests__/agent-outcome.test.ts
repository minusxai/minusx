/**
 * The wizard's agent steps used to derive "done" from "no longer running", which is true of a
 * crashed run as well as a successful one — so a step whose agent died still printed "Done! Go
 * check out your awesome new dashboard." directly above the red error box, and the final screen
 * said "You're all set!" over a workspace where nothing had been produced.
 *
 * The outcome is therefore three-valued, and a run that recorded an error is `failed`, never `done`.
 */
import { describe, it, expect } from 'vitest';
import { wizardAgentOutcome } from '../agent-outcome';

describe('wizardAgentOutcome', () => {
  it('is idle before the agent is started', () => {
    expect(wizardAgentOutcome({ started: false, running: false })).toBe('idle');
    // An error left over from an earlier conversation must not make an unstarted step look failed.
    expect(wizardAgentOutcome({ started: false, running: false, error: 'boom' })).toBe('idle');
  });

  it('is running while the agent is executing', () => {
    expect(wizardAgentOutcome({ started: true, running: true })).toBe('running');
  });

  it('is done when a started run stopped with no error', () => {
    expect(wizardAgentOutcome({ started: true, running: false })).toBe('done');
    expect(wizardAgentOutcome({ started: true, running: false, error: null })).toBe('done');
    expect(wizardAgentOutcome({ started: true, running: false, error: '' })).toBe('done');
  });

  // The case the whole module exists for.
  it('is failed when a started run stopped carrying an error', () => {
    expect(wizardAgentOutcome({
      started: true, running: false, error: 'No API key for provider: minusx',
    })).toBe('failed');
  });

  // An error can arrive mid-stream while the run is still winding down; the step must not flip back
  // to a success message for the frame between the error and the final status.
  it('is failed as soon as an error is recorded, even if still marked running', () => {
    expect(wizardAgentOutcome({ started: true, running: true, error: 'boom' })).toBe('failed');
  });
});
