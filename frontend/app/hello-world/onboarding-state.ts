/**
 * Wizard step type definitions and UI constants.
 * Onboarding completion state is stored in the company config document
 * (config.setupWizard.status: 'pending' | 'complete').
 */

export type WizardStep = 'welcome' | 'connection' | 'context' | 'generating';

// ─── UI constants ───

export const STEP_LABELS: Record<Exclude<WizardStep, 'welcome'>, { number: number; label: string }> = {
  connection: { number: 1, label: 'Connect Data' },
  context: { number: 2, label: 'Add Context' },
  generating: { number: 3, label: 'Build' },
};
