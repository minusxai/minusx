import { LuTable, LuFileText, LuClock, LuMessageSquare, LuCode, LuShare2, LuLayoutDashboard, LuNotebookText, LuChartBar } from 'react-icons/lu';
import { IconType } from 'react-icons';

/**
 * Sidebar section IDs
 */
export type SidebarSectionId =
  | 'questions'
  | 'question-references'
  | 'context'
  | 'chat'
  | 'databases'
  | 'documentation'
  | 'history'
  | 'share'
  | 'dev';

/**
 * Sidebar section metadata
 */
export interface SidebarSectionMetadata {
  id: SidebarSectionId;
  title: string;
  icon: IconType;
  color: string;
  maxHeight?: string;
}

/**
 * Centralized sidebar section metadata
 * Single source of truth for section titles, icons, and colors
 */
export const SIDEBAR_SECTION_METADATA: Record<SidebarSectionId, Omit<SidebarSectionMetadata, 'id'>> = {
  questions: {
    title: 'Add Questions',
    icon: LuLayoutDashboard,
    color: 'accent.teal',
  },
  'question-references': {
    title: 'Referenced Questions',
    icon: LuChartBar,
    color: 'accent.success',
    maxHeight: '400px',
  },
  context: {
    title: 'Context Selector',
    icon: LuNotebookText,
    color: 'accent.warning',
  },
  chat: {
    title: 'Chat',
    icon: LuMessageSquare,
    color: 'accent.primary',
  },
  databases: {
    title: 'Tables in Context',
    icon: LuTable,
    color: 'accent.danger',
    maxHeight: '400px',
  },
  documentation: {
    title: 'Documentation in Context',
    icon: LuFileText,
    color: 'accent.secondary',
    maxHeight: '300px',
  },
  history: {
    title: 'History',
    icon: LuClock,
    color: 'accent.warning',
  },
  share: {
    title: 'Share',
    icon: LuShare2,
    color: 'accent.success',
  },
  dev: {
    title: 'Dev Tools',
    icon: LuCode,
    color: 'accent.teal',
  },
} as const;

/**
 * Get section metadata by ID
 */
export function getSidebarSection(id: SidebarSectionId): SidebarSectionMetadata {
  return {
    id,
    ...SIDEBAR_SECTION_METADATA[id],
  };
}

/**
 * Get multiple sections by IDs (preserves order)
 */
export function getSidebarSections(ids: SidebarSectionId[]): SidebarSectionMetadata[] {
  return ids.map(id => getSidebarSection(id));
}
