/**
 * Centralized onboarding state management.
 * All logic for determining wizard step lives here — consumed by:
 *   - middleware.ts (server-side redirect on /)
 *   - app/page.tsx (client-side redirect on /)
 *   - HelloWorldContent.tsx (auto-detect step when visiting /hello-world)
 *
 * State is stored in URL search params so refresh preserves position:
 *   ?step=context&connectionName=mydb&connectionId=42
 */

export type WizardStep = 'welcome' | 'connection' | 'context' | 'generating' | 'complete';

export interface OnboardingState {
  step: WizardStep;
  connectionId: number | null;
  connectionName: string | null;
  contextFileId: number | null;
}

/** Whether the user still needs onboarding (no connections or no context in org mode) */
export interface OnboardingCheck {
  needsOnboarding: boolean;
  /** The URL path to redirect to (e.g., '/hello-world' or '/hello-world?step=context&...') */
  redirectPath: string | null;
}

/**
 * Core detection logic: determine onboarding state from a list of connections and contexts.
 * Works with any shape — just needs arrays with { id, name } on connections.
 *
 * Used by middleware (server), page.tsx (client), and HelloWorldContent (client).
 */
/**
 * Onboarding stages:
 * 1. No connections → welcome (choose demo or connect)
 * 2. Connection exists, no context → context step
 * 3. Connection + context exist, no dashboards/questions → generating step (TODO: auto-dashboard)
 * 4. All exist → onboarding complete
 */
export function detectOnboardingState(
  connections: Array<{ id: number; name: string }>,
  contexts: Array<unknown>,
  /** Optional: pass questions/dashboards to detect stage 3 */
  questions?: Array<unknown>,
    dashboards?: Array<unknown>,
): OnboardingCheck {
  if (connections.length === 0) {
    return { needsOnboarding: true, redirectPath: '/hello-world' };
  }

  // check if truly new user with no setup
  if (contexts.length === 0 && questions !== undefined && questions.length === 0 && dashboards !== undefined && dashboards.length === 0) {
    const conn = connections[0];
    const params = new URLSearchParams({
      step: 'context',
      connectionName: conn.name,
      connectionId: String(conn.id),
    });
    return { needsOnboarding: true, redirectPath: `/hello-world?${params}` };
  }

  // Connection + context exist but no questions → generating step
  if (questions !== undefined && questions.length === 0 && dashboards !== undefined && dashboards.length === 0) {
    const conn = connections[0];
    const params = new URLSearchParams({
      step: 'generating',
      connectionName: conn.name,
    });
    return { needsOnboarding: true, redirectPath: `/hello-world?${params}` };
  }

  return { needsOnboarding: false, redirectPath: null };
}

/**
 * Same as detectOnboardingState but returns an OnboardingState (for HelloWorldContent).
 */
export function detectStepFromSystemState(
  connections: Array<{ id: number; name: string }>,
  contexts: Array<unknown>,
  questions?: Array<unknown>,
): OnboardingState {
  if (connections.length === 0) {
    return { step: 'welcome', connectionId: null, connectionName: null, contextFileId: null };
  }

  if (contexts.length === 0) {
    const conn = connections[0];
    return { step: 'context', connectionId: conn.id, connectionName: conn.name, contextFileId: null };
  }

  if (questions !== undefined && questions.length === 0) {
    const conn = connections[0];
    return { step: 'generating', connectionId: conn.id, connectionName: conn.name, contextFileId: null };
  }

  // All setup done → complete step (shows getting started / next actions)
  return { step: 'complete', connectionId: null, connectionName: null, contextFileId: null };
}

// ─── URL params ───

const VALID_STEPS: WizardStep[] = ['welcome', 'connection', 'context', 'generating', 'complete'];

/** Read onboarding state from URL search params */
export function readStateFromURL(searchParams: URLSearchParams): OnboardingState {
  const stepParam = searchParams.get('step');
  const step: WizardStep = (stepParam && VALID_STEPS.includes(stepParam as WizardStep))
    ? stepParam as WizardStep
    : 'welcome';

  const connectionIdParam = searchParams.get('connectionId');
  const connectionId = connectionIdParam ? parseInt(connectionIdParam, 10) : null;
  const connectionName = searchParams.get('connectionName');
  const contextFileIdParam = searchParams.get('contextFileId');
  const contextFileId = contextFileIdParam ? parseInt(contextFileIdParam, 10) : null;

  // Validate: later steps require earlier step data
  if (step === 'context' && !connectionName) return { step: 'connection', connectionId: null, connectionName: null, contextFileId: null };
  if (step === 'generating' && !connectionName) return { step: 'connection', connectionId: null, connectionName: null, contextFileId: null };

  return { step, connectionId, connectionName, contextFileId };
}

/** Build URL search params string for a given state (excludes leading ?) */
export function buildSearchParams(state: OnboardingState): string {
  const params = new URLSearchParams();
  if (state.step !== 'welcome') {
    params.set('step', state.step);
  }
  if (state.connectionName) params.set('connectionName', state.connectionName);
  if (state.connectionId !== null) params.set('connectionId', String(state.connectionId));
  if (state.contextFileId !== null) params.set('contextFileId', String(state.contextFileId));
  return params.toString();
}

// ─── UI constants ───

export const STEP_LABELS: Record<Exclude<WizardStep, 'welcome'>, { number: number; label: string }> = {
  connection: { number: 1, label: 'Connect Data' },
  context: { number: 2, label: 'Add Context' },
  generating: { number: 3, label: 'Build' },
  complete: { number: 4, label: 'Explore' },
};
