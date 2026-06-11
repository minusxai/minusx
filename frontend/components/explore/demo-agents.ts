// Demo-only agent personas for the "Choose your agent" explore flow.
// This is intentionally a static, front-end-only config — picking an agent here
// is a cosmetic/persona affordance layered on top of the normal chat engine
// (it pre-fills starter prompts and labels the chat input). No orchestrator
// wiring; the underlying agent stays the same.

import type { IconType } from 'react-icons';
import { LuTrendingUp, LuWallet, LuCog, LuSparkles } from 'react-icons/lu';

export type RecommendedActionTag = 'INTERNAL' | 'ATTENTION' | 'EXTERNAL';

export interface RecommendedAction {
  tag: RecommendedActionTag;
  /** The prompt sent when the card is clicked. */
  title: string;
  /** Small caption under the card. */
  source: string;
}

export interface DemoBusinessUnit {
  id: string;
  name: string;
  subtitle: string;
}

export interface DemoAgent {
  id: string;
  icon: IconType;
  name: string;
  /** Short role line, e.g. "Strategy & Growth". */
  role: string;
  /** One-line eyebrow describing the lens. */
  tagline: string;
  /** Theme accent token. */
  color: string;
  description: string;
  /** Chips shown on the picker card. */
  topics: string[];
  recommendedActions: RecommendedAction[];
}

// Default agent shown in the chat-input dropdown before any persona is chosen.
export const GENERAL_AGENT = {
  id: 'general',
  icon: LuSparkles as IconType,
  name: 'General Agent',
  role: 'Ad-hoc analysis',
  color: 'accent.primary',
};

// Business units the agent can "represent". Shared across all agents.
export const BUSINESS_UNITS: DemoBusinessUnit[] = [
  { id: 'holding', name: 'Holding Company', subtitle: 'Consolidated group' },
  { id: 'industrial', name: 'Industrial Group', subtitle: 'Manufacturing & logistics' },
  { id: 'financial', name: 'Financial Services', subtitle: 'Banking & insurance arm' },
];

export const DEMO_AGENTS: DemoAgent[] = [
  {
    id: 'ceo',
    icon: LuTrendingUp,
    name: 'CEO Agent',
    role: 'Strategy & Growth',
    tagline: 'Strategic',
    color: 'accent.teal',
    description:
      'Executive summaries, forward-looking strategy, growth plays and tough calls, informed by the latest internal data.',
    topics: ['Exec Summary', 'Strategy', 'M&A', 'Industry POV'],
    recommendedActions: [
      { tag: 'INTERNAL', title: "Give me this quarter's executive summary across all business units", source: "From this quarter's pack" },
      { tag: 'ATTENTION', title: 'Where are we losing efficiency, and what is the strategic response?', source: 'Cross-BU analysis' },
      { tag: 'EXTERNAL', title: 'How are we positioned versus the top competitors this quarter?', source: 'Market scan' },
      { tag: 'INTERNAL', title: 'Draft a 90-day plan to revitalize our weakest segment', source: 'Strategy roadmap' },
      { tag: 'ATTENTION', title: 'Can we cut costs without hurting our growth bets?', source: 'Capital allocation' },
      { tag: 'EXTERNAL', title: 'What M&A targets fit our balance sheet right now?', source: 'Industry scan' },
    ],
  },
  {
    id: 'cfo',
    icon: LuWallet,
    name: 'CFO Agent',
    role: 'Finance & Margins',
    tagline: 'Financial',
    color: 'accent.primary',
    description:
      'P&L and balance-sheet variance, forecasts, cost optimization and cash-flow recommendations.',
    topics: ['P&L', 'Variance', 'Forecast', 'Cash Flow'],
    recommendedActions: [
      { tag: 'INTERNAL', title: 'Walk me through the YTD variance versus budget', source: 'Latest close' },
      { tag: 'ATTENTION', title: 'Which costs are increasing fastest, and why?', source: 'Cost watch' },
      { tag: 'INTERNAL', title: "What is our current burn rate and runway?", source: 'Treasury view' },
      { tag: 'EXTERNAL', title: 'How do our margins compare to industry benchmarks?', source: 'Benchmark feed' },
      { tag: 'INTERNAL', title: 'Forecast cash flow for the next two quarters', source: 'Planning model' },
      { tag: 'ATTENTION', title: 'Where is working capital getting tied up?', source: 'Balance sheet' },
    ],
  },
  {
    id: 'coo',
    icon: LuCog,
    name: 'COO Agent',
    role: 'Operations & Throughput',
    tagline: 'Operational',
    color: 'accent.secondary',
    description:
      'Operational KPIs, throughput, capacity and customer metrics. Surfaces bottlenecks and recommends pipeline fixes.',
    topics: ['Ops KPIs', 'Bottlenecks', 'Pipeline', 'SLAs'],
    recommendedActions: [
      { tag: 'INTERNAL', title: 'Which operational KPIs are off target this month?', source: 'Ops dashboard' },
      { tag: 'ATTENTION', title: 'Where are the biggest bottlenecks in our pipeline?', source: 'Throughput review' },
      { tag: 'INTERNAL', title: 'How is capacity utilization trending by site?', source: 'Capacity report' },
      { tag: 'EXTERNAL', title: 'Are we meeting our SLAs across regions?', source: 'Service levels' },
      { tag: 'ATTENTION', title: 'Where can we recover efficiency without adding headcount?', source: 'Efficiency scan' },
      { tag: 'INTERNAL', title: 'Show on-time delivery rates by product line', source: 'Fulfillment data' },
    ],
  },
];

export interface AgentSelection {
  /** 'general' or a DemoAgent id. */
  agentId: string;
  businessUnitId?: string;
}

export const DEFAULT_AGENT_SELECTION: AgentSelection = { agentId: 'general' };

export function getDemoAgent(id: string): DemoAgent | undefined {
  return DEMO_AGENTS.find((a) => a.id === id);
}

export function getBusinessUnit(id?: string): DemoBusinessUnit | undefined {
  return id ? BUSINESS_UNITS.find((b) => b.id === id) : undefined;
}

// Maps a recommended-action tag to its accent token + label.
export const TAG_META: Record<RecommendedActionTag, { color: string; label: string }> = {
  INTERNAL: { color: 'accent.success', label: 'Internal' },
  ATTENTION: { color: 'accent.danger', label: 'Attention' },
  EXTERNAL: { color: 'accent.secondary', label: 'External' },
};
