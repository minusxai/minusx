export type ConnectionWizardStep = 'connection' | 'context' | 'generating';

export const WIZARD_STEP_LABELS: Record<ConnectionWizardStep, { number: number; label: string }> = {
  connection: { number: 1, label: 'Connect Data' },
  context: { number: 2, label: 'Add Context' },
  generating: { number: 3, label: 'Build' },
};

export interface ConnectionWizardProps {
  /** Starting step (default: 'connection'). Lets hello-world resume from saved config. */
  initialStep?: ConnectionWizardStep;
  /** Pre-populated connection info when resuming mid-wizard. */
  initialConnectionId?: number | null;
  initialConnectionName?: string | null;
  initialContextFileId?: number | null;
  /** Called on every step transition. Hello-world uses this to persist to config. */
  onStepChange?: (
    step: ConnectionWizardStep,
    data: { connectionId?: number; connectionName?: string; contextFileId?: number }
  ) => void;
  /** Called when the entire wizard completes (after dashboard step). */
  onComplete?: () => Promise<void>;
  /** Whether to show greeting typewriter animations on each step. */
  showGreetings?: boolean;
  /** Whether existing connections trigger "skip connection" affordance. */
  showSkipConnection?: boolean;
  /** Custom greeting strings per step. */
  greetings?: Partial<Record<ConnectionWizardStep, string>>;
}
