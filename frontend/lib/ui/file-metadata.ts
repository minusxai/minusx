import { LuFileText, LuNotebook, LuScanSearch, LuPresentation, LuLayoutDashboard, LuDatabase, LuFileCode, LuUsers, LuFolder, LuRocket, LuPlay, LuNotebookText, LuTable, LuBell } from 'react-icons/lu';
import { IconType } from 'react-icons';

/**
 * File type categories
 */
export type FileCategory = 'analytics' | 'engineering' | 'management' | 'folder' | 'misc';

/**
 * File type metadata structure
 */
export interface FileTypeMetadata {
  label: string;
  icon: IconType;
  color: string;  // Theme semantic token
  category: FileCategory;
  supported: boolean;  // Whether this type is currently supported
  h: string;          // Optional: default height for file type views
}

/**
 * Centralized file type metadata
 * All information about each file type in one place
 * THIS IS THE SINGLE SOURCE OF TRUTH FOR ALL FILE TYPES
 */
export const FILE_TYPE_METADATA = {
  question: {
    label: 'Question',
    icon: LuScanSearch,
    color: 'accent.primary',      // Belize Hole blue (#2980b9)
    category: 'analytics',
    supported: true,
    h: '100vh',
  },
  dashboard: {
    label: 'Dashboard',
    icon: LuLayoutDashboard,
    color: 'accent.danger',       // Pomegranate red (#c0392b)
    category: 'analytics',
    supported: true,
    h: 'none',
  },
  notebook: {
    label: 'Notebook',
    icon: LuNotebook,
    color: 'accent.warning',      // Orange (#f39c12)
    category: 'analytics',
    supported: false,
    h: 'none',
  },
  presentation: {
    label: 'Presentation',
    icon: LuPresentation,
    color: 'accent.secondary',    // Amethyst purple (#9b59b6)
    category: 'analytics',
    supported: false,
    h: 'none',
  },
  connection: {
    label: 'Databases',
    icon: LuDatabase,
    color: 'accent.muted',        // Muted gray
    category: 'engineering',
    supported: true,
    h: 'none',
  },
//   connector: {
//     label: 'Data Connector',
//     icon: LuPlug,
//     color: 'accent.cyan',         // Turquoise cyan (#1abc9c)
//     category: 'engineering',
//     supported: true,
//     hidden: false
//   },
  context: {
    label: 'Knowledge Base',
    icon: LuNotebookText,
    color: 'accent.warning',         // Turquoise cyan (#1abc9c)
    category: 'analytics',
    supported: true,
    h: 'none',
  },
  report: {
    label: 'Report',
    icon: LuFileText,
    color: 'accent.secondary',      // Emerald green (#2ecc71)
    category: 'analytics',
    supported: true,
    h: 'none',
  },
  config: {
    label: 'Configs',
    icon: LuFileCode,
    color: 'accent.muted',        // Muted gray
    category: 'engineering',
    supported: true,
    h: '100vh',
  },
  styles: {
    label: 'Styles',
    icon: LuFileCode,
    color: 'accent.muted',        // Muted gray
    category: 'engineering',
    supported: true,
    h: '100vh',
  },
  alert: {
    label: 'Alert',
    icon: LuBell,
    color: 'accent.secondary',      // Orange (#f39c12)
    category: 'analytics',
    supported: true,
    h: 'none',
  },
  alert_run: {
    label: 'Alert Run',
    icon: LuBell,
    color: 'accent.secondary',
    category: 'engineering',
    supported: true,
    h: 'none',
  },
  report_run: {
    label: 'Report Run',
    icon: LuFileText,
    color: 'accent.success',      // Same as report
    category: 'engineering',
    supported: true,
    h: 'none',
  },
  conversation: {
    label: 'Logs',
    icon: LuFileText,
    color: 'accent.muted',        // Muted gray
    category: 'engineering',
    supported: true,
    h: 'none',
  },
  session: {
    label: 'Recordings',
    icon: LuPlay,
    color: 'accent.secondary',    // Amethyst purple (#9b59b6)
    category: 'engineering',
    supported: true,
    h: 'none',
  },
  llm_call: {
    label: 'LLM Call',
    icon: LuFileCode,
    color: 'accent.muted',
    category: 'engineering',
    supported: true,
    h: 'none',
  },
  users: {
    label: 'Users',
    icon: LuUsers,
    color: 'accent.teal',         // Green Sea teal (#16a085)
    category: 'management',
    supported: true,
    h: 'none',
  },
  folder: {
    label: 'Folder',
    icon: LuFolder,
    color: 'fg.muted',            // Muted gray for folders
    category: 'folder',
    supported: true,
    h: 'none',
  },
  explore: {
    label: 'Explore',
    icon: LuRocket,
    color: 'accent.teal',    // Amethyst purple (#9b59b6)
    category: 'misc',
    supported: true,
    h: 'none',
  }
} as const satisfies Record<string, FileTypeMetadata>;

/**
 * All file types (derived from metadata keys)
 */
export type FileType = keyof typeof FILE_TYPE_METADATA;

/**
 * Supported file types (derived from metadata)
 */
export const SUPPORTED_FILE_TYPES = Object.entries(FILE_TYPE_METADATA)
  .filter(([_, meta]) => meta.supported)
  .map(([type]) => type as FileType);

export type SupportedFileType = typeof SUPPORTED_FILE_TYPES[number];

/**
 * Analytics file types (derived from metadata where category === 'analytics')
 * Used for QuestionContainer type in types.ts
 */
export const ANALYTICS_FILE_TYPES = Object.entries(FILE_TYPE_METADATA)
  .filter(([_, meta]) => meta.category === 'analytics')
  .map(([type]) => type as FileType);

export type AnalyticsFileType = typeof ANALYTICS_FILE_TYPES[number];

export const ANALYTICS_DOC_TYPES = Object.entries(FILE_TYPE_METADATA)
  .filter(([_, meta]) => meta.category === 'analytics' && meta.label !== 'Question')
  .map(([type]) => type as FileType);

export type AnalyticsDocumentType = typeof ANALYTICS_DOC_TYPES[number];

/**
 * Engineering file types (derived from metadata where category === 'engineering')
 */
export const ENGINEERING_FILE_TYPES = Object.entries(FILE_TYPE_METADATA)
  .filter(([_, meta]) => meta.category === 'engineering')
  .map(([type]) => type as FileType);

export type EngineeringFileType = typeof ENGINEERING_FILE_TYPES[number];


/**
 * Engineering file types (derived from metadata where category === 'engineering')
 */
export const MANAGEMENT_FILE_TYPES = Object.entries(FILE_TYPE_METADATA)
  .filter(([_, meta]) => meta.category === 'management')
  .map(([type]) => type as FileType);

export type ManagementFileType = typeof MANAGEMENT_FILE_TYPES[number];


/**
 * System file types that require in-place save and cannot participate in bulk Publish.
 * These files save immediately when the user clicks Save, and the in-app nav guard
 * shows a Save/Discard/Cancel modal when navigating away with unsaved changes.
 */
export const SYSTEM_FILE_TYPES: FileType[] = ['connection', 'config', 'styles', 'context'];

/**
 * Returns true if the given file type is a system file (connection, config, styles, context).
 * System files save in-place and are excluded from the bulk Publish workflow.
 */
export const isSystemFileType = (type: FileType): boolean => SYSTEM_FILE_TYPES.includes(type);

/**
 * Category labels for display
 */
export const CATEGORY_LABELS: Record<FileCategory, string> = {
  'analytics': 'Analytics',
  'engineering': 'Engineering',
  'management': 'Management',
  'folder': 'Folder',
  'misc': 'Miscellaneous'
} as const;

/**
 * Get metadata for a file type
 */
export function getFileTypeMetadata(type: FileType) {
  return FILE_TYPE_METADATA[type];
}

/**
 * Hex values for accent colors (matching theme.ts)
 * Used for non-Chakra contexts like Lexical editor mentions
 */
export const ACCENT_HEX = {
  primary: '#2980b9',      // Belize Hole blue
  secondary: '#9b59b6',    // Amethyst purple
  success: '#2ecc71',      // Emerald green
  warning: '#f39c12',      // Orange
  danger: '#c0392b',       // Pomegranate red
  teal: '#16a085',         // Green Sea teal
  info: '#3498db',         // Info blue
  cyan: '#1abc9c',         // Turquoise cyan
  muted: '#7f8c8d',        // Muted gray
} as const;

/**
 * Table mention metadata (not a file type, used for schema table mentions)
 */
export const TABLE_MENTION_METADATA = {
  label: 'TABLE',
  icon: LuTable,
  color: ACCENT_HEX.muted,
};

/**
 * Generate CSS color values for mention styling from a hex color
 * Uses color-mix for transparency effects
 */
export function getMentionColors(hex: string) {
  return {
    bg: `color-mix(in srgb, ${hex} 20%, transparent)`,
    color: hex,
    border: `color-mix(in srgb, ${hex} 30%, transparent)`,
    labelBg: hex,
  };
}
