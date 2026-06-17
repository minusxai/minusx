// Demo-only agent personas for the "Choose your agent" explore flow.
// This is intentionally a static, front-end-only config — picking an agent here
// is a cosmetic/persona affordance layered on top of the normal chat engine
// (it pre-fills starter prompts and labels the chat input). No orchestrator
// wiring; the underlying agent stays the same.

import type { IconType } from 'react-icons';
import { LuTrendingUp, LuWallet, LuCog, LuSparkles, LuTriangleAlert, LuArrowUpRight, LuEye } from 'react-icons/lu';

export type RecommendedActionTag = 'INTERNAL' | 'ATTENTION' | 'EXTERNAL';

export interface RecommendedAction {
  tag: RecommendedActionTag;
  /** The prompt sent when the card is clicked. */
  title: string;
  /** Small caption under the card. */
  source: string;
}

// A proactive finding the agent surfaced on its own during the overnight scan.
export type InsightSeverity = 'critical' | 'opportunity' | 'watch';

export interface ProactiveInsight {
  severity: InsightSeverity;
  /** Metric label, e.g. "Blended margin". */
  metric: string;
  /** Headline value, e.g. "29.1%". */
  value: string;
  /** Delta readout, e.g. "-2.3 pts". */
  delta: string;
  deltaDir: 'up' | 'down' | 'flat';
  /** Bold one-line finding. */
  headline: string;
  /** One-line rationale / where it came from. */
  detail: string;
  /** Prompt sent when the user digs in. */
  prompt: string;
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
  /** Findings the agent surfaced on its own — the proactive briefing. */
  proactiveInsights: ProactiveInsight[];
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
    proactiveInsights: [
      {
        severity: 'critical',
        metric: 'Blended margin',
        value: '29.1%',
        delta: '-2.3 pts',
        deltaDir: 'down',
        headline: 'Margin slipped below your 31% strategic floor',
        detail: 'Financial Services drag is offsetting industrial gains — concentrated in two units.',
        prompt: 'Blended margin fell below our 31% strategic floor — where is the drag and what should we do about it?',
      },
      {
        severity: 'opportunity',
        metric: 'Group revenue',
        value: '$48.2M',
        delta: '+6.4%',
        deltaDir: 'up',
        headline: 'Industrial Group is running two quarters ahead of plan',
        detail: 'Order backlog up 18% — pulling capex forward could compound the lead.',
        prompt: 'Industrial Group is beating plan by two quarters — should we pull capex forward to compound the lead?',
      },
      {
        severity: 'watch',
        metric: 'Supply exposure',
        value: '2 regions',
        delta: 'new signal',
        deltaDir: 'flat',
        headline: 'A rival just consolidated your #2 supplier region',
        detail: 'Cross-referenced from this week’s market signals — concentration risk rising.',
        prompt: 'A competitor consolidated our #2 supplier region — what is our exposure and how should we respond?',
      },
    ],
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
    proactiveInsights: [
      {
        severity: 'critical',
        metric: 'Days sales outstanding',
        value: '62 days',
        delta: '+9 days',
        deltaDir: 'up',
        headline: 'Receivables are aging faster than any quarter in two years',
        detail: '$4.1M is tied up beyond terms, concentrated in just six accounts.',
        prompt: 'DSO jumped to 62 days — which accounts are driving it and how do we accelerate collection?',
      },
      {
        severity: 'opportunity',
        metric: 'Cloud spend',
        value: '$310K/mo',
        delta: '-22% possible',
        deltaDir: 'down',
        headline: 'I found $68K/mo of idle committed-use capacity',
        detail: 'Reserved compute is running at 41% utilization across three projects.',
        prompt: 'Show me the idle reserved cloud capacity and the path to the $68K/mo savings.',
      },
      {
        severity: 'watch',
        metric: 'FX exposure',
        value: '€12.4M',
        delta: 'unhedged',
        deltaDir: 'flat',
        headline: 'Euro revenue is running unhedged into a volatile quarter',
        detail: 'A 5% swing moves operating income by roughly $0.6M.',
        prompt: 'Our €12.4M of euro revenue is unhedged — model the downside and propose a hedge plan.',
      },
    ],
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
    proactiveInsights: [
      {
        severity: 'critical',
        metric: 'On-time delivery',
        value: '88.6%',
        delta: '-4.2 pts',
        deltaDir: 'down',
        headline: 'Two sites dropped below your 92% SLA this week',
        detail: 'Traced to inbound dock scheduling — a sequencing issue, not capacity.',
        prompt: 'On-time delivery fell below SLA at two sites — what is the bottleneck and the fastest fix?',
      },
      {
        severity: 'opportunity',
        metric: 'Line 3 throughput',
        value: '1,240/day',
        delta: '+15% headroom',
        deltaDir: 'up',
        headline: 'Line 3 has spare capacity your demand can absorb',
        detail: 'Shift balancing could add ~180 units/day with no new headcount.',
        prompt: 'Line 3 has spare capacity — how do we absorb demand without adding headcount?',
      },
      {
        severity: 'watch',
        metric: 'Defect rate',
        value: '1.8%',
        delta: '+0.5 pts',
        deltaDir: 'up',
        headline: 'Quality is creeping up on the new supplier batch',
        detail: 'Isolated to a single component lot received nine days ago.',
        prompt: 'Defect rate is creeping up on the new supplier batch — should we quarantine or escalate?',
      },
    ],
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

// Generic, persona-agnostic proactive findings surfaced on the agent picker —
// the same shape as an agent's own briefing, but spanning the whole workspace
// rather than a single lens. These route to the General Agent (no persona yet).
export const WORKSPACE_INSIGHTS: ProactiveInsight[] = [
  {
    severity: 'opportunity',
    metric: 'Net revenue retention',
    value: '112%',
    delta: '+5 pts',
    deltaDir: 'up',
    headline: 'Expansion is outpacing churn for the third month running',
    detail: 'Driven by the enterprise segment — the upsell motion is working.',
    prompt: 'Net revenue retention hit 112% — break down what is driving expansion and where it can go further.',
  },
  {
    severity: 'critical',
    metric: 'Gross margin',
    value: '31.2%',
    delta: '-1.8 pts',
    deltaDir: 'down',
    headline: 'Margin dipped below your 33% target this month',
    detail: 'Input costs rose faster than price across two product lines.',
    prompt: 'Gross margin fell below our 33% target — which product lines are dragging it and what are the options?',
  },
  {
    severity: 'watch',
    metric: 'Pipeline coverage',
    value: '2.1x',
    delta: '-0.4x',
    deltaDir: 'down',
    headline: 'Next quarter’s pipeline is thinning against your 3x rule',
    detail: 'Top-of-funnel slowed over the last three weeks.',
    prompt: 'Pipeline coverage dropped to 2.1x for next quarter — where is the gap and how do we close it?',
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

// Maps a proactive-insight severity to its accent token + label + glyph.
export const SEVERITY_META: Record<InsightSeverity, { color: string; label: string; icon: IconType }> = {
  critical: { color: 'accent.danger', label: 'Critical', icon: LuTriangleAlert },
  opportunity: { color: 'accent.teal', label: 'Opportunity', icon: LuArrowUpRight },
  watch: { color: 'accent.warning', label: 'Watch', icon: LuEye },
};
