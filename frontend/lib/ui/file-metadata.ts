import { LuScrollText, LuFileText, LuNotebook, LuScanSearch, LuLayoutDashboard, LuDatabase, LuFileCode, LuUsers, LuFolder, LuRocket, LuPlay, LuNotebookText, LuTable, LuColumns3, LuSquareFunction, LuBell } from 'react-icons/lu';
import { IconType } from 'react-icons';

/**
 * File type categories
 */
type FileCategory = 'analytics' | 'engineering' | 'management' | 'folder' | 'misc';

/**
 * File type metadata structure
 */
export interface FileTypeMetadata {
  label: string;
  icon: IconType;
  color: string;  // Theme semantic token
  category: FileCategory;
  supported: boolean;  // Whether this type is currently supported
  h: string;          // Default height for file type views ('none' = full content-height page flow)
  systemCreatedOnly?: boolean;  // If true, hidden from create menu (created by system, not users)
  /**
   * Agent app-state images: bake the numbered position-marker gutter into this type's screenshot
   * and send the `<Viewport>` scroll pointer (lib/screenshot/page-markers.ts). Only meaningful for
   * full-content-height page flow — every flagged type MUST also be `h: 'none'` (test-enforced);
   * markers on an internally-scrolled view (question) would number only the visible slice.
   */
  markers?: boolean;
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
    markers: true,
  },
  story: {
    label: 'Story',
    icon: LuScrollText,
    color: 'accent.sun',         // Pumpkin orange (#d35400)
    category: 'analytics',
    supported: true,
    h: 'none',
    markers: true,
  },
  notebook: {
    label: 'Notebook',
    icon: LuNotebook,
    color: 'accent.warning',      // Orange (#f39c12)
    category: 'analytics',
    supported: false,
    h: 'none',
    markers: true,
  },
  connection: {
    label: 'Databases',
    icon: LuDatabase,
    color: 'accent.muted',        // Muted gray
    category: 'engineering',
    supported: true,
    h: 'none',
  },
  context: {
    label: 'Knowledge Base',
    icon: LuNotebookText,
    color: 'accent.warning',         // Orange (#f39c12)
    category: 'analytics',
    supported: true,
    h: 'none',
    systemCreatedOnly: true,
  },
  report: {
    label: 'Digest',
    icon: LuFileText,
    color: 'accent.secondary',      // Amethyst purple (#9b59b6)
    category: 'analytics',
    supported: false,
    h: 'none',
    markers: true,
  },
  config: {
    label: 'Configs',
    icon: LuFileCode,
    color: 'accent.muted',        // Muted gray
    category: 'engineering',
    supported: true,
    h: '100vh',
    systemCreatedOnly: true,
  },
  styles: {
    label: 'Styles',
    icon: LuFileCode,
    color: 'accent.muted',        // Muted gray
    category: 'engineering',
    supported: true,
    h: '100vh',
    systemCreatedOnly: true,
  },
  alert: {
    label: 'Alert',
    icon: LuBell,
    color: 'accent.secondary',      // Amethyst purple (#9b59b6)
    category: 'analytics',
    supported: true,
    h: 'none',
    markers: true,
  },
  // context_run: NO markers flag — nothing renders context_run today (zero component
  // references; it is not even in FileView's READ_ONLY_FILE_TYPES). Flag it when it gets
  // a rendered view (Renderer_v2 §2b).
  context_run: {
    label: 'Eval Run',
    icon: LuNotebookText,
    color: 'accent.warning',
    category: 'engineering',
    supported: true,
    h: 'none',
    systemCreatedOnly: true,
  },
  alert_run: {
    label: 'Alert Run',
    icon: LuBell,
    color: 'accent.secondary',
    category: 'engineering',
    supported: true,
    h: 'none',
    markers: true,
    systemCreatedOnly: true,
  },
  report_run: {
    label: 'Report Run',
    icon: LuFileText,
    color: 'accent.success',
    category: 'engineering',
    supported: true,
    h: 'none',
    markers: true,
    systemCreatedOnly: true,
  },
  session: {
    label: 'Recordings',
    icon: LuPlay,
    color: 'accent.secondary',    // Amethyst purple (#9b59b6)
    category: 'engineering',
    supported: true,
    h: 'none',
    systemCreatedOnly: true,
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
    color: 'accent.teal',    // Green Sea teal (#16a085)
    category: 'misc',
    supported: true,
    h: 'none',
  },

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


/**
 * Resolve the effective set of supported file types, applying an optional
 * per-org config override (`OrgConfig.supportedFileTypes`).
 *
 * Override semantics mirror `accessRules`: when present and non-empty the
 * override **fully replaces** the built-in defaults. An empty/undefined
 * override falls back to the defaults (guards against accidentally disabling
 * file creation entirely).
 */
export function getSupportedFileTypes(override?: FileType[]): FileType[] {
  return override && override.length > 0 ? override : SUPPORTED_FILE_TYPES;
}

/**
 * Whether a file type is supported, honoring the optional config override.
 */
export function isFileTypeSupported(type: FileType, override?: FileType[]): boolean {
  return getSupportedFileTypes(override).includes(type);
}

/**
 * Analytics file types (derived from metadata where category === 'analytics')
 */
const ANALYTICS_FILE_TYPES = Object.entries(FILE_TYPE_METADATA)
  .filter(([_, meta]) => meta.category === 'analytics')
  .map(([type]) => type as FileType);

export type AnalyticsFileType = typeof ANALYTICS_FILE_TYPES[number];

/**
 * System file types that require in-place save and cannot participate in bulk Publish.
 * These files save immediately when the user clicks Save, and the in-app nav guard
 * shows a Save/Discard/Cancel modal when navigating away with unsaved changes.
 */
const SYSTEM_FILE_TYPES: FileType[] = ['connection', 'config', 'styles', 'context'];

/**
 * Returns true if the given file type is a system file (connection, config, styles, context).
 * System files save in-place and are excluded from the bulk Publish workflow.
 */
export const isSystemFileType = (type: FileType): boolean => SYSTEM_FILE_TYPES.includes(type);

/**
 * Get metadata for a file type
 */
export function getFileTypeMetadata(type: FileType) {
  return FILE_TYPE_METADATA[type];
}

/**
 * The label to render for a file — its name, or a readable placeholder when the name is
 * empty. A nameless file must never render as a blank string: in grids/lists it collapses
 * to a bare icon with nothing under it.
 *
 * The fallback is `Untitled <Type Label> #<id>`. The id is what makes two untitled files
 * of the same type tellable apart, and it is the file's real identity (`/f/{id}`), so the
 * placeholder matches the URL the row opens. Callers with no id (e.g. DocumentHeader,
 * which renders a single file) get the plain `Untitled <Type Label>`.
 */
export function getFileDisplayName(file: {
  name?: string | null;
  type: FileType;
  id?: number | null;
}): string {
  const name = (file.name ?? '').trim();
  if (name) return name;
  const label = FILE_TYPE_METADATA[file.type]?.label ?? 'File';
  return file.id == null ? `Untitled ${label}` : `Untitled ${label} #${file.id}`;
}

/**
 * Whether a file is nameless — i.e. what `getFileDisplayName` returns is a placeholder,
 * not a real title. UI uses this to render the placeholder in a muted tone.
 */
export function isFileUntitled(file: { name?: string | null }): boolean {
  return !(file.name ?? '').trim();
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
  sun: '#d35400',          // Pumpkin orange
  muted: '#7f8c8d',        // Muted gray
} as const;

/** Resolve Chakra semantic accent tokens in non-Chakra renderers such as Lexical. */
export const ACCENT_TOKEN_HEX: Readonly<Record<string, string>> = {
  'accent.primary': ACCENT_HEX.primary,
  'accent.danger': ACCENT_HEX.danger,
  'accent.secondary': ACCENT_HEX.secondary,
  'accent.success': ACCENT_HEX.success,
  'accent.warning': ACCENT_HEX.warning,
  'accent.teal': ACCENT_HEX.teal,
  'accent.info': ACCENT_HEX.info,
  'accent.cyan': ACCENT_HEX.cyan,
  'accent.sun': ACCENT_HEX.sun,
  'accent.muted': ACCENT_HEX.muted,
};

/**
 * Table mention metadata (not a file type, used for schema table mentions)
 */
export const TABLE_MENTION_METADATA = {
  label: 'TABLE',
  icon: LuTable,
  color: ACCENT_HEX.cyan,
};

/**
 * Column mention metadata (a column within a table).
 */
export const COLUMN_MENTION_METADATA = {
  label: 'COLUMN',
  icon: LuColumns3,
  color: ACCENT_HEX.secondary,
};

/**
 * Metric mention metadata (a named metric defined in a context).
 */
export const METRIC_MENTION_METADATA = {
  label: 'METRIC',
  icon: LuSquareFunction,
  color: ACCENT_HEX.teal,
};

/**
 * Generate CSS color values for mention styling from a hex color
 * Uses color-mix for transparency effects
 */
export function getMentionColors(hex: string) {
  return {
    bg: `color-mix(in srgb, ${hex} 15%, transparent)`,
    color: hex,
    border: `color-mix(in srgb, ${hex} 25%, transparent)`,
    labelBg: hex,
  };
}
