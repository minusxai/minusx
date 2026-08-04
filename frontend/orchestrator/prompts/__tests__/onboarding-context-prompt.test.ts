/**
 * Guards the grain-verification instruction in `onboarding_context.system`.
 *
 * Observed on a real onboarding run: the user described their CSV as "one row per order line",
 * and the agent wrote into the Knowledge Base "Its grain is one order line: an order can
 * therefore appear on multiple rows." In the uploaded data `order_id` was unique across all 500
 * rows. The agent had query access and never ran the one COUNT that would have settled it — it
 * restated the user's phrasing as an established structural fact.
 *
 * That claim is unusually expensive because it is inherited: the Knowledge Base grounds every
 * query written afterwards, so a false "this key repeats" produces needless de-duplication that
 * silently changes results, indefinitely, without ever looking like an error.
 *
 * WHAT THIS TEST DOES AND DOES NOT PROVE: it pins that the instruction is present and reaches
 * the rendered prompt. It cannot show the model obeys it — only a real run can, and this change
 * is verified end to end against a deployment. The value here is that the instruction cannot be
 * silently dropped by an unrelated edit to a 3000-line YAML file.
 */

import { describe, it, expect } from 'vitest';
import { renderPrompt } from '../index';

const VARS = {
  agent_name: 'MinusX',
  schema: 'sales_orders_2026.sales_orders(order_id, order_date, revenue)',
  connection_id: 'static',
  max_steps: '15',
  contexts_skill: '',
};

describe('onboarding_context.system — structural claims must be verified', () => {
  const prompt = renderPrompt('onboarding_context.system', VARS);

  it('renders', () => {
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('tells the agent the user description is a hint, not a fact', () => {
    expect(prompt).toMatch(/HINT, not an established fact/i);
  });

  it('names grain as the thing to verify, and how', () => {
    expect(prompt).toMatch(/grain/i);
    expect(prompt).toMatch(/COUNT\(DISTINCT/i);
  });

  it('offers attribution as the alternative to verifying', () => {
    expect(prompt).toMatch(/attribute it/i);
  });

  it('says why it matters — inherited by every later query', () => {
    expect(prompt).toMatch(/DISTINCT\/de-duplication|silently changes results/i);
  });

  it('still carries the pre-existing factuality rule it sits beside', () => {
    expect(prompt).toMatch(/only describe what you see in the schema/i);
  });
});
