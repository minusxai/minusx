import { ToolNames } from '@/lib/types';
import ExecuteSQLDisplay from '@/components/explore/tools/ExecuteSQLDisplay';
import DefaultToolDisplay from '@/components/explore/tools/DefaultToolDisplay';
import ContentDisplay from '@/components/explore/tools/ContentDisplay';
import ClarifyDisplay from '@/components/explore/tools/ClarifyDisplay';
import NavigateDisplay from '@/components/explore/tools/NavigateDisplay';
import EditDashboardDisplay from '@/components/explore/tools/EditDashboardDisplay';
import EditReportDisplay from '@/components/explore/tools/EditReportDisplay';
import EditAlertDisplay from '@/components/explore/tools/EditAlertDisplay';
import EditFileDisplay from '@/components/explore/tools/EditFileDisplay';
import ReadFilesDisplay from '@/components/explore/tools/ReadFilesDisplay';
import SearchFilesDisplay from '@/components/explore/tools/SearchFilesDisplay';
import CreateFileDisplay from '@/components/explore/tools/CreateFileDisplay';
import SearchDBSchemaDisplay from '@/components/explore/tools/SearchDBSchemaDisplay';
import PublishAllDisplay from '@/components/explore/tools/PublishAllDisplay';
import { DisplayProps } from '@/lib/types';

// Tool configuration interface
export interface ToolConfig {
  displayComponent: React.ComponentType<DisplayProps> | null;
}

// Centralized tool configurations
export const TOOL_CONFIGS: Record<string, ToolConfig> = {
  [ToolNames.EXECUTE_QUERY]: {
    displayComponent: ExecuteSQLDisplay,
  },
  'Clarify': {
    displayComponent: ClarifyDisplay,
  },
  'ClarifyFrontend': {
    displayComponent: null,
  },
  [ToolNames.TALK_TO_USER]: {
    displayComponent: ContentDisplay,
  },
  [ToolNames.ANALYST_AGENT]: {
    displayComponent: ContentDisplay,
  },
  [ToolNames.ATLAS_ANALYST_AGENT]: {
    displayComponent: ContentDisplay,
  },
  [ToolNames.SLACK_AGENT]: {
    displayComponent: ContentDisplay,
  },
  [ToolNames.TEST_AGENT]: {
    displayComponent: ContentDisplay,
  },
  [ToolNames.ONBOARDING_CONTEXT_AGENT]: {
    displayComponent: ContentDisplay,
  },
  [ToolNames.ONBOARDING_DASHBOARD_AGENT]: {
    displayComponent: ContentDisplay,
  },
  'Navigate': {
    displayComponent: NavigateDisplay
  },
  'EditDashboard': {
    displayComponent: EditDashboardDisplay
  },
  'EditReport': {
    displayComponent: EditReportDisplay
  },
  'EditAlert': {
    displayComponent: EditAlertDisplay
  },
  'EditFile': {
    displayComponent: EditFileDisplay
  },
  'ReadFiles': {
    displayComponent: ReadFilesDisplay
  },
  'SearchFiles': {
    displayComponent: SearchFilesDisplay
  },
  'CreateFile': {
    displayComponent: CreateFileDisplay
  },
  'SearchDBSchema': {
    displayComponent: SearchDBSchemaDisplay
  },
  'PublishAll': {
    displayComponent: PublishAllDisplay
  }
};

// Default configuration for unknown tools
export const DEFAULT_TOOL_CONFIG: ToolConfig = {
  displayComponent: DefaultToolDisplay,
};

// Get tool configuration
export function getToolConfig(toolName: string): ToolConfig {
  return TOOL_CONFIGS[toolName] || DEFAULT_TOOL_CONFIG;
}
