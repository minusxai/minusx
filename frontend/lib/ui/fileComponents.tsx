/**
 * Type → Component Mapping
 * Phase 2: Core Patterns Implementation
 *
 * Centralized mapping of file types to their corresponding container components.
 * Replaces the 70-line if-else chain in FileLayout.
 */
import { ComponentType } from 'react';
import { FileType } from './file-metadata';
import { type FileId } from '@/store/filesSlice';
import QuestionContainerV2 from '@/components/containers/QuestionContainerV2';
import DashboardContainerV2 from '@/components/containers/DashboardContainerV2';
import PresentationContainerV2 from '@/components/containers/PresentationContainerV2';
import ContextContainerV2 from '@/components/containers/ContextContainerV2';
import ConnectionContainerV2 from '@/components/containers/ConnectionContainerV2';
import ConversationContainerV2 from '@/components/containers/ConversationContainerV2';
import SessionContainerV2 from '@/components/containers/SessionContainerV2';
import ConfigContainerV2 from '@/components/containers/ConfigContainerV2';
import StylesContainerV2 from '@/components/containers/StylesContainerV2';
import ReportContainerV2 from '@/components/containers/ReportContainerV2';
import AlertContainerV2 from '@/components/containers/AlertContainerV2';

/**
 * Props interface for all file component containers
 * Supports both real files (positive IDs) and virtual files (negative IDs for create mode)
 */
export type FileViewMode = 'view' | 'create' | 'preview';

export interface FileComponentProps {
  fileId: FileId;
  mode?: FileViewMode;
  defaultFolder?: string;
}

/**
 * Type → Component mapping object
 * Maps file types to their container components
 *
 * Phase 1: Only question, dashboard, presentation
 * Phase 2: Add connection, context, users, connector, etc.
 */
export const FILE_COMPONENTS: Partial<Record<FileType, ComponentType<FileComponentProps>>> = {
  question: QuestionContainerV2,
  dashboard: DashboardContainerV2,
  presentation: PresentationContainerV2,
  context: ContextContainerV2,
  connection: ConnectionContainerV2,
  conversation: ConversationContainerV2,
  session: SessionContainerV2,
  config: ConfigContainerV2,
  styles: StylesContainerV2,
  report: ReportContainerV2,
  alert: AlertContainerV2,
  // Phase 2B: Add remaining file types
  // users: UserEditor,
};

/**
 * Get component for a file type
 * Returns null if no component is registered for the type
 *
 * @param type - File type (e.g., 'question', 'dashboard')
 * @returns Component constructor or null
 *
 * Example:
 * ```tsx
 * const Component = getFileComponent('question');
 * if (Component) {
 *   return <Component fileId={123} mode="view" />;
 * }
 * ```
 */
export function getFileComponent(type: FileType): ComponentType<FileComponentProps> | null {
  return FILE_COMPONENTS[type] || null;
}

/**
 * Check if a file type has a registered component
 *
 * @param type - File type
 * @returns true if component is registered
 */
export function hasFileComponent(type: FileType): boolean {
  return type in FILE_COMPONENTS;
}
