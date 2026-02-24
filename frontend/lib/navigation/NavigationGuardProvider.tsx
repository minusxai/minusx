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
import { publishFile, clearFileChanges, selectDirtyFiles } from '@/lib/api/file-state';
import { isSystemFileType } from '@/lib/ui/file-metadata';

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

  // Check if the current file is a system file (connection, config, styles, context).
  // Only system files trigger the in-app nav guard; user files navigate freely.
  const isCurrentFileSystemFile = useMemo(() => {
    if (currentFile) return isSystemFileType(currentFile.type as any);
    if (dirtyVirtualFile) return isSystemFileType(dirtyVirtualFile.type as any);
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

  // Check if there are any non-system dirty files (for beforeunload only)
  const anyNonSystemDirtyFiles = useAppSelector(state => selectDirtyFiles(state).length > 0);

  // In-app nav guard: only for system files (dirty) OR agent running.
  // User files navigate freely — their changes persist in Redux across navigation.
  const shouldGuardInAppNavigation = (isCurrentFileDirty && isCurrentFileSystemFile) || isAgentRunning;

  // beforeunload guard: fire whenever any file (system or user) has unsaved changes,
  // or when the agent is running.
  const shouldGuardUnload = isCurrentFileDirty || anyNonSystemDirtyFiles || isAgentRunning;

  // Modal state
  const [isOpen, setIsOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [guardReason, setGuardReason] = useState<'dirty' | 'agent-running' | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  // Confirm navigation (leave page, discard changes)
  const handleConfirm = useCallback(() => {
    const fileIdToAct = currentFileId ?? (dirtyVirtualFile?.id as number | undefined) ?? null;
    if (fileIdToAct !== null) {
      clearFileChanges({ fileId: fileIdToAct });
    }
    if (pendingHref) {
      router.push(pendingHref);
    }
    setIsOpen(false);
    setPendingHref(null);
    setSaveError(null);
  }, [pendingHref, router, currentFileId, dirtyVirtualFile]);

  // Cancel navigation (stay on page)
  const handleCancel = useCallback(() => {
    setIsOpen(false);
    setPendingHref(null);
    setGuardReason(null);
    setSaveError(null);
  }, []);

  // Save and continue navigation
  const handleSaveAndContinue = useCallback(async () => {
    const fileIdToAct = currentFileId ?? (dirtyVirtualFile?.id as number | undefined) ?? null;
    if (fileIdToAct === null) {
      handleConfirm();
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await publishFile({ fileId: fileIdToAct });
      if (pendingHref) router.push(pendingHref);
      setIsOpen(false);
      setPendingHref(null);
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [currentFileId, dirtyVirtualFile, pendingHref, router, handleConfirm]);

  // Auto-dismiss modal if agent finishes while modal is open for that reason
  useEffect(() => {
    if (isOpen && guardReason === 'agent-running' && !isAgentRunning) {
      handleCancel();
    }
  }, [isOpen, guardReason, isAgentRunning, handleCancel]);

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

      // For system files (or agent running): intercept and show guard modal.
      // For user files: allow navigation freely (changes persist in Redux).
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
    <NavigationGuardContext.Provider value={{ navigate }}>
      {children}

      {/* Unsaved Changes Navigation Modal */}
      <Dialog.Root open={isOpen} onOpenChange={(e: { open: boolean }) => !e.open && handleCancel()}>
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
                    : `You have unsaved changes in "${currentFileName}". Are you sure you want to leave without saving?`
                  }
                </Text>
                {saveError && (
                  <Text fontSize="sm" color="accent.danger" mt={2}>{saveError}</Text>
                )}
              </Dialog.Body>
              <Dialog.Footer px={6} py={4} gap={3} borderTop="1px solid" borderColor="border.default" justifyContent="flex-end">
                {guardReason === 'dirty' ? (
                  <HStack gap={2}>
                    <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
                      Cancel
                    </Button>
                    <Button bg="accent.danger" color="white" onClick={handleConfirm} disabled={isSaving}>
                      Discard Changes
                    </Button>
                    <Button bg="accent.teal" color="white" onClick={handleSaveAndContinue} loading={isSaving}>
                      Save &amp; Continue
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
    </NavigationGuardContext.Provider>
  );
}
