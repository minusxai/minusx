/** Public surface of the /debug conversation-visualization module. */
import { extractActualCalls } from './actual';
import { applyCosts, resolveRates } from './costs';
import { buildTurnBars } from './turns';
import type { ConvoDebugInput, ConvoDebugModel } from './types';

export type * from './types';
export { estimateTextTokens, estimateImageTokens } from './approx';
export { extractActualCalls, requestJsonToInput } from './actual';
export { deriveRatesFromUsage, resolveRates, applyCosts } from './costs';
export { buildTurnBars, type BareTurnBar } from './turns';
export { buildDebugVegaSpec, barCostLabel, segmentLabel, type CostMode, type DebugVegaRow } from './vega-spec';

export function buildConvoDebugModel(input: ConvoDebugInput): ConvoDebugModel {
  const rates = resolveRates(input);
  const calls = extractActualCalls(input.log);
  const bare = buildTurnBars(input);
  const { bars, totals } = applyCosts(bare, calls, rates);
  return { bars, calls, rates, totals };
}
