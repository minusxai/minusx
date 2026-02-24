import { ToolNames } from '@/lib/types';
import ExecuteSQLDisplay from '@/components/explore/tools/ExecuteSQLDisplay';
import DefaultToolDisplay from '@/components/explore/tools/DefaultToolDisplay';
import ContentDisplay from '@/components/explore/tools/ContentDisplay';
import ClarifyDisplay from '@/components/explore/tools/ClarifyDisplay';
import NavigateDisplay from '@/components/explore/tools/NavigateDisplay';
import EditDashboardDisplay from '@/components/explore/tools/EditDashboardDisplay';
import EditReportDisplay from '@/components/explore/tools/EditReportDisplay';
import EditAlertDisplay from '@/components/explore/tools/EditAlertDisplay';
import SetRuntimeValuesDisplay from '@/components/explore/tools/SetRuntimeValuesDisplay';
import { DisplayProps } from '@/lib/types';

// Tool configuration interface
export interface ToolConfig {
  displayComponent: React.ComponentType<DisplayProps> | null;
}

// Centralized tool configurations
export const TOOL_CONFIGS: Record<string, ToolConfig> = {
  [ToolNames.EXECUTE_SQL_QUERY]: {
    displayComponent: ExecuteSQLDisplay,
  },
  [ToolNames.EXECUTE_QUERY]: {
    displayComponent: ExecuteSQLDisplay,
  },
  // Frontend variant (ExecuteSQLQueryForeground) - same display as ExecuteSQLQuery
  'ExecuteSQLQueryForeground': {
    displayComponent: null,
  },
  'Clarify': {
    displayComponent: ClarifyDisplay,
  },
  'ClarifyFrontend': {
    displayComponent: null,
  },
  [ToolNames.PRESENT_FINAL_ANSWER]: {
    displayComponent: ContentDisplay,
  },
  // Frontend variant (PresentFinalAnswerFrontend) - no display component
  'PresentFinalAnswerFrontend': {
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
  'SetRuntimeValues': {
    displayComponent: SetRuntimeValuesDisplay
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
