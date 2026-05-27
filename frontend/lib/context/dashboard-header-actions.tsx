'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

/**
 * Split context pattern to avoid infinite re-renders:
 * - SetterContext: stable setter function (DashboardView writes here, never re-renders from reads)
 * - ValueContext: the actions ReactNode (FileHeader reads here)
 */
const SetterContext = createContext<(actions: ReactNode | null) => void>(() => {});
const ValueContext = createContext<ReactNode | null>(null);

export function DashboardHeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode | null>(null);

  return (
    <SetterContext.Provider value={setActions}>
      <ValueContext.Provider value={actions}>
        {children}
      </ValueContext.Provider>
    </SetterContext.Provider>
  );
}

/** Used by DashboardView to set header actions (write-only, no re-render on read). */
export function useSetDashboardHeaderActions() {
  return useContext(SetterContext);
}

/** Used by FileHeader to read the current header actions. */
export function useDashboardHeaderActions() {
  return useContext(ValueContext);
}
