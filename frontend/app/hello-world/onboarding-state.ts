/**
 * Wizard step type definitions and UI constants.
 * Onboarding completion state is stored in the org config document
 * (config.setupWizard.status: 'pending' | 'complete').
 */

import { type ConnectionWizardStep, WIZARD_STEP_LABELS } from '@/components/connection-wizard/ConnectionWizardTypes';

export type WizardStep = 'welcome' | ConnectionWizardStep;

// Re-export for consumers that only need the wizard step labels
export const STEP_LABELS = WIZARD_STEP_LABELS;
