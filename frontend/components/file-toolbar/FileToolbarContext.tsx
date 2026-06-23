'use client';

/**
 * FileToolbarContext — a generic bridge so a file's view can publish toolbar
 * actions (Run all, Collapse all, …) into the document header (FileHeader),
 * which is a sibling component. The view owns the handlers (where the logic
 * lives); the header just renders them. No Redux command bus, no per-type
 * coupling — any file view can register actions.
 *
 * Present (reading) mode is handled separately as a generic per-file flag
 * (uiSlice.filePresent) that FileHeader toggles for presentable types.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface FileToolbarAction {
  id: string;
  ariaLabel: string;
  label?: string;
  icon?: ReactNode;
  onClick: () => void;
  active?: boolean;
}

interface FileToolbarContextValue {
  actions: FileToolbarAction[];
  setActions: (actions: FileToolbarAction[]) => void;
}

const FileToolbarContext = createContext<FileToolbarContextValue>({
  actions: [],
  setActions: () => {},
});

export function FileToolbarProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<FileToolbarAction[]>([]);
  const value = useMemo(() => ({ actions, setActions }), [actions]);
  return <FileToolbarContext.Provider value={value}>{children}</FileToolbarContext.Provider>;
}

/** FileHeader reads the actions registered by the current file's view. */
export function useFileToolbar(): FileToolbarAction[] {
  return useContext(FileToolbarContext).actions;
}

/**
 * A file view calls this to publish its toolbar actions to the header.
 * `actions` MUST be memoized by the caller (stable identity) so it only
 * re-registers when the actions actually change.
 */
export function useFileToolbarActions(actions: FileToolbarAction[]): void {
  const { setActions } = useContext(FileToolbarContext);
  useEffect(() => {
    setActions(actions);
    return () => setActions([]);
  }, [actions, setActions]);
}
