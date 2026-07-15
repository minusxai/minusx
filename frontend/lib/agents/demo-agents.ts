/**
 * Demo agent definitions for the /explore Agents hub.
 *
 * Everything here is in-memory demo data: preset agents, the tool/skill
 * catalogs shown in the creation wizard, and the icon/accent palettes.
 * Icons are stored as string keys (Redux-serializable) and resolved to
 * react-icons components via AGENT_ICONS at render time.
 */

import type { IconType } from 'react-icons';
import {
  LuBriefcase,
  LuLandmark,
  LuTrendingUp,
  LuWorkflow,
  LuShieldCheck,
  LuMegaphone,
  LuBot,
  LuSparkles,
  LuUsers,
  LuRocket,
} from 'react-icons/lu';

export type AgentIconKey =
  | 'briefcase'
  | 'landmark'
  | 'trendingUp'
  | 'workflow'
  | 'shieldCheck'
  | 'megaphone'
  | 'bot'
  | 'sparkles'
  | 'users'
  | 'rocket';

export const AGENT_ICONS: Record<AgentIconKey, IconType> = {
  briefcase: LuBriefcase,
  landmark: LuLandmark,
  trendingUp: LuTrendingUp,
  workflow: LuWorkflow,
  shieldCheck: LuShieldCheck,
  megaphone: LuMegaphone,
  bot: LuBot,
  sparkles: LuSparkles,
  users: LuUsers,
  rocket: LuRocket,
};

/** Accent tokens an agent can use, with human labels for the wizard's color picker. */
export const AGENT_ACCENTS: { token: string; label: string }[] = [
  { token: 'accent.teal', label: 'Teal' },
  { token: 'accent.primary', label: 'Blue' },
  { token: 'accent.secondary', label: 'Purple' },
  { token: 'accent.cyan', label: 'Turquoise' },
  { token: 'accent.success', label: 'Green' },
  { token: 'accent.warning', label: 'Orange' },
];

export interface AgentQuestionSection {
  title: string;
  questions: string[];
}

/** Severity of a proactive briefing insight. */
export type InsightTone = 'critical' | 'opportunity' | 'watch';

export interface AgentInsight {
  /** The big number, e.g. '29.1%' or '2 regions'. */
  stat: string;
  /** Small chip next to the stat, e.g. '-2.3 pts' or 'new signal'. */
  delta: string;
  tone: InsightTone;
  title: string;
  detail: string;
}

export interface DemoAgent {
  slug: string;
  name: string;
  icon: AgentIconKey;
  accent: string;
  description: string;
  goal: string;
  greeting: string;
  systemPrompt: string;
  tools: string[];
  skills: string[];
  questionSections: AgentQuestionSection[];
  /** Fake proactive-briefing insights shown on the agent's welcome screen. */
  insights?: AgentInsight[];
  preset?: boolean;
}

export interface AgentCapability {
  id: string;
  label: string;
  description: string;
}

export const AVAILABLE_TOOLS: AgentCapability[] = [
  { id: 'sql', label: 'SQL Query Engine', description: 'Run read-only queries against connected warehouses' },
  { id: 'charts', label: 'Visualization', description: 'Render charts and tables inline in answers' },
  { id: 'dashboards', label: 'Dashboard Search', description: 'Find and reference existing dashboards and questions' },
  { id: 'files', label: 'File Access', description: 'Read saved questions, notebooks, and reports' },
  { id: 'web', label: 'Web Research', description: 'Pull public market and benchmark data' },
  { id: 'alerts', label: 'Alerts', description: 'Schedule threshold-based notifications' },
  { id: 'slack', label: 'Slack Notifications', description: 'Post summaries and alerts to Slack channels' },
];

export const AVAILABLE_SKILLS: AgentCapability[] = [
  { id: 'revenue-analysis', label: 'Revenue Analysis', description: 'Break down revenue by segment, product, and period' },
  { id: 'cohort-retention', label: 'Cohort Retention', description: 'Build and interpret cohort retention curves' },
  { id: 'forecasting', label: 'Forecasting', description: 'Project trends with seasonality-aware estimates' },
  { id: 'anomaly-detection', label: 'Anomaly Detection', description: 'Flag unusual spikes, drops, and outliers' },
  { id: 'executive-summaries', label: 'Executive Summaries', description: 'Turn analysis into crisp leadership-ready narratives' },
  { id: 'data-profiling', label: 'Data Profiling', description: 'Inspect table shape, freshness, and quality' },
  { id: 'funnel-analysis', label: 'Funnel Analysis', description: 'Measure conversion across multi-step funnels' },
];

export function buildPromptTemplate(name: string, goal: string): string {
  const trimmedGoal = goal.trim();
  return [
    `You are the ${name.trim() || 'agent'} for this workspace.`,
    trimmedGoal ? `Your mandate: ${trimmedGoal}` : 'Your mandate: help the team answer questions with data.',
    '',
    'Always ground answers in queried data, cite the tables you used, and prefer clear visualizations over long prose. When a question is ambiguous, state your assumption and proceed. Flag any data quality concerns you notice along the way.',
  ].join('\n');
}

export const PRESET_AGENTS: DemoAgent[] = [
  {
    slug: 'ceo-agent',
    name: 'CEO Agent',
    icon: 'briefcase',
    accent: 'accent.teal',
    description: 'Your executive briefing partner. Tracks company-wide KPIs, growth trends, and board-ready summaries.',
    goal: 'Give leadership a clear, always-current picture of how the business is performing.',
    greeting: 'Hi, I am your CEO Agent. Ask me anything about how the business is doing.',
    systemPrompt: buildPromptTemplate('CEO Agent', 'Give leadership a clear, always-current picture of how the business is performing.'),
    tools: ['sql', 'charts', 'dashboards', 'files'],
    skills: ['revenue-analysis', 'forecasting', 'executive-summaries'],
    questionSections: [
      {
        title: 'Company Pulse',
        questions: [
          'How did we do this quarter compared to last quarter?',
          'What are the top 3 metrics moving this month?',
          'Show me our revenue trend for the past year',
        ],
      },
      {
        title: 'Board Prep',
        questions: [
          'Draft a one-paragraph summary of business performance',
          'What are the biggest risks in the numbers right now?',
        ],
      },
    ],
    insights: [
      {
        stat: '29.1%',
        delta: '-2.3 pts',
        tone: 'critical',
        title: 'Operating margin slipped below the 31% floor',
        detail: 'Services drag is offsetting product gains, concentrated in two units.',
      },
      {
        stat: '$48.2M',
        delta: '+6.4%',
        tone: 'opportunity',
        title: 'Enterprise segment is two quarters ahead of plan',
        detail: 'Order backlog up 18%. Pulling capex forward could compound the lead.',
      },
      {
        stat: '2 regions',
        delta: 'new signal',
        tone: 'watch',
        title: 'Supplier concentration rising in your #2 region',
        detail: 'Cross-referenced from this week\'s market signals.',
      },
    ],
    preset: true,
  },
  {
    slug: 'cfo-agent',
    name: 'CFO Agent',
    icon: 'landmark',
    accent: 'accent.primary',
    description: 'Finance-first analysis. Revenue, margins, burn, and forecasts with audit-friendly rigor.',
    goal: 'Keep the finance picture accurate: revenue, margins, spend, and forward-looking forecasts.',
    greeting: 'Hi, I am your CFO Agent. Let us dig into revenue, margins, and forecasts.',
    systemPrompt: buildPromptTemplate('CFO Agent', 'Keep the finance picture accurate: revenue, margins, spend, and forward-looking forecasts.'),
    tools: ['sql', 'charts', 'dashboards', 'alerts'],
    skills: ['revenue-analysis', 'forecasting', 'anomaly-detection'],
    questionSections: [
      {
        title: 'Revenue',
        questions: [
          'What does our monthly revenue trend look like?',
          'Break down revenue by segment this year',
          'Which products drive the most revenue?',
        ],
      },
      {
        title: 'Forecasting',
        questions: [
          'Project next quarter revenue from current trends',
          'Are there any concerning changes in spend?',
        ],
      },
    ],
    insights: [
      {
        stat: '$3.1M',
        delta: '-4.8%',
        tone: 'critical',
        title: 'Gross margin leakage in refunds and credits',
        detail: 'Refund rate has doubled in the value tier since March.',
      },
      {
        stat: '14.2 mo',
        delta: '+1.9 mo',
        tone: 'opportunity',
        title: 'Runway extended on better collections',
        detail: 'Days sales outstanding improved from 51 to 38 over the quarter.',
      },
      {
        stat: '3 vendors',
        delta: 'renewals due',
        tone: 'watch',
        title: 'Major contract renewals land in the same month',
        detail: 'Combined exposure is 9% of quarterly operating spend.',
      },
    ],
    preset: true,
  },
  {
    slug: 'growth-agent',
    name: 'Growth Agent',
    icon: 'trendingUp',
    accent: 'accent.secondary',
    description: 'Funnel and retention specialist. Finds where users convert, churn, and compound.',
    goal: 'Find where users convert, where they churn, and what makes them stick.',
    greeting: 'Hi, I am your Growth Agent. Let us find out where users convert and churn.',
    systemPrompt: buildPromptTemplate('Growth Agent', 'Find where users convert, where they churn, and what makes them stick.'),
    tools: ['sql', 'charts', 'dashboards'],
    skills: ['funnel-analysis', 'cohort-retention', 'anomaly-detection'],
    questionSections: [
      {
        title: 'Acquisition',
        questions: [
          'What does signup conversion look like by channel?',
          'Which acquisition channel grew fastest recently?',
        ],
      },
      {
        title: 'Retention',
        questions: [
          'Show cohort retention over the last 12 weeks',
          'Which customer segment churns fastest?',
        ],
      },
    ],
    insights: [
      {
        stat: '38%',
        delta: '-6 pts',
        tone: 'critical',
        title: 'Week-4 retention dipped for March cohorts',
        detail: 'The drop is concentrated in users acquired via paid social.',
      },
      {
        stat: '2.4x',
        delta: '+0.6x',
        tone: 'opportunity',
        title: 'Referral loop compounding in SMB accounts',
        detail: 'Invites per activated user just hit an all-time high.',
      },
      {
        stat: '11%',
        delta: 'flat 3 wks',
        tone: 'watch',
        title: 'Signup-to-activation stuck for three weeks',
        detail: 'The funnel stalls at the connect-your-data step.',
      },
    ],
    preset: true,
  },
  {
    slug: 'ops-agent',
    name: 'Ops Agent',
    icon: 'workflow',
    accent: 'accent.cyan',
    description: 'Keeps the machine running. Throughput, SLAs, bottlenecks, and capacity planning.',
    goal: 'Watch throughput, SLAs, and bottlenecks so operations never surprises us.',
    greeting: 'Hi, I am your Ops Agent. Ask me about throughput, SLAs, and bottlenecks.',
    systemPrompt: buildPromptTemplate('Ops Agent', 'Watch throughput, SLAs, and bottlenecks so operations never surprises us.'),
    tools: ['sql', 'charts', 'alerts', 'slack'],
    skills: ['anomaly-detection', 'data-profiling', 'forecasting'],
    questionSections: [
      {
        title: 'Throughput',
        questions: [
          'How has order fulfillment time trended this quarter?',
          'Where is our biggest operational bottleneck?',
        ],
      },
      {
        title: 'Reliability',
        questions: [
          'Were there any SLA breaches this month?',
          'Which processes have the most variance?',
        ],
      },
    ],
    insights: [
      {
        stat: '4.6 days',
        delta: '+0.8 d',
        tone: 'critical',
        title: 'Fulfillment time trending past the 4-day SLA',
        detail: 'Backlog is building at the packaging stage specifically.',
      },
      {
        stat: '92%',
        delta: '+3 pts',
        tone: 'opportunity',
        title: 'First-pass yield improving after line changes',
        detail: 'Scrap rate is at its lowest in six months.',
      },
      {
        stat: '2 sites',
        delta: '>85% util',
        tone: 'watch',
        title: 'Two warehouses running above safe utilization',
        detail: 'Peak season starts in six weeks. Capacity plan needed.',
      },
    ],
    preset: true,
  },
  {
    slug: 'data-quality-agent',
    name: 'Data Quality Agent',
    icon: 'shieldCheck',
    accent: 'accent.success',
    description: 'Trust but verify. Profiles tables, flags anomalies, and watches data freshness.',
    goal: 'Profile tables, flag anomalies, and make sure the data everyone relies on stays trustworthy.',
    greeting: 'Hi, I am your Data Quality Agent. Let us make sure the data holds up.',
    systemPrompt: buildPromptTemplate('Data Quality Agent', 'Profile tables, flag anomalies, and make sure the data everyone relies on stays trustworthy.'),
    tools: ['sql', 'charts', 'files', 'alerts'],
    skills: ['data-profiling', 'anomaly-detection'],
    questionSections: [
      {
        title: 'Freshness',
        questions: [
          'Which tables look stale or have gaps?',
          'When was each core table last updated?',
        ],
      },
      {
        title: 'Anomalies',
        questions: [
          'Any suspicious spikes or drops this week?',
          'Profile the orders table for quality issues',
        ],
      },
    ],
    insights: [
      {
        stat: '3 tables',
        delta: '18h behind',
        tone: 'critical',
        title: 'Core tables missed their overnight refresh',
        detail: 'orders, payments, and sessions are all running stale.',
      },
      {
        stat: '99.2%',
        delta: '+0.4 pts',
        tone: 'opportunity',
        title: 'Schema test pass rate at a record high',
        detail: 'New contract checks caught 12 issues before merge.',
      },
      {
        stat: '+41%',
        delta: 'spike',
        tone: 'watch',
        title: 'Null rate spiked in the leads source column',
        detail: 'Started right after Tuesday\'s tracking release.',
      },
    ],
    preset: true,
  },
  {
    slug: 'marketing-agent',
    name: 'Marketing Agent',
    icon: 'megaphone',
    accent: 'accent.warning',
    description: 'Campaign and channel performance. Spend, attribution, and the creative that converts.',
    goal: 'Track campaign performance, channel efficiency, and where marketing spend pays off.',
    greeting: 'Hi, I am your Marketing Agent. Let us see which campaigns are working.',
    systemPrompt: buildPromptTemplate('Marketing Agent', 'Track campaign performance, channel efficiency, and where marketing spend pays off.'),
    tools: ['sql', 'charts', 'dashboards', 'web'],
    skills: ['funnel-analysis', 'revenue-analysis', 'executive-summaries'],
    questionSections: [
      {
        title: 'Campaigns',
        questions: [
          'What is our ROAS by campaign for the last 30 days?',
          'Which campaigns are underperforming their targets?',
        ],
      },
      {
        title: 'Channels',
        questions: [
          'Which channel has the best cost per acquisition?',
          'How does organic compare to paid this quarter?',
        ],
      },
    ],
    insights: [
      {
        stat: '1.8x',
        delta: '-0.5x',
        tone: 'critical',
        title: 'Paid search ROAS dropped below target',
        detail: 'Cost per click is up 22% while conversion held flat.',
      },
      {
        stat: '$212',
        delta: '-18%',
        tone: 'opportunity',
        title: 'Organic acquisition cost keeps falling',
        detail: 'Content-led signups are now a third of new pipeline.',
      },
      {
        stat: '2 campaigns',
        delta: 'ends 18th',
        tone: 'watch',
        title: 'Top campaigns exhaust budget mid-month',
        detail: 'Reallocation needed before the 18th to hold volume.',
      },
    ],
    preset: true,
  },
];
