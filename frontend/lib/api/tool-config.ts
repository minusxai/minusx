import { ToolNames } from '@/lib/types';
import ExecuteSQLDisplay from '@/components/explore/tools/ExecuteSQLDisplay';
import DefaultToolDisplay from '@/components/explore/tools/DefaultToolDisplay';
import ContentDisplay from '@/components/explore/tools/ContentDisplay';
import ClarifyDisplay from '@/components/explore/tools/ClarifyDisplay';
import NavigateDisplay from '@/components/explore/tools/NavigateDisplay';
import EditFileDisplay from '@/components/explore/tools/EditFileDisplay';
import ReadFilesDisplay from '@/components/explore/tools/ReadFilesDisplay';
import SearchFilesDisplay from '@/components/explore/tools/SearchFilesDisplay';
import CreateFileDisplay from '@/components/explore/tools/CreateFileDisplay';
import SearchDBSchemaDisplay from '@/components/explore/tools/SearchDBSchemaDisplay';
import PublishAllDisplay from '@/components/explore/tools/PublishAllDisplay';
import LoadSkillDisplay from '@/components/explore/tools/LoadSkillDisplay';
import { DisplayProps } from '@/lib/types';
import type { IconType } from 'react-icons/lib';
import {
  LuDatabase, LuMessageSquare, LuBadgeInfo, LuArrowRight,
  LuPencilLine, LuBookOpen, LuSearch, LuFilePlus2,
  LuUpload, LuBookMarked, LuWrench, LuBrain,
} from 'react-icons/lu';

/**
 * Tool tier classification:
 * - Tier 1: Always prominent (AI text, charts, clarify prompts)
 * - Tier 2: Compact single line, always visible (has interactive elements like undo/redo)
 * - Tier 3: Grouped & collapsed into chips/rail in compact view
 */
export type ToolTier = 1 | 2 | 3;

// Tool configuration interface
export interface ToolConfig {
  displayComponent: React.ComponentType<DisplayProps> | null;
  tier: ToolTier;
  chipLabel: string;        // Singular noun: "thought", "file edit", "search"
  chipLabelPlural: string;  // Plural noun: "thoughts", "file edits", "searches"
  chipIcon: IconType;       // Icon shown in chip/rail badge
  chipColor: string;        // Accent color token for chip tinting (e.g. "accent.primary")
  timelineVerb: string;     // Present participle for timeline: "Creating", "Editing", etc.
}

// Centralized tool configurations
export const TOOL_CONFIGS: Record<string, ToolConfig> = {
  [ToolNames.EXECUTE_QUERY]: {
    displayComponent: ExecuteSQLDisplay,
    tier: 1,
    chipLabel: 'query',
    chipLabelPlural: 'queries',
    chipIcon: LuDatabase,
    chipColor: 'accent.primary',
    timelineVerb: 'Querying',
  },
  'Clarify': {
    displayComponent: ClarifyDisplay,
    tier: 1,
    chipLabel: 'clarification',
    chipLabelPlural: 'clarifications',
    chipIcon: LuBadgeInfo,
    chipColor: 'accent.primary',
    timelineVerb: 'Clarifying',
  },
  'ClarifyFrontend': {
    displayComponent: null,
    tier: 1,
    chipLabel: 'clarification',
    chipLabelPlural: 'clarifications',
    chipIcon: LuBadgeInfo,
    chipColor: 'accent.primary',
    timelineVerb: 'Clarifying',
  },
  [ToolNames.TALK_TO_USER]: {
    displayComponent: ContentDisplay,
    tier: 1,
    chipLabel: 'thought',
    chipLabelPlural: 'thoughts',
    chipIcon: LuBrain,
    chipColor: 'fg.muted',
    timelineVerb: 'Thinking',
  },
  [ToolNames.ANALYST_AGENT]: {
    displayComponent: ContentDisplay,
    tier: 1,
    chipLabel: 'thought',
    chipLabelPlural: 'thoughts',
    chipIcon: LuBrain,
    chipColor: 'fg.muted',
    timelineVerb: 'Thinking',
  },
  [ToolNames.ATLAS_ANALYST_AGENT]: {
    displayComponent: ContentDisplay,
    tier: 1,
    chipLabel: 'thought',
    chipLabelPlural: 'thoughts',
    chipIcon: LuBrain,
    chipColor: 'fg.muted',
    timelineVerb: 'Thinking',
  },
  [ToolNames.TEST_AGENT]: {
    displayComponent: ContentDisplay,
    tier: 1,
    chipLabel: 'test',
    chipLabelPlural: 'tests',
    chipIcon: LuBrain,
    chipColor: 'fg.muted',
    timelineVerb: 'Thinking',
  },
  [ToolNames.ONBOARDING_CONTEXT_AGENT]: {
    displayComponent: ContentDisplay,
    tier: 1,
    chipLabel: 'onboarding step',
    chipLabelPlural: 'onboarding steps',
    chipIcon: LuMessageSquare,
    chipColor: 'fg.muted',
    timelineVerb: 'Thinking',
  },
  [ToolNames.ONBOARDING_DASHBOARD_AGENT]: {
    displayComponent: ContentDisplay,
    tier: 1,
    chipLabel: 'onboarding step',
    chipLabelPlural: 'onboarding steps',
    chipIcon: LuMessageSquare,
    chipColor: 'fg.muted',
    timelineVerb: 'Thinking',
  },
  [ToolNames.SLACK_AGENT]: {
    displayComponent: ContentDisplay,
    tier: 1,
    chipLabel: 'message',
    chipLabelPlural: 'messages',
    chipIcon: LuMessageSquare,
    chipColor: 'accent.primary',
    timelineVerb: 'Messaging',
  },
  'Navigate': {
    displayComponent: NavigateDisplay,
    tier: 3,
    chipLabel: 'navigation',
    chipLabelPlural: 'navigations',
    chipIcon: LuArrowRight,
    chipColor: 'accent.teal',
    timelineVerb: 'Navigating',
  },
  'EditFile': {
    displayComponent: EditFileDisplay,
    tier: 2,
    chipLabel: 'file edit',
    chipLabelPlural: 'file edits',
    chipIcon: LuPencilLine,
    chipColor: 'accent.secondary',
    timelineVerb: 'Editing',
  },
  'ReadFiles': {
    displayComponent: ReadFilesDisplay,
    tier: 3,
    chipLabel: 'file read',
    chipLabelPlural: 'file reads',
    chipIcon: LuBookOpen,
    chipColor: 'accent.primary',
    timelineVerb: 'Reading',
  },
  'SearchFiles': {
    displayComponent: SearchFilesDisplay,
    tier: 3,
    chipLabel: 'search',
    chipLabelPlural: 'searches',
    chipIcon: LuSearch,
    chipColor: 'accent.cyan',
    timelineVerb: 'Searching',
  },
  'CreateFile': {
    displayComponent: CreateFileDisplay,
    tier: 3,
    chipLabel: 'file create',
    chipLabelPlural: 'file creates',
    chipIcon: LuFilePlus2,
    chipColor: 'accent.success',
    timelineVerb: 'Creating',
  },
  'SearchDBSchema': {
    displayComponent: SearchDBSchemaDisplay,
    tier: 3,
    chipLabel: 'search',
    chipLabelPlural: 'searches',
    chipIcon: LuSearch,
    chipColor: 'accent.cyan',
    timelineVerb: 'Searching',
  },
  'PublishAll': {
    displayComponent: PublishAllDisplay,
    tier: 3,
    chipLabel: 'publish',
    chipLabelPlural: 'publishes',
    chipIcon: LuUpload,
    chipColor: 'accent.success',
    timelineVerb: 'Publishing',
  },
  'LoadSkill': {
    displayComponent: LoadSkillDisplay,
    tier: 3,
    chipLabel: 'skill load',
    chipLabelPlural: 'skill loads',
    chipIcon: LuBookMarked,
    chipColor: 'accent.primary',
    timelineVerb: 'Loading',
  },
};

// Default configuration for unknown tools
export const DEFAULT_TOOL_CONFIG: ToolConfig = {
  displayComponent: DefaultToolDisplay,
  tier: 3,
  chipLabel: 'action',
  chipLabelPlural: 'actions',
  chipIcon: LuWrench,
  chipColor: 'fg.muted',
  timelineVerb: 'Working',
};

// Get tool configuration
export function getToolConfig(toolName: string): ToolConfig {
  return TOOL_CONFIGS[toolName] || DEFAULT_TOOL_CONFIG;
}

// Get the tier for a tool by name
export function getToolTier(toolName: string): ToolTier {
  return getToolConfig(toolName).tier;
}
