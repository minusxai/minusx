'use client';

/**
 * NavigationGuardProvider - Intercepts in-app navigation when there are unsaved changes
 *
 * This provider:
 * - Listens for click events on internal links
 * - Checks if the CURRENT page's file has unsaved changes
 * - Shows a confirmation modal before allowing navigation
 * - Preserves URL parameters (as_user, mode) when navigating
 */

import { createContext, useContext, useState, useEffect, useCallback, ReactNode, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useRouter } from './use-navigation';
import { useAppSelector } from '@/store/hooks';
import { selectActiveConversation } from '@/store/chatSlice';
import { Dialog, Portal, Button, Text, HStack } from '@chakra-ui/react';
import { preserveParams } from './url-utils';
import { clearFileChanges, selectDirtyFiles } from '@/lib/api/file-state';
import { getStore } from '@/store/store';
import PublishModal from '@/components/PublishModal';

/**
 * Extract file ID from pathname
 * Returns the file ID if on a /f/[id] route, null otherwise
 */
function getFileIdFromPathname(pathname: string): number | null {
  // Match /f/123 pattern (file detail page)
  const fileMatch = pathname.match(/^\/f\/(\d+)/);
  if (fileMatch) {
    return parseInt(fileMatch[1], 10);
  }

  return null;
}

/**
 * Check if pathname is a new file creation page
 */
function isNewFilePage(pathname: string): boolean {
  return pathname.startsWith('/new/');
}

/**
 * Check if a specific file is dirty
 */
function isFileDirty(file: any): boolean {
  if (!file) return false;
  const hasContentChanges = file.persistableChanges && Object.keys(file.persistableChanges).length > 0;
  const hasMetadataChanges = file.metadataChanges && (file.metadataChanges.name !== undefined || file.metadataChanges.path !== undefined);
  return hasContentChanges || hasMetadataChanges;
}

interface NavigationGuardContextType {
  navigate: (href: string) => void;
}

const NavigationGuardContext = createContext<NavigationGuardContextType | null>(null);
NavigationGuardContext.displayName = 'NavigationGuardContext';

export function useNavigationGuard() {
  const context = useContext(NavigationGuardContext);
  if (!context) {
    throw new Error('useNavigationGuard must be used within NavigationGuardProvider');
  }
  return context;
}

interface NavigationGuardProviderProps {
  children: ReactNode;
}

export function NavigationGuardProvider({ children }: NavigationGuardProviderProps) {
  const router = useRouter();
  const pathname = usePathname();

  // Get the current file ID from the URL
  const currentFileId = useMemo(() => getFileIdFromPathname(pathname), [pathname]);

  // Check if we're on a /new/[type] page
  const isOnNewFilePage = useMemo(() => isNewFilePage(pathname), [pathname]);

  // Get the current file from Redux (if on a file page)
  const currentFile = useAppSelector(state =>
    currentFileId !== null ? state.files.files[currentFileId] : null
  );

  // For /new pages, find any dirty virtual file (negative ID)
  const dirtyVirtualFile = useAppSelector(state => {
    if (!isOnNewFilePage) return null;
    // Find the first virtual file (negative ID) that has changes
    const files = state.files.files;
    for (const fileId in files) {
      const id = parseInt(fileId, 10);
      if (id < 0 && isFileDirty(files[id])) {
        return files[id];
      }
    }
    return null;
  });

  // Check if the current file is dirty
  const isCurrentFileDirty = useMemo(() => {
    if (currentFile) return isFileDirty(currentFile);
    if (dirtyVirtualFile) return true;
    return false;
  }, [currentFile, dirtyVirtualFile]);

  const currentFileName = currentFile?.name || dirtyVirtualFile?.name || 'Untitled';

  // Check if agent is running in active conversation
  const activeConversationID = useAppSelector(selectActiveConversation);
  const activeConversation = useAppSelector(state =>
    activeConversationID ? state.chat.conversations[activeConversationID] : undefined
  );
  const isAgentRunning = activeConversation?.executionState === 'WAITING'
    || activeConversation?.executionState === 'EXECUTING'
    || activeConversation?.executionState === 'STREAMING';

  // Check if there are any dirty files (for in-app navigation and beforeunload)
  const dirtyFiles = useAppSelector(state => selectDirtyFiles(state));
  const anyDirtyFiles = dirtyFiles.length > 0;

  // In-app nav guard: any dirty file (current or otherwise) OR agent running.
  // Agent navigation via the Navigate tool uses router.push() directly and bypasses this guard.
  const shouldGuardInAppNavigation = isCurrentFileDirty || anyDirtyFiles || isAgentRunning;

  // beforeunload guard: fire whenever any file has unsaved changes, or when the agent is running.
  const shouldGuardUnload = isCurrentFileDirty || anyDirtyFiles || isAgentRunning;

  // Modal state
  const [isOpen, setIsOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [guardReason, setGuardReason] = useState<'dirty' | 'agent-running' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);

  const openGuardModal = useCallback((href: string) => {
    setPendingHref(href);
    setGuardReason(isAgentRunning ? 'agent-running' : 'dirty');
    setIsOpen(true);
  }, [isAgentRunning]);

  // Navigate function that checks for system-file dirty state or running agent
  const navigate = useCallback((href: string) => {
    if (shouldGuardInAppNavigation) {
      openGuardModal(href);
    } else {
      router.push(href);
    }
  }, [shouldGuardInAppNavigation, openGuardModal, router]);

  // Confirm navigation (leave page, discard ALL changes)
  const handleConfirm = useCallback(() => {
    for (const file of dirtyFiles) {
      clearFileChanges({ fileId: file.id });
    }
    if (pendingHref) {
      router.push(pendingHref);
    }
    setIsOpen(false);
    setPendingHref(null);
    setSaveError(null);
  }, [pendingHref, router, dirtyFiles]);

  // Cancel navigation (stay on page)
  const handleCancel = useCallback(() => {
    setIsOpen(false);
    setPendingHref(null);
    setGuardReason(null);
    setSaveError(null);
  }, []);

  // Open PublishModal for reviewing and saving all dirty files
  const handleSaveAndContinue = useCallback(() => {
    setIsOpen(false);
    setIsPublishModalOpen(true);
  }, []);

  // When PublishModal closes, navigate if all files are now clean
  const handlePublishModalClose = useCallback(() => {
    setIsPublishModalOpen(false);
    // Check dirty files at close time — if all saved, proceed with navigation
    // We read dirtyFiles from the closure, but the PublishModal auto-closes when
    // all files are saved, so we do a fresh check via a microtask
    setTimeout(() => {
      const stillDirty = selectDirtyFiles(getStore().getState());
      if (stillDirty.length === 0 && pendingHref) {
        router.push(pendingHref);
        setPendingHref(null);
      }
    }, 0);
  }, [pendingHref, router]);

  // Auto-dismiss: if the modal is open for agent-running but agent stopped, close it.
  // Derived during render — React will re-render when isAgentRunning changes, and
  // the Dialog's `open` prop will reflect the updated state.
  const effectiveIsOpen = isOpen && !(guardReason === 'agent-running' && !isAgentRunning);

  // Handle browser beforeunload (tab close, refresh, external navigation)
  // Fires for ALL dirty files (system + user) and when agent is running
  useEffect(() => {
    if (!shouldGuardUnload) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore custom messages, but we still need to set returnValue
      e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [shouldGuardUnload]);

  // Intercept link clicks globally
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      // Find the closest anchor tag
      const target = (e.target as Element).closest('a');
      if (!target) return;

      const href = target.getAttribute('href');
      if (!href) return;

      // Skip external links, hash links, and special protocols
      if (
        href.startsWith('http://') ||
        href.startsWith('https://') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('#') ||
        target.getAttribute('target') === '_blank'
      ) {
        return;
      }

      // Skip if modifier keys are pressed (user wants to open in new tab)
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }

      // Skip download links
      if (target.hasAttribute('download')) {
        return;
      }

      // Block navigation when any file has unsaved changes or agent is running.
      if (shouldGuardInAppNavigation) {
        e.preventDefault();
        e.stopPropagation();

        // Preserve URL parameters
        const preservedHref = preserveParams(href);
        openGuardModal(preservedHref);
      }
    };

    // Use capture phase to intercept before other handlers
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [shouldGuardInAppNavigation, openGuardModal]);

  return (
    <NavigationGuardContext.Provider value={useMemo(() => ({ navigate }), [navigate])}>
      {children}

      {/* Unsaved Changes Navigation Modal */}
      <Dialog.Root open={effectiveIsOpen} onOpenChange={(e: { open: boolean }) => !e.open && handleCancel()}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner display="flex" alignItems="center" justifyContent="center">
            <Dialog.Content
              maxW="500px"
              bg="bg.surface"
              borderRadius="lg"
              border="1px solid"
              borderColor="border.default"
            >
              <Dialog.Header px={6} py={4} borderBottom="1px solid" borderColor="border.default">
                <Dialog.Title fontWeight="700" fontSize="xl" fontFamily={"mono"}>
                  {guardReason === 'agent-running' ? 'Agent is Running' : 'Unsaved Changes'}
                </Dialog.Title>
              </Dialog.Header>
              <Dialog.Body px={6} py={5}>
                <Text fontSize="sm" lineHeight="1.6">
                  {guardReason === 'agent-running'
                    ? 'An agent is currently running. Are you sure you want to leave? The agent will continue running in the background but you may lose track of its progress.'
                    : isCurrentFileDirty
                      ? `You have unsaved changes in "${currentFileName}". Are you sure you want to leave without saving?`
                      : 'You have unsaved changes. You must save or discard your changes before navigating away from this page.'
                  }
                </Text>
                {saveError && (
                  <Text fontSize="sm" color="accent.danger" mt={2}>{saveError}</Text>
                )}
              </Dialog.Body>
              <Dialog.Footer px={6} py={4} gap={3} borderTop="1px solid" borderColor="border.default" justifyContent="flex-end">
                {guardReason === 'dirty' ? (
                  <HStack gap={2}>
                    <Button variant="outline" onClick={handleCancel}>
                      Cancel
                    </Button>
                    <Button bg="accent.danger" color="white" onClick={handleConfirm}>
                      Discard All Changes
                    </Button>
                    <Button bg="accent.teal" color="white" onClick={handleSaveAndContinue}>
                      Review Changes
                    </Button>
                  </HStack>
                ) : (
                  <HStack gap={2}>
                    <Dialog.ActionTrigger asChild>
                      <Button variant="outline" onClick={handleCancel}>
                        Stay on Page
                      </Button>
                    </Dialog.ActionTrigger>
                    <Button bg="accent.danger" color="white" onClick={handleConfirm}>
                      Leave Page
                    </Button>
                  </HStack>
                )}
              </Dialog.Footer>
              <Dialog.CloseTrigger />
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
      <PublishModal isOpen={isPublishModalOpen} onClose={handlePublishModalClose} />
    </NavigationGuardContext.Provider>
  );
}
