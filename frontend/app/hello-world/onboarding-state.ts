/**
 * Wizard step type definitions and UI constants.
 * Onboarding completion state is stored in the org config document
 * (config.setupWizard.status: 'pending' | 'complete').
 */

import { type ConnectionWizardStep } from '@/components/connection-wizard/ConnectionWizardTypes';

export type WizardStep = 'welcome' | ConnectionWizardStep;
