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
  LuUpload, LuBookMarked, LuWrench,
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
  chipLabel: string;        // e.g. "created", "edited", "searched"
  chipIcon: IconType;       // Icon shown in chip/rail badge
  timelineVerb: string;     // Present participle for timeline: "Creating", "Editing", etc.
}

// Centralized tool configurations
export const TOOL_CONFIGS: Record<string, ToolConfig> = {
  [ToolNames.EXECUTE_QUERY]: {
    displayComponent: ExecuteSQLDisplay,
    tier: 1,
    chipLabel: 'queried',
    chipIcon: LuDatabase,
    timelineVerb: 'Querying',
  },
  'Clarify': {
    displayComponent: ClarifyDisplay,
    tier: 1,
    chipLabel: 'clarified',
    chipIcon: LuBadgeInfo,
    timelineVerb: 'Clarifying',
  },
  'ClarifyFrontend': {
    displayComponent: null,
    tier: 1,
    chipLabel: 'clarified',
    chipIcon: LuBadgeInfo,
    timelineVerb: 'Clarifying',
  },
  [ToolNames.TALK_TO_USER]: {
    displayComponent: ContentDisplay,
    tier: 1,
    chipLabel: 'replied',
    chipIcon: LuMessageSquare,
    timelineVerb: 'Thinking',
  },
  [ToolNames.ANALYST_AGENT]: {
    displayComponent: ContentDisplay,
    tier: 1,
    chipLabel: 'analyzed',
    chipIcon: LuMessageSquare,
    timelineVerb: 'Thinking',
  },
  [ToolNames.ATLAS_ANALYST_AGENT]: {
    displayComponent: ContentDisplay,
    tier: 1,
    chipLabel: 'analyzed',
    chipIcon: LuMessageSquare,
    timelineVerb: 'Thinking',
  },
  [ToolNames.TEST_AGENT]: {
    displayComponent: ContentDisplay,
    tier: 1,
    chipLabel: 'tested',
    chipIcon: LuMessageSquare,
    timelineVerb: 'Thinking',
  },
  [ToolNames.ONBOARDING_CONTEXT_AGENT]: {
    displayComponent: ContentDisplay,
    tier: 1,
    chipLabel: 'onboarded',
    chipIcon: LuMessageSquare,
    timelineVerb: 'Thinking',
  },
  [ToolNames.ONBOARDING_DASHBOARD_AGENT]: {
    displayComponent: ContentDisplay,
    tier: 1,
    chipLabel: 'onboarded',
    chipIcon: LuMessageSquare,
    timelineVerb: 'Thinking',
  },
  [ToolNames.SLACK_AGENT]: {
    displayComponent: ContentDisplay,
    tier: 1,
    chipLabel: 'messaged',
    chipIcon: LuMessageSquare,
    timelineVerb: 'Messaging',
  },
  'Navigate': {
    displayComponent: NavigateDisplay,
    tier: 3,
    chipLabel: 'navigated',
    chipIcon: LuArrowRight,
    timelineVerb: 'Navigating',
  },
  'EditFile': {
    displayComponent: EditFileDisplay,
    tier: 2,
    chipLabel: 'edited',
    chipIcon: LuPencilLine,
    timelineVerb: 'Editing',
  },
  'ReadFiles': {
    displayComponent: ReadFilesDisplay,
    tier: 3,
    chipLabel: 'read',
    chipIcon: LuBookOpen,
    timelineVerb: 'Reading',
  },
  'SearchFiles': {
    displayComponent: SearchFilesDisplay,
    tier: 3,
    chipLabel: 'searched',
    chipIcon: LuSearch,
    timelineVerb: 'Searching',
  },
  'CreateFile': {
    displayComponent: CreateFileDisplay,
    tier: 3,
    chipLabel: 'created',
    chipIcon: LuFilePlus2,
    timelineVerb: 'Creating',
  },
  'SearchDBSchema': {
    displayComponent: SearchDBSchemaDisplay,
    tier: 3,
    chipLabel: 'searched',
    chipIcon: LuSearch,
    timelineVerb: 'Searching',
  },
  'PublishAll': {
    displayComponent: PublishAllDisplay,
    tier: 3,
    chipLabel: 'published',
    chipIcon: LuUpload,
    timelineVerb: 'Publishing',
  },
  'LoadSkill': {
    displayComponent: LoadSkillDisplay,
    tier: 3,
    chipLabel: 'loaded skill',
    chipIcon: LuBookMarked,
    timelineVerb: 'Loading',
  },
};

// Default configuration for unknown tools
export const DEFAULT_TOOL_CONFIG: ToolConfig = {
  displayComponent: DefaultToolDisplay,
  tier: 3,
  chipLabel: 'action',
  chipIcon: LuWrench,
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
