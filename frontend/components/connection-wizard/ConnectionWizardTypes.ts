export type ConnectionWizardStep = 'models' | 'connection' | 'questionnaire' | 'context' | 'generating' | 'slack';

export const WIZARD_STEP_LABELS: Record<ConnectionWizardStep, { number: number; label: string }> = {
  models: { number: 0, label: 'AI Models' },
  connection: { number: 1, label: 'Connect Data' },
  questionnaire: { number: 2, label: 'Add Context' },
  context: { number: 2, label: 'Add Context' },
  generating: { number: 3, label: 'Build' },
  slack: { number: 4, label: 'Slack' },
};

/**
 * Narrow a persisted `setupWizard.step` to a step this wizard can render, or `undefined`.
 *
 * The stored value is wider than this union — `hello-world` tracks a `'welcome'` screen the wizard
 * knows nothing about, and the document is user-editable — and `ConnectionWizard` renders every
 * step behind an `===` check, so an unrecognized value produces a silent empty card rather than an
 * error. Callers pass the result through `??` to their own default.
 */
export function asWizardStep(step: string | undefined | null): ConnectionWizardStep | undefined {
  return step && step in WIZARD_STEP_LABELS ? (step as ConnectionWizardStep) : undefined;
}

export interface QuestionnaireAnswers {
  datasetDescription: string;
  keyMetrics: string;
  dashboardPreference: string;
}

/** The two upload surfaces on the connection step. File uploads and Google Sheets
 *  are the only sources configured by upload rather than by typed fields. */
export type StaticTab = 'csv' | 'sheets';

/**
 * The upload tab a connection type opens on, or null for engines configured with
 * plain fields (Postgres, BigQuery, …) which never reach the upload screen.
 *
 * install.sh offers the file-based types but cannot complete them — their config
 * is a `files` array whose entries carry an already-profiled schema (row_count,
 * columns) that only the upload pipeline here can produce — so it finishes by
 * linking to /new/connection?type=<type>, which lands via this map.
 */
export function staticTabForConnectionType(type: string | null | undefined): StaticTab | null {
  switch (type) {
    case 'google-sheets':
      return 'sheets';
    // Excel has no tab of its own; the CSV tab is a generic file upload.
    case 'csv':
    case 'xlsx':
      return 'csv';
    default:
      return null;
  }
}

export interface ConnectionWizardProps {
  /** Starting step (default: 'connection'). Lets hello-world resume from saved config. */
  initialStep?: ConnectionWizardStep;
  /** Opens the connection step directly on an upload tab. Set from ?type= so the
   *  installer can hand a CSV/Excel/Sheets user straight to the right screen. */
  initialStaticTab?: StaticTab | null;
  /** Pre-populated connection info when resuming mid-wizard. */
  initialConnectionId?: number | null;
  initialConnectionName?: string | null;
  initialContextFileId?: number | null;
  /** Pre-populated questionnaire answers when resuming mid-wizard. */
  initialQuestionnaireAnswers?: QuestionnaireAnswers | null;
  /** Called on every step transition. Hello-world uses this to persist to config. */
  onStepChange?: (
    step: ConnectionWizardStep,
    data: {
      connectionId?: number;
      connectionName?: string;
      contextFileId?: number;
      questionnaireAnswers?: QuestionnaireAnswers;
    }
  ) => void;
  /** Called when the entire wizard completes — after the 'generating' step, or after
   *  the 'slack' step when showSlackStep is set. */
  onComplete?: () => Promise<void>;
  /** Whether to show greeting typewriter animations on each step. */
  showGreetings?: boolean;
  /** Whether existing connections trigger "skip connection" affordance. */
  showSkipConnection?: boolean;
  /** Custom greeting strings per step. */
  greetings?: Partial<Record<ConnectionWizardStep, string>>;
  /** Whether to show the Slack integration step after generating. Default: false. */
  showSlackStep?: boolean;
  /** Whether to show the AI-model provider step before connecting data
   *  (shown when no LLM provider is configured yet). Default: false. */
  showModelsStep?: boolean;
}
