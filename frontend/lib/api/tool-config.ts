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
  LuUpload, LuBookMarked, LuWrench, LuBrain, LuGlobe,
} from 'react-icons/lu';

// Tool configuration interface
export interface ToolConfig {
  displayComponent: React.ComponentType<DisplayProps> | null;
  chipLabel: string;        // Singular noun: "thought", "file edit", "search"
  chipLabelPlural: string;  // Plural noun: "thoughts", "file edits", "searches"
  chipIcon: IconType;       // Icon shown in chip/rail badge
  timelineVerb: string;     // Present participle for timeline: "Creating", "Editing", etc.
}

// Centralized tool configurations
export const TOOL_CONFIGS: Record<string, ToolConfig> = {
  [ToolNames.EXECUTE_QUERY]: {
    displayComponent: ExecuteSQLDisplay,

    chipLabel: 'query',
    chipLabelPlural: 'queries',
    chipIcon: LuDatabase,

    timelineVerb: 'Querying',
  },
  'Clarify': {
    displayComponent: ClarifyDisplay,

    chipLabel: 'clarification',
    chipLabelPlural: 'clarifications',
    chipIcon: LuBadgeInfo,

    timelineVerb: 'Clarifying',
  },
  'ClarifyFrontend': {
    displayComponent: null,

    chipLabel: 'clarification',
    chipLabelPlural: 'clarifications',
    chipIcon: LuBadgeInfo,

    timelineVerb: 'Clarifying',
  },
  [ToolNames.TALK_TO_USER]: {
    displayComponent: ContentDisplay,

    chipLabel: 'thought',
    chipLabelPlural: 'thoughts',
    chipIcon: LuBrain,

    timelineVerb: 'Thinking',
  },
  [ToolNames.ANALYST_AGENT]: {
    displayComponent: ContentDisplay,

    chipLabel: 'thought',
    chipLabelPlural: 'thoughts',
    chipIcon: LuBrain,

    timelineVerb: 'Thinking',
  },
  [ToolNames.ATLAS_ANALYST_AGENT]: {
    displayComponent: ContentDisplay,

    chipLabel: 'thought',
    chipLabelPlural: 'thoughts',
    chipIcon: LuBrain,

    timelineVerb: 'Thinking',
  },
  [ToolNames.TEST_AGENT]: {
    displayComponent: ContentDisplay,

    chipLabel: 'test',
    chipLabelPlural: 'tests',
    chipIcon: LuBrain,

    timelineVerb: 'Thinking',
  },
  [ToolNames.ONBOARDING_CONTEXT_AGENT]: {
    displayComponent: ContentDisplay,

    chipLabel: 'onboarding step',
    chipLabelPlural: 'onboarding steps',
    chipIcon: LuMessageSquare,

    timelineVerb: 'Thinking',
  },
  [ToolNames.ONBOARDING_DASHBOARD_AGENT]: {
    displayComponent: ContentDisplay,

    chipLabel: 'onboarding step',
    chipLabelPlural: 'onboarding steps',
    chipIcon: LuMessageSquare,

    timelineVerb: 'Thinking',
  },
  [ToolNames.SLACK_AGENT]: {
    displayComponent: ContentDisplay,

    chipLabel: 'message',
    chipLabelPlural: 'messages',
    chipIcon: LuMessageSquare,

    timelineVerb: 'Messaging',
  },
  'Navigate': {
    displayComponent: NavigateDisplay,

    chipLabel: 'navigation',
    chipLabelPlural: 'navigations',
    chipIcon: LuArrowRight,

    timelineVerb: 'Navigating',
  },
  'EditFile': {
    displayComponent: EditFileDisplay,

    chipLabel: 'file edit',
    chipLabelPlural: 'file edits',
    chipIcon: LuPencilLine,

    timelineVerb: 'Editing',
  },
  'ReadFiles': {
    displayComponent: ReadFilesDisplay,

    chipLabel: 'file read',
    chipLabelPlural: 'file reads',
    chipIcon: LuBookOpen,

    timelineVerb: 'Reading',
  },
  'SearchFiles': {
    displayComponent: SearchFilesDisplay,

    chipLabel: 'search',
    chipLabelPlural: 'searches',
    chipIcon: LuSearch,

    timelineVerb: 'Searching',
  },
  'CreateFile': {
    displayComponent: CreateFileDisplay,

    chipLabel: 'file create',
    chipLabelPlural: 'file creates',
    chipIcon: LuFilePlus2,

    timelineVerb: 'Creating',
  },
  'SearchDBSchema': {
    displayComponent: SearchDBSchemaDisplay,

    chipLabel: 'search',
    chipLabelPlural: 'searches',
    chipIcon: LuSearch,

    timelineVerb: 'Searching',
  },
  'PublishAll': {
    displayComponent: PublishAllDisplay,

    chipLabel: 'publish',
    chipLabelPlural: 'publishes',
    chipIcon: LuUpload,

    timelineVerb: 'Publishing',
  },
  'LoadSkill': {
    displayComponent: LoadSkillDisplay,

    chipLabel: 'skill load',
    chipLabelPlural: 'skill loads',
    chipIcon: LuBookMarked,

    timelineVerb: 'Loading',
  },
  'WebSearch': {
    displayComponent: null,

    chipLabel: 'web lookup',
    chipLabelPlural: 'web lookups',
    chipIcon: LuGlobe,

    timelineVerb: 'Browsing',
  },
};

// Default configuration for unknown tools
export const DEFAULT_TOOL_CONFIG: ToolConfig = {
  displayComponent: DefaultToolDisplay,
  chipLabel: 'action',
  chipLabelPlural: 'actions',
  chipIcon: LuWrench,
  timelineVerb: 'Working',
};

// Get tool configuration
export function getToolConfig(toolName: string): ToolConfig {
  return TOOL_CONFIGS[toolName] || DEFAULT_TOOL_CONFIG;
}

