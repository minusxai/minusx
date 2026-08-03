/**
 * What a wizard agent step should SAY happened.
 *
 * Both agent-backed steps (auto-documentation, dashboard generation) previously asked only whether
 * the run had stopped, and a crashed run stops exactly like a successful one. So a step whose agent
 * died still rendered its success copy — "Done!", "Go check out your awesome new dashboard" — with
 * the error box immediately below it, and setup went on to report "You're all set!".
 *
 * `failed` therefore wins over `running`: an error can be recorded a frame or two before the run
 * status settles, and flashing a success message in between is the same lie in miniature.
 */
export type WizardAgentOutcome = 'idle' | 'running' | 'failed' | 'done';

export function wizardAgentOutcome(
  { started, running, error }: { started: boolean; running: boolean; error?: string | null },
): WizardAgentOutcome {
  // An error belonging to some earlier conversation must not make an unstarted step look failed.
  if (!started) return 'idle';
  if (error) return 'failed';
  return running ? 'running' : 'done';
}
