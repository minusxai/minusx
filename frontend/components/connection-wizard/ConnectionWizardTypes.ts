export type ConnectionWizardStep = 'models' | 'connection' | 'questionnaire' | 'context' | 'generating' | 'slack';

export const WIZARD_STEP_LABELS: Record<ConnectionWizardStep, { number: number; label: string }> = {
  models: { number: 0, label: 'AI Models' },
  connection: { number: 1, label: 'Connect Data' },
  questionnaire: { number: 2, label: 'Add Context' },
  context: { number: 2, label: 'Add Context' },
  generating: { number: 3, label: 'Build' },
  slack: { number: 4, label: 'Slack' },
};

export interface QuestionnaireAnswers {
  datasetDescription: string;
  keyMetrics: string;
  dashboardPreference: string;
}

export interface ConnectionWizardProps {
  /** Starting step (default: 'connection'). Lets hello-world resume from saved config. */
  initialStep?: ConnectionWizardStep;
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
  /** Called when the entire wizard completes (after dashboard step). */
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
