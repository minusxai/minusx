/**
 * Demo Agents slice: in-memory agent list for the /explore Agents hub.
 *
 * Holds the preset agents plus any published from the creation wizard, and
 * which agent (if any) is currently active in the explore chat. Demo-only:
 * nothing here persists beyond the client session.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { DemoAgent, PRESET_AGENTS } from '@/lib/agents/demo-agents';

interface AgentsState {
  agents: DemoAgent[];
  activeAgentSlug: string | null;
}

const initialState: AgentsState = {
  agents: PRESET_AGENTS,
  activeAgentSlug: null,
};

const agentsSlice = createSlice({
  name: 'agents',
  initialState,
  reducers: {
    /** Upsert by slug: publishing an existing slug replaces it (gear edit), a new slug appends. */
    publishAgent(state, action: PayloadAction<DemoAgent>) {
      const index = state.agents.findIndex(a => a.slug === action.payload.slug);
      if (index >= 0) {
        state.agents[index] = action.payload;
      } else {
        state.agents.push(action.payload);
      }
    },
    setActiveAgent(state, action: PayloadAction<string>) {
      state.activeAgentSlug = action.payload;
    },
    clearActiveAgent(state) {
      state.activeAgentSlug = null;
    },
  },
});

export const { publishAgent, setActiveAgent, clearActiveAgent } = agentsSlice.actions;
export default agentsSlice.reducer;

export const selectAgents = (state: { agents: AgentsState }) => state.agents.agents;
export const selectActiveAgent = (state: { agents: AgentsState }): DemoAgent | null => {
  const slug = state.agents.activeAgentSlug;
  if (!slug) return null;
  return state.agents.agents.find(a => a.slug === slug) ?? null;
};
